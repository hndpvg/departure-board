import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataDir = resolve(root, "data");
const snapshotDate = "2026-06-14";
const weekdayDate = "2026-06-15";
const holidayDate = "2026-06-14";

const htmlEntities = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

function decodeHtml(value) {
  return value
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => htmlEntities.get(entity))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, encoding = "utf-8") {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 departure-board-data-maintenance" },
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return new TextDecoder(encoding).decode(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1000));
    }
  }
  throw lastError;
}

function normalizeTime(time) {
  const [hour, minute] = time.split(":").map(Number);
  if (hour < 4) return `${String(hour + 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function matchedReferenceTime(stationName, arrivalTime, timeType, source = "train-detail") {
  return {
    stationName,
    arrivalTime: normalizeTime(arrivalTime),
    timeType,
    source,
    confidence: "matched",
  };
}

function normalizeDetailTime(time) {
  const normalized = decodeHtml(time).replace("：", ":");
  return /^\d{1,2}:\d{2}$/.test(normalized) ? normalizeTime(normalized) : undefined;
}

function buildArrivalInfoFromRows(rows, referenceStations) {
  return rows.flatMap(([stationName, arrivalTime, departureTime]) => {
    if (!referenceStations.includes(stationName)) return [];
    const departure = normalizeDetailTime(departureTime);
    const arrival = normalizeDetailTime(arrivalTime);
    if (departure) return [matchedReferenceTime(stationName, departure, "departure")];
    if (arrival) return [matchedReferenceTime(stationName, arrival, "arrival")];
    return [];
  });
}

function parseKeikyuTrainDetail(html, referenceStations) {
  const rows = [...html.matchAll(
    /<tr>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([^<]*?)\s*<\/td>\s*<td[^>]*>\s*([^<]*?)\s*<\/td>\s*<\/tr>/g,
  )].map((match) => match.slice(1).map((value) => decodeHtml(value)));
  return buildArrivalInfoFromRows(rows, referenceStations);
}

function parseKeiseiTrainDetail(html, referenceStations) {
  const rows = [...html.matchAll(
    /<tr>[\s\S]*?<td class="ektbl_th_col">([^<]+)<\/td>[\s\S]*?<td class="ektbl_col">([^<]*)<\/td>[\s\S]*?<td class="ektbl_col">([^<]*)<\/td>[\s\S]*?<\/tr>/g,
  )].map((match) => match.slice(1).map((value) => decodeHtml(value)));
  return buildArrivalInfoFromRows(rows, referenceStations);
}

function parseSkylinerOfficialTimetable(html, weekend) {
  const upSection = html.slice(html.indexOf('<a id="up"></a>'));
  const timetableSets = [...upSection.matchAll(/<div class="timeSet">([\s\S]*?)<\/table>/g)];
  const tableHtml = timetableSets[weekend ? 1 : 0]?.[1] ?? "";
  const timetable = new Map();
  for (const row of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((cell) => decodeHtml(cell[1]));
    if (cells.length !== 7 || !/^\d+$/.test(cells[0])) continue;
    const [serviceNumber, , airportT2, , , nippori] = cells;
    const departureTime = normalizeDetailTime(airportT2);
    if (!departureTime) continue;
    const arrivalInfo = [];
    const nipporiTime = normalizeDetailTime(nippori);
    if (nipporiTime) arrivalInfo.push(matchedReferenceTime("日暮里", nipporiTime, "arrival", "station-timetable"));
    timetable.set(departureTime, { serviceNumber, arrivalInfo });
  }
  return timetable;
}

function parseJrTrainDetail(html, referenceStations) {
  const serviceNumber = html.match(/成田エクスプレス\s*(\d+)号/)?.[1];
  const arrivalInfo = [];
  const terminalStations = [];
  const earliestTime = (matches) =>
    matches
      .map((match) => normalizeDetailTime(match[1]))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))[0];
  for (const row of html.matchAll(/<tr class="time">([\s\S]*?)<\/tr>/g)) {
    const stationName = decodeHtml(row[1].match(/<th class="time">[\s\S]*?<a[^>]*>([^<]+)<\/a>/)?.[1] ?? "");
    const times = [...row[1].matchAll(/(\d{2}:\d{2})\s*(発|着)/g)];
    const hasArrival = times.some((match) => match[2] === "着");
    const hasDeparture = times.some((match) => match[2] === "発");
    if (stationName && hasArrival && !hasDeparture) terminalStations.push(stationName);
    if (!referenceStations.includes(stationName)) continue;
    const departureTime = earliestTime(times.filter((match) => match[2] === "発"));
    const arrivalTime = earliestTime(times.filter((match) => match[2] === "着"));
    if (departureTime) arrivalInfo.push(matchedReferenceTime(stationName, departureTime, "departure"));
    else if (arrivalTime) arrivalInfo.push(matchedReferenceTime(stationName, arrivalTime, "arrival"));
  }
  const destinationOrder = ["新宿", "大船", "池袋", "八王子", "高尾"];
  const destination = [...new Set(terminalStations)]
    .sort((a, b) => {
      const indexA = destinationOrder.includes(a) ? destinationOrder.indexOf(a) : destinationOrder.length;
      const indexB = destinationOrder.includes(b) ? destinationOrder.indexOf(b) : destinationOrder.length;
      return indexA - indexB || a.localeCompare(b, "ja");
    })
    .join("・");
  return { arrivalInfo, serviceNumber, destination };
}

async function attachTrainDetailArrivalInfo(departures, referenceStations, parser, encoding = "utf-8") {
  return inBatches(departures, 12, async (departure) => {
    if (!departure._detailUrl) return departure;
    const detail = await fetchText(departure._detailUrl, encoding);
    const arrivalInfo = parser(detail, referenceStations);
    return arrivalInfo.length ? { ...departure, arrivalInfo } : departure;
  });
}

function departureId(sourceId, time, index) {
  return `${sourceId}-${time.replace(":", "")}-${String(index + 1).padStart(3, "0")}`;
}

async function parseKeikyu(dw) {
  const url = `https://norikae.keikyu.co.jp/transit/norikae/T5?USR=PC&dw=${dw}&slCode=253-6&d=1&rsf=&SJ=1&tFlg=0`;
  const html = await fetchText(url, "shift_jis");
  const typeByClass = {
    syasyu1001: "普通",
    syasyu1002: "急行",
    syasyu1003: "特急",
    syasyu1004: "快特",
    syasyu1011: "エアポート快特",
  };
  const departures = [];
  for (const match of html.matchAll(/<div class="syasyubox\s+(syasyu\d+)">([\s\S]*?)<\/div>/g)) {
    const trainType = typeByClass[match[1]];
    if (!trainType) continue;
    const minute = match[2].match(/<span class="min\d+">(\d{2})<\/span>/)?.[1];
    const href = match[2].match(/href="([^"]+)"/)?.[1] ?? "";
    const hour = href.match(/[?&]tm=(\d{3,4})/)?.[1]?.slice(0, -2);
    const text = decodeHtml(match[2]);
    const destination = text.split(/\d{2}/).at(-1)?.trim();
    if (!hour || !minute || !destination) continue;
    const departureTime = normalizeTime(`${String(hour).padStart(2, "0")}:${minute}`);
    departures.push({
      _detailUrl: new URL(decodeHtml(href), "https://norikae.keikyu.co.jp/transit/norikae/").href,
      sourceId: "keikyu-hnd-t3",
      departureTime,
      trainType,
      destination,
    });
  }
  const enriched = await attachTrainDetailArrivalInfo(
    departures,
    ["品川", "大門"],
    parseKeikyuTrainDetail,
    "shift_jis",
  );
  return enriched.map(({ _detailUrl, ...departure }) => departure);
}

