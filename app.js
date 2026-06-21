import { getDepartures, getPlaceConfig, getPlaces } from "./data-provider.js?v=20260614-2";

const DEFAULT_PLACE_ID = "hnd-t3";
const DISPLAY_LIMIT = 12;
const JAPAN_TIME_ZONE = "Asia/Tokyo";
const PLACE_STORAGE_KEY = "departure-board:place";
const TIME_MODE_STORAGE_KEY = "departure-board:time-mode";
const TIME_MODES = { RELATIVE: "relative", DEPARTURE: "departure" };
const elements = {
  placeSelect: document.querySelector("#place-select"),
  serviceTypeSelect: document.querySelector("#service-type-select"),
  filterToggle: document.querySelector("#filter-toggle"),
  filterPanel: document.querySelector("#filter-panel"),
  filterSources: document.querySelector("#filter-sources"),
  filterReset: document.querySelector("#filter-reset"),
  clockTime: document.querySelector("#clock-time"),
  clockDate: document.querySelector("#clock-date"),
  timeModeToggle: document.querySelector("#time-mode-toggle"),
  timeModeLabel: document.querySelector("#time-mode-label"),
  departures: document.querySelector("#departures"),
  status: document.querySelector("#status"),
  dataNote: document.querySelector("#data-note"),
  dataStatus: document.querySelector("#data-status"),
  refreshButton: document.querySelector("#refresh-button"),
  template: document.querySelector("#departure-template"),
};

let places = [];
let selectedPlaceId;
let selectedServiceType;
let placeConfig;
let timetableData;
let timeMode = loadStored(TIME_MODE_STORAGE_KEY) ?? TIME_MODES.RELATIVE;

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JAPAN_TIME_ZONE, month: "numeric", day: "numeric", weekday: "short",
});
const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: JAPAN_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
});
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: JAPAN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

function serviceTypeStorageKey(placeId) {
  return `departure-board:service-type:${placeId}`;
}

function filtersStorageKey(placeId) {
  return `departure-board:filters:${placeId}`;
}

function loadStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Keep session behavior. */ }
}

function loadFilters(placeId) {
  try { return JSON.parse(localStorage.getItem(filtersStorageKey(placeId)) ?? "{}"); } catch { return {}; }
}

function getJapanParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAPAN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDaysKey(key, days) {
  const [year, month, day] = key.split("-").map(Number);
  return dateKeyFormatter.format(new Date(Date.UTC(year, month - 1, day + days, 12)));
}

function weekdayOfKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function nthMonday(year, month, nth) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
  const firstMonday = 1 + ((8 - firstDay) % 7);
  return firstMonday + (nth - 1) * 7;
}

function springEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function baseJapaneseHolidays(year) {
  return new Set([
    dateKey(year, 1, 1),
    dateKey(year, 1, nthMonday(year, 1, 2)),
    dateKey(year, 2, 11),
    dateKey(year, 2, 23),
    dateKey(year, 3, springEquinoxDay(year)),
    dateKey(year, 4, 29),
    dateKey(year, 5, 3),
    dateKey(year, 5, 4),
    dateKey(year, 5, 5),
    dateKey(year, 7, nthMonday(year, 7, 3)),
    dateKey(year, 8, 11),
    dateKey(year, 9, nthMonday(year, 9, 3)),
    dateKey(year, 9, autumnEquinoxDay(year)),
    dateKey(year, 10, nthMonday(year, 10, 2)),
    dateKey(year, 11, 3),
    dateKey(year, 11, 23),
  ]);
}

function japaneseHolidayKeys(year) {
  const holidays = baseJapaneseHolidays(year);
  const baseKeys = [...holidays].sort();

  for (const key of baseKeys) {
    if (weekdayOfKey(key) !== 0) continue;
    let substitute = addDaysKey(key, 1);
    while (holidays.has(substitute)) substitute = addDaysKey(substitute, 1);
    holidays.add(substitute);
  }

  for (let month = 1; month <= 12; month += 1) {
    const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
    for (let day = 2; day < daysInMonth; day += 1) {
      const key = dateKey(year, month, day);
      if (holidays.has(key)) continue;
      if (holidays.has(addDaysKey(key, -1)) && holidays.has(addDaysKey(key, 1))) holidays.add(key);
    }
  }

  return holidays;
}

