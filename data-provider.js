const CATALOG_URL = "./data/catalog.json";

let catalogPromise;

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return response.json();
}

async function getCatalog() {
  catalogPromise ??= loadJson(new URL(CATALOG_URL, document.baseURI));
  return catalogPromise;
}

function assertScheduleMetadata(schedule, placeId, serviceType) {
  if (schedule.metadata?.placeId !== placeId) throw new Error(`Schedule placeId mismatch: ${placeId}`);
  if (schedule.metadata?.serviceType !== serviceType) throw new Error(`Schedule serviceType mismatch: ${serviceType}`);
  if (!Array.isArray(schedule.departures)) throw new Error("Schedule departures must be an array");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function selectedValues(savedValues, defaultValues, candidates) {
  const requested = Array.isArray(savedValues)
    ? savedValues
    : Array.isArray(defaultValues)
      ? defaultValues
      : candidates;
  return requested.filter((value) => candidates.includes(value));
}

function resolveFilters(sources, departures, userFilters = {}) {
  return Object.fromEntries(
    Object.values(sources).map((source) => {
      const sourceDepartures = departures.filter((departure) => departure.sourceId === source.id);
      const candidates = {
        trainTypes: unique(sourceDepartures.map((departure) => departure.trainType)),
        destinations: unique(sourceDepartures.map((departure) => departure.destination)),
      };
      const saved = userFilters[source.id];
      const defaults = source.defaultFilter ?? {};
      const filter = {
        enabled: typeof saved?.enabled === "boolean" ? saved.enabled : source.defaultEnabled !== false,
        trainTypes: selectedValues(saved?.trainTypes, defaults.trainTypes, candidates.trainTypes),
        destinations: selectedValues(saved?.destinations, defaults.destinations, candidates.destinations),
      };
      return [source.id, { candidates, filter }];
    }),
  );
}

function matchesFilter(departure, filter) {
  return (
    filter.enabled &&
    filter.trainTypes.includes(departure.trainType) &&
    filter.destinations.includes(departure.destination)
  );
}

function sourceDisplayName(source) {
  if (source.displayName) return source.displayName;
  if (source.line && source.stationName) return `${source.line}　${source.stationName}`;
  if (source.operator && source.stationName) return `${source.operator}　${source.stationName}`;
  return source.operator;
}

export async function getPlaces() {
  const catalog = await getCatalog();
  return Object.values(catalog.places ?? {}).map(({ id, name }) => ({ id, name }));
}

export async function getPlaceConfig(placeId) {
  const catalog = await getCatalog();
  const place = catalog.places[placeId];
  if (!place) throw new Error(`Unknown placeId: ${placeId}`);

  const sources = Object.fromEntries(
    place.sources
      .map((sourceId) => catalog.sources[sourceId])
      .filter(Boolean)
      .map((source) => [source.id, source]),
  );
  const serviceTypes = (catalog.serviceTypes ?? [])
    .filter((serviceType) => place.schedules?.[serviceType.id])
    .map((serviceType) => ({ ...serviceType }));

  return {
    place,
    sources,
    serviceTypes,
    displayCategories: catalog.displayCategories ?? {},
    dataNote: catalog.dataNote,
  };
}

export async function getDepartures(placeId, serviceType, userFilters = {}) {
  const catalog = await getCatalog();
  const place = catalog.places[placeId];
  const schedulePath = place?.schedules?.[serviceType];
  if (!schedulePath) throw new Error(`No ${serviceType} schedule configured for ${placeId}`);

  const catalogUrl = new URL(CATALOG_URL, document.baseURI);
  const schedule = await loadJson(new URL(schedulePath, catalogUrl));
  assertScheduleMetadata(schedule, placeId, serviceType);

  const sources = Object.fromEntries(
    place.sources
      .map((sourceId) => catalog.sources[sourceId])
      .filter(Boolean)
      .map((source) => [source.id, source]),
  );
  const allDepartures = schedule.departures
    .filter((departure) => sources[departure.sourceId])
    .map((departure) => ({
      ...departure,
      operator: sources[departure.sourceId].operator,
      sourceDisplayName: sourceDisplayName(sources[departure.sourceId]),
      operatorLabel:
        departure.operatorLabel ??
        sources[departure.sourceId].operatorLabel ??
        sources[departure.sourceId].operator,
      line: sources[departure.sourceId].line,
      displayCategory:
        departure.displayCategory ??
        sources[departure.sourceId].trainTypeCategories?.[departure.trainType] ??
        "default",
      source: sources[departure.sourceId],
    }));
  const filterState = resolveFilters(sources, allDepartures, userFilters);

  return {
    metadata: schedule.metadata,
    allDepartures,
    departures: allDepartures.filter((departure) =>
      matchesFilter(departure, filterState[departure.sourceId].filter),
    ),
    filterState,
  };
}