async function inBatches(items, size, worker) {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(worker)));
  }
  return results;
}

async function parseMonorail(date) {
  const base = "https://train-cloud.navitime.biz";
  const url = `${base}/tokyo-monorail/railroads/timetables?station=00009590&directional-railroad=00000783-up&date=${date}`;
  const html = await fetchText(url);
  const links = [...html.matchAll(/href="([^"]*\/tokyo-monorail\/railroads\/timetables\/stops\?[^"]+)"/g)]
    .map((match) => decodeHtml(match[1]))
    .filter((link, index, all) => all.indexOf(link) === index);

  return inBatches(links, 16, async (link) => {
    const detail = await fetchText(new URL(link, base));
    const title = detail.match(/<title>東京モノレール(空港快速|区間快速)?\s*モノレール浜松町行/)?.[1];
    const trainType = title || "普通";
    const departureIso = new URL(decodeHtml(link), base).searchParams.get("datetime");
    const times = [...detail.matchAll(new RegExp(`${date}T(\\d{2}:\\d{2}):\\d{2}\\+09:00`, "g"))]
      .map((match) => match[1]);
    return {
      sourceId: "monorail-hnd-t3",
      departureTime: normalizeTime(departureIso.slice(11, 16)),
      trainType,
      destination: "浜松町",
      arrivalInfo: times.length
        ? [matchedReferenceTime("浜松町", times.at(-1), "arrival")]
        : undefined,
    };
  });
}

