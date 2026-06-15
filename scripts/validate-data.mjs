import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const timePattern = /^(?:[01]\d|2[0-4]):[0-5]\d$/;
const categoryPattern = /^[a-z0-9-]+$/;
const arrivalTimeTypes = new Set(["arrival", "departure"]);
const arrivalSources = new Set(["train-detail", "station-timetable", "manual"]);
const arrivalConfidences = new Set(["matched", "probable", "manual"]);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requireValue(condition, message, errors) {
  if (!condition) errors.push(message);
}

function validateDeparture(departure, sourceIds, seenIds, label, errors) {
  requireValue(departure.id, `${label}: id is required`, errors);
  requireValue(!seenIds.has(departure.id), `${label}: duplicate id ${departure.id}`, errors);
  seenIds.add(departure.id);
  requireValue(sourceIds.has(departure.sourceId), `${label}: unknown sourceId`, errors);
  requireValue(timePattern.test(departure.departureTime), `${label}: invalid departureTime`, errors);
  requireValue(departure.trainType, `${label}: trainType is required`, errors);
  requireValue(departure.destination, `${label}: destination is required`, errors);
  requireValue(
    departure.operatorLabel === undefined || typeof departure.operatorLabel === "string",
    `${label}: operatorLabel must be a string when present`,
    errors,
  );
  requireValue(
    departure.serviceNumber === undefined || typeof departure.serviceNumber === "string",
    `${label}: serviceNumber must be a string when present`,
    errors,
  );
  requireValue(
    departure.displayCategory === undefined || categoryPattern.test(departure.displayCategory),
    `${label}: displayCategory must use lowercase letters, numbers, and hyphens`,
    errors,
  );
  for (const field of ["routeName", "trackGroup", "platform", "via"]) {
    requireValue(
      departure[field] === undefined || typeof departure[field] === "string",
      `${label}: ${field} must be a string when present`,
      errors,
    );
  }

  for (const [index, arrival] of (departure.arrivalInfo ?? []).entries()) {
    requireValue(arrival.stationName, `${label}: arrivalInfo[${index}] stationName is required`, errors);
    const arrivalTime = arrival.arrivalTime ?? arrival.time;
    requireValue(
      timePattern.test(arrivalTime),
      `${label}: arrivalInfo[${index}] has invalid arrivalTime/time`,
      errors,
    );
    requireValue(
      arrivalTimeTypes.has(arrival.timeType),
      `${label}: arrivalInfo[${index}] has invalid timeType`,
      errors,
    );
    requireValue(
      arrivalSources.has(arrival.source),
      `${label}: arrivalInfo[${index}] has invalid source`,
      errors,
    );
    requireValue(
      arrivalConfidences.has(arrival.confidence),
      `${label}: arrivalInfo[${index}] has invalid confidence`,
      errors,
    );
    if (["スカイライナー", "成田エクスプレス"].includes(departure.trainType)) {
      requireValue(
        departure.serviceNumber,
        `${label}: ${departure.trainType} arrivalInfo requires serviceNumber`,
        errors,
      );
      requireValue(
        ["train-detail", "station-timetable"].includes(arrival.source) && arrival.confidence === "matched",
        `${label}: ${departure.trainType} arrivalInfo must be detail/timetable matched`,
        errors,
      );
    }
  }
}

function validateSourceMetadata(metadataSources, sourceIds, label, errors) {
  for (const [sourceId, metadata] of Object.entries(metadataSources ?? {})) {
    requireValue(sourceIds.has(sourceId), `${label}: metadata.sources has unknown ${sourceId}`, errors);
    requireValue(metadata.status, `${label}: metadata.sources.${sourceId}.status is required`, errors);
    requireValue(metadata.version, `${label}: metadata.sources.${sourceId}.version is required`, errors);
    requireValue(
      metadata.lastUpdated,
      `${label}: metadata.sources.${sourceId}.lastUpdated is required`,
      errors,
    );
    requireValue(
      metadata.sourceUrl === undefined || typeof metadata.sourceUrl === "string",
      `${label}: metadata.sources.${sourceId}.sourceUrl must be a string when present`,
      errors,
    );
  }
}