export function isJapaneseHoliday(date) {
  const key = dateKeyFormatter.format(date);
  const year = Number(key.slice(0, 4));
  return japaneseHolidayKeys(year).has(key);
}

export function detectServiceType(date, availableServiceTypes) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: JAPAN_TIME_ZONE, weekday: "short",
  }).format(date);
  const preferred = isJapaneseHoliday(date) || weekday === "Sat" || weekday === "Sun" ? "holiday" : "weekday";
  const ids = availableServiceTypes.map(({ id }) => id);
  return ids.includes(preferred) ? preferred : ids[0];
}

function getServiceContext(date, available = placeConfig?.serviceTypes ?? []) {
  const parts = getJapanParts(date);
  const serviceDate = new Date(Date.UTC(
    Number(parts.year), Number(parts.month) - 1,
    Number(parts.day) - (Number(parts.hour) < 4 ? 1 : 0), 3,
  ));
  return { parts: getJapanParts(serviceDate), serviceType: detectServiceType(serviceDate, available) };
}

function departureDate(parts, time) {
  const [rawHour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day) + Math.floor(rawHour / 24),
    (rawHour % 24) - 9, minute,
  ));
}

function populateSelect(select, items) {
  select.replaceChildren(...items.map(({ id, name, label }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name ?? label;
    return option;
  }));
}

function validStoredId(key, items, fallbackId) {
  const saved = loadStored(key);
  if (items.some(({ id }) => id === saved)) return saved;
  if (items.some(({ id }) => id === fallbackId)) return fallbackId;
  return items[0]?.id;
}

function getServiceTypeLabel(id) {
  return placeConfig?.serviceTypes.find((item) => item.id === id)?.label ?? id ?? "--";
}

function renderDataStatus(metadata = {}) {
  elements.dataStatus.textContent =
    `データ: ${metadata.status ?? "unknown"} / ${getServiceTypeLabel(metadata.serviceType ?? selectedServiceType)} / ${metadata.version ?? "--"} / 更新 ${metadata.lastUpdated ?? "--"}`;
}

function createCheckList(title, values, selected, sourceId, field) {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = title;
  fieldset.append(legend);
  for (const value of values) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.includes(value);
    input.dataset.sourceId = sourceId;
    input.dataset.field = field;
    input.value = value;
    label.append(input, value);
    fieldset.append(label);
  }
  return fieldset;
}

function renderFilterPanel() {
  elements.filterSources.replaceChildren();
  for (const sourceId of placeConfig.place.sources) {
    const source = placeConfig.sources[sourceId];
    const state = timetableData.filterState[sourceId];
    if (!source || !state) continue;
    const section = document.createElement("section");
    section.className = "filter-source";
    const heading = document.createElement("h3");
    heading.textContent = `駅: ${source.displayName || [source.line, source.stationName].filter(Boolean).join("　") || source.operator}`;
    const enabledLabel = document.createElement("label");
    enabledLabel.className = "filter-enabled";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = state.filter.enabled;
    enabled.dataset.sourceId = sourceId;
    enabled.dataset.field = "enabled";
    enabledLabel.append(enabled, "表示する");
    section.append(
      heading,
      enabledLabel,
      createCheckList("種別", state.candidates.trainTypes, state.filter.trainTypes, sourceId, "trainTypes"),
      createCheckList("行先", state.candidates.destinations, state.filter.destinations, sourceId, "destinations"),
    );
    elements.filterSources.append(section);
  }
}