function parseKeiseiPage(html, sourceId, routeName, weekend) {
  const departures = [];
  const weekdayStart = html.indexOf('<div v-show="isWeekday" class="my-3">');
  const weekendStart = html.indexOf('<div v-show="isWeekend" class="my-3">');
  const timetableHtml = weekend
    ? html.slice(weekendStart)
    : html.slice(weekdayStart, weekendStart);
  const pattern = /openOneTrainTimetable\('([^']+)','([^']+)','([^']+)','([^']+)','([^']+)'\s*\)[\s\S]*?<span class="ekldeptime">(\d{1,2}:\d{2})<\/span>[\s\S]*?<span class="ekltraintype[^"]*">([^<]+)<\/span>[\s\S]*?<span class="ekldest">([^<]+)<\/span>/g;
  for (const match of timetableHtml.matchAll(pattern)) {
    const trainType = decodeHtml(match[7]);
    const serviceNumber = trainType === "スカイライナー"
      ? match[1].match(/AE(\d+)$/)?.[1]?.replace(/^0+/, "")
      : undefined;
    const departureTime = normalizeTime(match[6]);
    const destination = decodeHtml(match[8]);
    departures.push({
      _trainKey: match[1],
      _detailUrl: `https://keisei.ekitan.com/search/timetable/onetraintimetable/?tx=${match[1]}&sf=${match[2]}&date=${match[3]}&time=${match[4]}&dw=${match[5]}`,
      sourceId,
      departureTime,
      trainType,
      ...(serviceNumber ? { serviceNumber } : {}),
      destination,
      routeName,
    });
  }
  return departures;
}

async function parseKeisei(dw) {
  const base = "https://keisei.ekitan.com/search/timetable/station";
  const [mainline, access, skylinerOfficial] = await Promise.all([
    fetchText(`${base}/254-41/d1?dw=${dw}`),
    fetchText(`${base}/682-6/d1?dw=${dw}`),
    fetchText("https://www.keisei.co.jp/keisei/tetudou/skyliner/jp/traffic/skyliner_timetable.php"),
  ]);
  const skylinerTimetable = parseSkylinerOfficialTimetable(skylinerOfficial, dw === 1);
  const departures = [
    ...parseKeiseiPage(mainline, "keisei-mainline-nrt-t2", "京成本線", dw === 1),
    ...parseKeiseiPage(access, "keisei-access-nrt-t2", "成田スカイアクセス線", dw === 1),
  ];
  const uniqueDepartures = [...new Map(departures.map((departure) => [departure._trainKey, departure])).values()];
  const enriched = await attachTrainDetailArrivalInfo(
    uniqueDepartures,
    ["日暮里", "押上", "日本橋"],
    parseKeiseiTrainDetail,
  );
  return enriched.map(({ _trainKey, _detailUrl, ...departure }) => {
    if (departure.trainType === "スカイライナー") {
      const official = skylinerTimetable.get(departure.departureTime);
      if (!official) {
        const { arrivalInfo, serviceNumber, ...withoutUnmatchedArrivalInfo } = departure;
        return withoutUnmatchedArrivalInfo;
      }
      return {
        ...departure,
        serviceNumber: official.serviceNumber,
        arrivalInfo: official.arrivalInfo,
      };
    }
    return departure;
  });
}