const catalog = await readJson(resolve(dataDir, "catalog.json"));
const sourceIds = new Set(Object.keys(catalog.sources ?? {}));
const serviceTypeIds = new Set((catalog.serviceTypes ?? []).map((serviceType) => serviceType.id));
const displayCategoryIds = new Set(Object.keys(catalog.displayCategories ?? {}));
const errors = [];
let departureCount = 0;

requireValue(serviceTypeIds.size > 0, "catalog: serviceTypes must not be empty", errors);
requireValue(
  serviceTypeIds.size === (catalog.serviceTypes ?? []).length,
  "catalog: duplicate serviceType id",
  errors,
);
for (const serviceType of catalog.serviceTypes ?? []) {
  requireValue(serviceType.label, `catalog: serviceType ${serviceType.id} label is required`, errors);
}

requireValue(displayCategoryIds.has("default"), "catalog: default displayCategory is required", errors);
for (const [categoryId, category] of Object.entries(catalog.displayCategories ?? {})) {
  requireValue(categoryPattern.test(categoryId), `catalog: invalid displayCategory id ${categoryId}`, errors);
  requireValue(category.label, `catalog: displayCategory ${categoryId} label is required`, errors);
}

for (const [placeId, place] of Object.entries(catalog.places ?? {})) {
  requireValue(place.id === placeId, `${placeId}: place id does not match catalog key`, errors);
  const placeSourceIds = new Set(place.sources ?? []);
  for (const sourceId of place.sources ?? []) {
    requireValue(sourceIds.has(sourceId), `${placeId}: unknown source ${sourceId}`, errors);
  }

  for (const [serviceType, relativePath] of Object.entries(place.schedules ?? {})) {
    requireValue(serviceTypeIds.has(serviceType), `${placeId}: unknown serviceType ${serviceType}`, errors);
    const schedule = await readJson(resolve(dataDir, relativePath));
    const label = `${placeId}/${serviceType}`;
    requireValue(schedule.metadata?.placeId === placeId, `${label}: metadata.placeId mismatch`, errors);
    requireValue(
      schedule.metadata?.serviceType === serviceType,
      `${label}: metadata.serviceType mismatch`,
      errors,
    );
    validateSourceMetadata(schedule.metadata?.sources, sourceIds, label, errors);
    requireValue(Array.isArray(schedule.departures), `${label}: departures must be an array`, errors);

    const seenIds = new Set();
    for (const [index, departure] of (schedule.departures ?? []).entries()) {
      validateDeparture(departure, sourceIds, seenIds, `${label} departures[${index}]`, errors);
      requireValue(
        placeSourceIds.has(departure.sourceId),
        `${label} departures[${index}]: source does not belong to place`,
        errors,
      );
      departureCount += 1;
    }
  }
}

for (const [sourceId, source] of Object.entries(catalog.sources ?? {})) {
  requireValue(
    source.operatorLabel === undefined || typeof source.operatorLabel === "string",
    `${sourceId}: operatorLabel must be a string when present`,
    errors,
  );
  requireValue(
    source.displayName === undefined || typeof source.displayName === "string",
    `${sourceId}: displayName must be a string when present`,
    errors,
  );
  requireValue(
    source.shortName === undefined || typeof source.shortName === "string",
    `${sourceId}: shortName must be a string when present`,
    errors,
  );
  requireValue(typeof source.defaultEnabled === "boolean", `${sourceId}: defaultEnabled is required`, errors);
  requireValue(
    source.defaultFilter && typeof source.defaultFilter === "object",
    `${sourceId}: defaultFilter is required`,
    errors,
  );
  for (const [trainType, stations] of Object.entries(source.referenceStops ?? {})) {
    requireValue(
      Array.isArray(stations) && stations.every((station) => typeof station === "string"),
      `${sourceId}: referenceStops.${trainType} must be a string array`,
      errors,
    );
  }
  for (const [trainType, categoryId] of Object.entries(source.trainTypeCategories ?? {})) {
    requireValue(
      displayCategoryIds.has(categoryId),
      `${sourceId}: trainTypeCategories.${trainType} references unknown ${categoryId}`,
      errors,
    );
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Data validation passed: ${departureCount} departures`);
}