function collectFilters() {
  const filters = {};
  for (const sourceId of placeConfig.place.sources) {
    filters[sourceId] = { enabled: false, trainTypes: [], destinations: [] };
  }
  for (const input of elements.filterSources.querySelectorAll("input")) {
    const filter = filters[input.dataset.sourceId];
    if (input.dataset.field === "enabled") filter.enabled = input.checked;
    else if (input.checked) filter[input.dataset.field].push(input.value);
  }
  return filters;
}

function getUpcomingDepartures(now) {
  const service = getServiceContext(now);
  return timetableData.departures
    .map((departure) => ({ ...departure, date: departureDate(service.parts, departure.departureTime) }))
    .filter((departure) => departure.date >= now)
    .sort((a, b) => a.date - b.date)
    .slice(0, DISPLAY_LIMIT);
}

function toggleTimeMode() {
  timeMode = timeMode === TIME_MODES.RELATIVE ? TIME_MODES.DEPARTURE : TIME_MODES.RELATIVE;
  saveStored(TIME_MODE_STORAGE_KEY, timeMode);
  render();
}

function formatDepartureTime(departure, now) {
  if (timeMode === TIME_MODES.DEPARTURE) return departure.departureTime.replace(/^24:/, "0:");
  const remaining = Math.max(0, Math.ceil((departure.date - now) / 60_000));
  return remaining === 0 ? "まもなく" : `${remaining}分後`;
}