function parseJrPage(html, pageUrl, forcedTrainType) {
  const departures = [];
  for (const hourMatch of html.matchAll(/<tr id="time_(\d{1,2})">([\s\S]*?)<\/tr>/g)) {
    for (const train of hourMatch[2].matchAll(/<div class="timetable_time" data-train="([^"]*)"[\s\S]*?<a[^>]*href="([^"]+)"[\s\S]*?<span class="minute">(?:<span[^>]*>)?(\d{2})/g)) {
      const code = decodeHtml(train[1]);
      const departureTime = `${String(hourMatch[1]).padStart(2, "0")}:${train[3]}`;
      const trainType = forcedTrainType ?? (code.includes("NEX") ? "成田エクスプレス" : code.includes("快") ? "快速" : "普通");
      departures.push({
        _trainKey: train[2],
        _detailUrl: new URL(train[2], pageUrl).href,
        sourceId: "jr-nrt-t2",
        departureTime,
        trainType,
        destination: forcedTrainType === "成田エクスプレス" || code.includes("NEX") ? "新宿方面" : "東京方面",
      });
    }
  }
  return departures;
}

async function parseJr(daySuffix) {
  const listUrl = "https://timetables.jreast.co.jp/timetable/list0611.html";
  const listHtml = await fetchText(listUrl);
  const resolvePage = (pageId) => {
    const relative = listHtml.match(new RegExp(`href="([^"]*${pageId}0\\.html)"`))?.[1];
    if (!relative) throw new Error(`JR timetable page not found: ${pageId}`);
    return new URL(relative.replace(/0\.html$/, `${daySuffix}.html`), listUrl);
  };
  const naritaLineUrl = resolvePage("061102");
  const nexUrl = resolvePage("061104");
  const [naritaLine, nex] = await Promise.all([fetchText(naritaLineUrl), fetchText(nexUrl)]);
  const departures = [
    ...parseJrPage(naritaLine, naritaLineUrl),
    ...parseJrPage(nex, nexUrl, "成田エクスプレス"),
  ];
  const uniqueDepartures = [...new Map(departures.map((departure) => [
    `${departure.departureTime}/${departure.trainType}`,
    departure,
  ])).values()];
  const enriched = await inBatches(uniqueDepartures, 12, async (departure) => {
    const detail = await fetchText(departure._detailUrl);
    const { arrivalInfo, serviceNumber, destination } = parseJrTrainDetail(detail, ["東京"]);
    return {
      ...departure,
      ...(departure.trainType === "成田エクスプレス" && serviceNumber ? { serviceNumber } : {}),
      ...(departure.trainType === "成田エクスプレス" && destination ? { destination } : {}),
      ...(arrivalInfo.length ? { arrivalInfo } : {}),
    };
  });
  return enriched.map(({ _trainKey, _detailUrl, ...departure }) => departure);
}

async function parseBus() {
  const arrivalSchedule = JSON.parse(
    (await readFile(resolve(dataDir, "tyo-nrt-arrivals.json"), "utf8")).replace(/^\uFEFF/, ""),
  );
  return Object.entries(arrivalSchedule.arrivalsByDepartureTime).map(([departureTime, arrivalInfo]) => {
    const tokyoArrivalInfo = arrivalInfo.filter((arrival) => arrival.stationName === "東京駅");
    return {
      sourceId: "tyo-nrt-nrt-t2",
      departureTime,
      trainType: "バス",
      destination: arrivalInfo.some((arrival) => arrival.stationName === "銀座駅") ? "銀座駅" : "東京駅",
      operatorLabel: "エアポートバス東京・成田",
      ...(tokyoArrivalInfo.length ? { arrivalInfo: tokyoArrivalInfo } : {}),
    };
  });
}

function withIds(departures) {
  return departures
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
    .map((departure, index) => ({ id: departureId(departure.sourceId, departure.departureTime, index), ...departure }));
}

function metadata(placeId, serviceType, sources) {
  return {
    schemaVersion: 1,
    placeId,
    serviceType,
    version: "2026-06-official-snapshot",
    lastUpdated: snapshotDate,
    status: "manual",
    sources,
  };
}

async function writeSchedule(filename, metadataValue, departures) {
  await writeFile(resolve(dataDir, filename), `${JSON.stringify({ metadata: metadataValue, departures: withIds(departures) }, null, 2)}\n`, "utf8");
  console.log(`${filename}: ${departures.length}`);
}

const [hndWeekdayKeikyu, hndHolidayKeikyu, hndWeekdayMonorail, hndHolidayMonorail] = await Promise.all([
  parseKeikyu(0),
  parseKeikyu(2),
  parseMonorail(weekdayDate),
  parseMonorail(holidayDate),
]);
const [nrtWeekdayKeisei, nrtHolidayKeisei, nrtWeekdayJr, nrtHolidayJr, nrtBus] = await Promise.all([
  parseKeisei(0),
  parseKeisei(1),
  parseJr(0),
  parseJr(1),
  parseBus(),
]);

const sourceStatus = (sourceUrl) => ({
  status: "manual",
  version: "2026-06-official-snapshot",
  lastUpdated: snapshotDate,
  sourceUrl,
});

await writeSchedule(
  "hnd_t3_weekday.json",
  metadata("hnd-t3", "weekday", {
    "keikyu-hnd-t3": sourceStatus("https://norikae.keikyu.co.jp/transit/norikae/T5?USR=PC&dw=0&slCode=253-6&d=1"),
    "monorail-hnd-t3": sourceStatus(`https://train-cloud.navitime.biz/tokyo-monorail/railroads/timetables?station=00009590&directional-railroad=00000783-up&date=${weekdayDate}`),
  }),
  [...hndWeekdayKeikyu, ...hndWeekdayMonorail],
);
await writeSchedule(
  "hnd_t3_holiday.json",
  metadata("hnd-t3", "holiday", {
    "keikyu-hnd-t3": sourceStatus("https://norikae.keikyu.co.jp/transit/norikae/T5?USR=PC&dw=2&slCode=253-6&d=1"),
    "monorail-hnd-t3": sourceStatus(`https://train-cloud.navitime.biz/tokyo-monorail/railroads/timetables?station=00009590&directional-railroad=00000783-up&date=${holidayDate}`),
  }),
  [...hndHolidayKeikyu, ...hndHolidayMonorail],
);
await writeSchedule(
  "nrt_t2_weekday.json",
  metadata("nrt_t2", "weekday", {
    "keisei-mainline-nrt-t2": sourceStatus("https://keisei.ekitan.com/search/timetable/station/254-41/d1?dw=0"),
    "keisei-access-nrt-t2": sourceStatus("https://keisei.ekitan.com/search/timetable/station/682-6/d1?dw=0"),
    "jr-nrt-t2": sourceStatus("https://timetables.jreast.co.jp/timetable/list0611.html"),
    "tyo-nrt-nrt-t2": sourceStatus("https://tyo-nrt.com/wp/wp-content/themes/tyo-nrt/files/timetable_new_horizon.pdf"),
  }),
  [...nrtWeekdayKeisei, ...nrtWeekdayJr, ...nrtBus],
);
await writeSchedule(
  "nrt_t2_holiday.json",
  metadata("nrt_t2", "holiday", {
    "keisei-mainline-nrt-t2": sourceStatus("https://keisei.ekitan.com/search/timetable/station/254-41/d1?dw=1"),
    "keisei-access-nrt-t2": sourceStatus("https://keisei.ekitan.com/search/timetable/station/682-6/d1?dw=1"),
    "jr-nrt-t2": sourceStatus("https://timetables.jreast.co.jp/timetable/list0611.html"),
    "tyo-nrt-nrt-t2": sourceStatus("https://tyo-nrt.com/wp/wp-content/themes/tyo-nrt/files/timetable_new_horizon.pdf"),
  }),
  [...nrtHolidayKeisei, ...nrtHolidayJr, ...nrtBus],
);