function timeToMinutes(time) {
  const match = String(time ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return undefined;
  return hour * 60 + minute;
}

function referenceDurationMinutes(departureTime, referenceTime) {
  const departureMinutes = timeToMinutes(departureTime);
  let referenceMinutes = timeToMinutes(referenceTime);
  if (departureMinutes === undefined || referenceMinutes === undefined) return undefined;
  while (referenceMinutes < departureMinutes) referenceMinutes += 24 * 60;
  return referenceMinutes - departureMinutes;
}

function preferArrivalInfo(arrivals = []) {
  const byStation = new Map();
  for (const arrival of arrivals) {
    const current = byStation.get(arrival.stationName);
    if (!current || (arrival.timeType === "arrival" && current.timeType !== "arrival")) {
      byStation.set(arrival.stationName, arrival);
    }
  }
  return [...byStation.values()];
}

function renderArrivalInfo(container, departureTime, arrivals = []) {
  for (const arrival of preferArrivalInfo(arrivals)) {
    const item = document.createElement("li");
    const station = document.createElement("span");
    const time = document.createElement("time");
    const duration = document.createElement("span");
    const rawTime = arrival.arrivalTime ?? arrival.time;
    const durationMinutes = referenceDurationMinutes(departureTime, rawTime);
    const typeLabel = { arrival: "着", departure: "発" }[arrival.timeType];
    station.className = "arrival-station";
    station.textContent = arrival.stationName;
    time.className = "arrival-time";
    time.textContent = (rawTime ?? "--:--").replace(/^24:/, "0:");
    if (typeLabel) {
      const kind = document.createElement("span");
      kind.className = "arrival-time-kind";
      kind.textContent = typeLabel;
      time.append(kind);
    }
    item.append(station, time);
    if (durationMinutes !== undefined) {
      duration.className = "arrival-duration";
      duration.textContent = `（${durationMinutes}分）`;
      item.append(duration);
    }
    container.append(item);
  }
}

function renderDeparture(departure, now) {
  const fragment = elements.template.content.cloneNode(true);
  const article = fragment.querySelector(".departure");
  const timeToggle = fragment.querySelector(".departure-time-toggle");
  article.style.setProperty("--operator-color", departure.source.color);
  article.dataset.sourceId = departure.sourceId;
  article.dataset.trainType = departure.trainType ?? "";
  timeToggle.textContent = formatDepartureTime(departure, now);
  timeToggle.addEventListener("click", toggleTimeMode);
  fragment.querySelector(".source-line").textContent = departure.sourceLineLabel ?? departure.sourceDisplayName;
  fragment.querySelector(".source-station").textContent = departure.sourceStationLabel ?? "";
  const trainType = fragment.querySelector(".train-type");
  if (departure.trainType) {
    const numberedService = ["スカイライナー", "成田エクスプレス"].includes(departure.trainType);
    const numberLabel = departure.serviceNumber
      ? `${departure.serviceNumber}${numberedService ? "号" : ""}`
      : "";
    trainType.textContent = `${departure.trainType}${numberLabel}`;
    trainType.classList.add(`display-category-${departure.displayCategory ?? "default"}`);
  } else trainType.hidden = true;
  fragment.querySelector(".destination").textContent = departure.destination;
  renderArrivalInfo(fragment.querySelector(".arrival-info"), departure.departureTime, departure.arrivalInfo);
  return fragment;
}

function render() {
  if (!timetableData) return;
  const now = new Date();
  elements.clockTime.textContent = timeFormatter.format(now);
  elements.clockDate.textContent = dateFormatter.format(now);
  elements.timeModeLabel.textContent = timeMode === TIME_MODES.RELATIVE ? "あと" : "発車";
  elements.departures.replaceChildren();
  const upcoming = getUpcomingDepartures(now);
  if (!upcoming.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "現在時刻以降の表示対象便はありません。";
    elements.departures.append(empty);
    return;
  }
  for (const departure of upcoming) elements.departures.append(renderDeparture(departure, now));
}

async function loadPlace(placeId) {
  selectedPlaceId = placeId;
  saveStored(PLACE_STORAGE_KEY, placeId);
  placeConfig = await getPlaceConfig(placeId);
  populateSelect(elements.serviceTypeSelect, placeConfig.serviceTypes);
  selectedServiceType = validStoredId(
    serviceTypeStorageKey(placeId),
    placeConfig.serviceTypes,
    getServiceContext(new Date(), placeConfig.serviceTypes).serviceType,
  );
  elements.serviceTypeSelect.value = selectedServiceType;
  await loadTimetable();
}

async function loadTimetable() {
  elements.status.textContent = "時刻表を読み込んでいます。";
  try {
    timetableData = await getDepartures(selectedPlaceId, selectedServiceType, loadFilters(selectedPlaceId));
    elements.dataNote.textContent = placeConfig.dataNote ?? "";
    renderDataStatus(timetableData.metadata);
    renderFilterPanel();
    elements.status.textContent = "";
    render();
  } catch (error) {
    console.error(error);
    elements.status.textContent = "時刻表データを読み込めませんでした。";
    renderDataStatus();
  }
}

async function initialize() {
  places = await getPlaces();
  populateSelect(elements.placeSelect, places);
  selectedPlaceId = validStoredId(PLACE_STORAGE_KEY, places, DEFAULT_PLACE_ID);
  elements.placeSelect.value = selectedPlaceId;
  await loadPlace(selectedPlaceId);
}

elements.placeSelect.addEventListener("change", () => loadPlace(elements.placeSelect.value));
elements.serviceTypeSelect.addEventListener("change", () => {
  selectedServiceType = elements.serviceTypeSelect.value;
  saveStored(serviceTypeStorageKey(selectedPlaceId), selectedServiceType);
  loadTimetable();
});
elements.filterToggle.addEventListener("click", () => {
  elements.filterPanel.hidden = !elements.filterPanel.hidden;
  elements.filterToggle.setAttribute("aria-expanded", String(!elements.filterPanel.hidden));
});
elements.filterSources.addEventListener("change", () => {
  saveStored(filtersStorageKey(selectedPlaceId), JSON.stringify(collectFilters()));
  loadTimetable();
});
elements.filterReset.addEventListener("click", () => {
  try { localStorage.removeItem(filtersStorageKey(selectedPlaceId)); } catch { /* Keep session behavior. */ }
  loadTimetable();
});
elements.refreshButton.addEventListener("click", loadTimetable);
elements.timeModeToggle.addEventListener("click", toggleTimeMode);
setInterval(render, 15_000);
initialize();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service Worker registration failed", error);
    });
  });
}