const catalog = JSON.parse(await readFile(resolve(dataDir, "catalog.json"), "utf8"));
catalog.metadata.version = "2026-06-official-snapshot";
catalog.metadata.lastUpdated = snapshotDate;
catalog.dataNote = "公式時刻表を参照して2026-06-14に作成したローカル実データスナップショットです。運行変更・遅延は反映されません。";
catalog.places.nrt_t2.sources = [
  "keisei-access-nrt-t2",
  "keisei-mainline-nrt-t2",
  "jr-nrt-t2",
  "tyo-nrt-nrt-t2",
];
catalog.sources["keikyu-hnd-t3"].defaultFilter.trainTypes = [
  "エアポート快特",
  "快特",
  "特急",
  "急行",
];
catalog.sources["keikyu-hnd-t3"].defaultFilter.destinations = [
  "品川",
  "青砥",
  "押上",
  "泉岳寺",
  "京成高砂",
  "京成佐倉",
  "成田空港",
  "印旛日本医大",
  "印西牧の原",
  "成田スカイアクセス線経由成田空港",
  "京成成田",
  "芝山千代田",
  "宗吾参道",
];
Object.assign(catalog.sources["keikyu-hnd-t3"], {
  displayName: "京急線　羽田空港第3ターミナル駅",
  shortName: "京急線",
});
Object.assign(catalog.sources["monorail-hnd-t3"], {
  displayName: "東京モノレール　羽田空港第3ターミナル駅",
  shortName: "東京モノレール",
  trainTypeCategories: {
    空港快速: "monorail-airport-rapid",
    区間快速: "monorail-section-rapid",
    普通: "local-rail",
  },
});
catalog.sources["tyo-nrt-nrt-t2"] = {
  id: "tyo-nrt-nrt-t2",
  operator: "エアポートバス東京・成田",
  operatorLabel: "エアポートバス東京・成田",
  line: "成田空港－東京駅",
  stationName: "成田空港第2ターミナル6番",
  defaultEnabled: true,
  color: "#0f766e",
  defaultFilter: {},
  referenceStops: { "*": ["東京駅"] },
  trainTypeCategories: { バス: "airport-bus" },
};
delete catalog.sources["keisei-nrt-t2"];
catalog.sources["keisei-access-nrt-t2"] = {
  id: "keisei-access-nrt-t2",
  operator: "京成",
  line: "成田スカイアクセス線",
  stationName: "空港第2ビル駅",
  displayName: "成田スカイアクセス線　空港第2ビル駅",
  shortName: "成田スカイアクセス線",
  defaultEnabled: true,
  color: "#e53935",
  defaultFilter: {
    trainTypes: ["スカイライナー", "アクセス特急"],
  },
  referenceStops: {
    スカイライナー: ["日暮里"],
    アクセス特急: ["押上", "日本橋", "日暮里"],
  },
  trainTypeCategories: {
    スカイライナー: "keisei-skyliner",
    アクセス特急: "keisei-access",
    快速特急: "keisei-mainline",
    通勤特急: "keisei-mainline",
    特急: "keisei-mainline",
    快速: "local-rail",
    普通: "local-rail",
    モーニングライナー: "keisei-skyliner",
    イブニングライナー: "keisei-skyliner",
  },
};
catalog.sources["keisei-mainline-nrt-t2"] = {
  id: "keisei-mainline-nrt-t2",
  operator: "京成",
  line: "京成本線",
  stationName: "空港第2ビル駅",
  displayName: "京成本線　空港第2ビル駅",
  shortName: "京成本線",
  defaultEnabled: true,
  color: "#e53935",
  defaultFilter: {
    trainTypes: ["快速特急", "特急", "通勤特急", "モーニングライナー"],
  },
  referenceStops: {
    "*": ["押上", "日本橋", "日暮里"],
  },
  trainTypeCategories: {
    快速特急: "keisei-mainline",
    通勤特急: "keisei-mainline",
    特急: "keisei-mainline",
    快速: "local-rail",
    普通: "local-rail",
    モーニングライナー: "keisei-skyliner",
    イブニングライナー: "keisei-skyliner",
  },
};
Object.assign(catalog.sources["jr-nrt-t2"], {
  displayName: "JR成田線　空港第2ビル駅",
  shortName: "JR成田線",
  defaultFilter: {
    trainTypes: ["成田エクスプレス"],
  },
  referenceStops: {
    "*": ["東京"],
    成田エクスプレス: ["東京"],
  },
});
Object.assign(catalog.sources["tyo-nrt-nrt-t2"], {
  displayName: "エアポートバス東京・成田　成田空港第2ターミナル6番",
  shortName: "エアポートバス東京・成田",
  referenceStops: {
    "*": ["東京駅"],
  },
});
catalog.displayCategories["airport-bus"] = { label: "エアポートバス東京・成田" };
delete catalog.displayCategories["monorail-rapid"];
catalog.displayCategories["monorail-airport-rapid"] = { label: "東京モノレール 空港快速" };
catalog.displayCategories["monorail-section-rapid"] = { label: "東京モノレール 区間快速" };
await writeFile(resolve(dataDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
