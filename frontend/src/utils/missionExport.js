/*
 * frontend/src/utils/missionExport.js
 *
 * COMPLETE mission export.
 *
 *   JSON  authoritative, lossless-ish mission record
 *   CSV   long-form flattening of the SAME mission JSON object
 *
 * The CSV is generated from the complete mission state, never from
 * routePlan.waypoint_analysis alone. Every scalar reachable in the mission
 * JSON becomes one row, so nested THEMIS observations, atmospheric gases,
 * rover metadata, AI candidates and tracking records can never be silently
 * dropped again.
 */

export const EXPORT_SCHEMA = "neuronexus.mission-export.v2";
export const CSV_COLUMNS = [
  "record_type",
  "record_id",
  "parent_id",
  "field",
  "value",
  "unit",
  "status",
  "source",
  "source_url",
  "timestamp",
  "latitude_deg",
  "longitude_deg",
];

const UNIT_RULES = [
  [/_km$|_km_s$/, (f) => (f.endsWith("_km_s") ? "km/s" : "km")],
  [/_m$/, () => "m"],
  [/_deg$/, () => "deg"],
  [/_k$/, () => "K"],
  [/_c$/, () => "degC"],
  [/_hours$|_h$/, () => "h"],
  [/_kmh$/, () => "km/h"],
  [/_ms$/, () => "ms"],
  [/_percent$|_pct$/, () => "%"],
  [/_au$/, () => "au"],
  [/_score$/, () => "score 0-100"],
  [/_m_per_h$/, () => "m/h"],
  [/_m_per_px$/, () => "m/px"],
  [/_days$/, () => "days"],
  [/_minutes$/, () => "min"],
  [/_seconds$/, () => "s"],
];

export function unitFor(field) {
  const name = String(field ?? "");
  for (const [pattern, resolve] of UNIT_RULES) {
    if (pattern.test(name)) {
      return resolve(name);
    }
  }
  return "";
}

/* RFC 4180 quoting: quotes doubled, fields containing quote/comma/CR/LF quoted. */
export function csvField(value) {
  if (value === null || value === undefined) {
    return "";
  }
  let text;
  if (Array.isArray(value)) {
    text = value.map((item) => (item === null || item === undefined ? "" : String(item))).join("; ");
  } else if (typeof value === "object") {
    text = JSON.stringify(value);
  } else if (typeof value === "number") {
    text = Number.isFinite(value) ? String(value) : "UNAVAILABLE";
  } else if (typeof value === "boolean") {
    text = value ? "TRUE" : "FALSE";
  } else {
    text = String(value);
  }
  if (/["\r\n,]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function csvRow(values) {
  return values.map(csvField).join(",");
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function coordinateOf(node) {
  if (!node || typeof node !== "object") {
    return {};
  }
  const latitude = node.latitude_deg ?? node.latitude ?? node.lat;
  const longitude = node.longitude_deg ?? node.longitude ?? node.lon ?? node.lng;
  const out = {};
  if (Number.isFinite(Number(latitude))) {
    out.latitude_deg = Number(latitude);
  }
  if (Number.isFinite(Number(longitude))) {
    out.longitude_deg = Number(longitude);
  }
  return out;
}

function contextOf(node, inherited) {
  if (!node || typeof node !== "object") {
    return inherited;
  }
  const coordinate = coordinateOf(node);
  return {
    status: node.status ?? node.evidence_status ?? node.tracking_status ?? inherited.status,
    source: node.source ?? node.dataset ?? node.provider ?? inherited.source,
    source_url: node.source_url ?? node.url ?? node.nasa_url ?? node.usgs_feature_url ?? node.sbdb_url ?? node.feed_url ?? inherited.source_url,
    timestamp:
      node.timestamp ?? node.observation_start ?? node.retrieved_at ?? node.createdAt ?? node.date_created ?? node.exported_at ?? inherited.timestamp,
    latitude_deg: coordinate.latitude_deg ?? inherited.latitude_deg,
    longitude_deg: coordinate.longitude_deg ?? inherited.longitude_deg,
  };
}

const CONTEXT_FIELDS = new Set(["status", "source", "source_url", "url", "timestamp", "evidence_status"]);

/*
 * Walk the mission JSON and emit one row per scalar. Arrays of objects become
 * child records so nested observations keep their own identity and parent link.
 */
export function flattenMission(mission, options = {}) {
  const maxDepth = options.maxDepth ?? 12;
  const rows = [];
  const seen = new WeakSet();

  function idFor(node, recordType, index) {
    if (node && typeof node === "object") {
      const explicit = node.id ?? node.record_id ?? node.route_id ?? node.product_id ?? node.nasa_id ?? node.designation ?? node.feature_name;
      if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
        return String(explicit);
      }
    }
    return `${recordType}-${index + 1}`;
  }

  function emit(recordType, recordId, parentId, field, value, context) {
    rows.push({
      record_type: recordType,
      record_id: recordId,
      parent_id: parentId ?? "",
      field,
      value,
      unit: unitFor(field),
      status: context.status ?? "",
      source: context.source ?? "",
      source_url: context.source_url ?? "",
      timestamp: context.timestamp ?? "",
      latitude_deg: context.latitude_deg ?? "",
      longitude_deg: context.longitude_deg ?? "",
    });
  }

  function walk(node, recordType, recordId, parentId, prefix, inherited, depth) {
    if (node === undefined) {
      return;
    }
    if (isScalar(node)) {
      emit(recordType, recordId, parentId, prefix || recordType, node, inherited);
      return;
    }
    if (depth > maxDepth || (typeof node === "object" && seen.has(node))) {
      emit(recordType, recordId, parentId, prefix || recordType, "[depth limit]", inherited);
      return;
    }
    seen.add(node);
    const context = contextOf(node, inherited);

    if (Array.isArray(node)) {
      if (!node.length) {
        emit(recordType, recordId, parentId, `${prefix || recordType}.count`, 0, context);
        return;
      }
      if (node.every(isScalar)) {
        node.forEach((item, index) => emit(recordType, recordId, parentId, `${prefix || recordType}[${index}]`, item, context));
        return;
      }
      node.forEach((item, index) => {
        if (isScalar(item)) {
          emit(recordType, recordId, parentId, `${prefix || recordType}[${index}]`, item, context);
          return;
        }
        const childType = `${recordType}.${prefix || "item"}`.replace(/\.$/, "");
        walk(item, childType, idFor(item, childType, index), recordId, "", context, depth + 1);
      });
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const field = prefix ? `${prefix}.${key}` : key;
      if (isScalar(value)) {
        if (CONTEXT_FIELDS.has(key) && !prefix) {
          emit(recordType, recordId, parentId, field, value, context);
        } else {
          emit(recordType, recordId, parentId, field, value, context);
        }
        continue;
      }
      if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) {
        const childType = `${recordType}.${key}`;
        value.forEach((item, index) => {
          if (isScalar(item)) {
            emit(recordType, recordId, parentId, `${field}[${index}]`, item, context);
            return;
          }
          walk(item, childType, idFor(item, childType, index), recordId, "", context, depth + 1);
        });
        continue;
      }
      walk(value, recordType, recordId, parentId, field, context, depth + 1);
    }
  }

  const sections = Object.entries(mission ?? {});
  for (const [key, value] of sections) {
    const recordType = key.toUpperCase();
    if (Array.isArray(value)) {
      walk(value, recordType, recordType, "", "", {}, 0);
    } else if (value && typeof value === "object") {
      walk(value, recordType, idFor(value, recordType, 0), "", "", {}, 0);
    } else {
      walk(value, recordType, recordType, "", key, {}, 0);
    }
  }
  return rows;
}

export function missionToCsv(mission, options = {}) {
  const rows = flattenMission(mission, options);
  const lines = [csvRow(CSV_COLUMNS), ...rows.map((row) => csvRow(CSV_COLUMNS.map((column) => row[column])))];
  const body = lines.join("\r\n");
  return options.bom === false ? body : `\uFEFF${body}`;
}

/*
 * Human-readable per-waypoint route CSV, kept alongside the complete export.
 * Works for the route editor, an AI candidate (full terrain-aware path when
 * present) or a saved route. Segment and cumulative distances are Haversine
 * on the 3396 km Mars sphere; per-waypoint terrain columns are filled only
 * when the route has been analysed (otherwise left blank, never invented).
 */
const ROUTE_RADIUS_KM = 3396.0;

function routeHaversineKm(a, b) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const dLat = toRad(b.latitude_deg) - toRad(a.latitude_deg);
  const dLon = toRad(((((Number(b.longitude_deg) - Number(a.longitude_deg)) % 360) + 540) % 360) - 180);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude_deg)) * Math.cos(toRad(b.latitude_deg)) * Math.sin(dLon / 2) ** 2;
  return 2 * ROUTE_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

export const ROUTE_CSV_COLUMNS = [
  "route_name",
  "route_id",
  "index",
  "label",
  "latitude_deg",
  "longitude_deg",
  "segment_km",
  "cumulative_km",
  "status",
  "elevation_m",
  "slope_deg",
  "aspect_deg",
  "roughness_m",
  "local_elevation_min_m",
  "local_elevation_max_m",
];

export function routeToCsv(route, options = {}) {
  const analysed = route?.waypoint_analysis ?? route?.plan?.waypoint_analysis ?? [];
  const geometry = route?.path_coordinates ?? route?.coordinates ?? route?.points ?? [];
  const points = analysed.length ? analysed : geometry;
  let cumulative = 0;
  const rows = points.map((row, index) => {
    const segment = index === 0 ? 0 : routeHaversineKm(points[index - 1], row);
    cumulative += segment;
    return csvRow([
      route?.name ?? "",
      route?.id ?? route?.route_id ?? "",
      index + 1,
      row.label ?? (index === 0 ? "START" : index === points.length - 1 ? "DESTINATION" : `WP ${index + 1}`),
      Number.isFinite(Number(row.latitude_deg)) ? Number(Number(row.latitude_deg).toFixed(6)) : "",
      Number.isFinite(Number(row.longitude_deg)) ? Number(Number(row.longitude_deg).toFixed(6)) : "",
      Number(segment.toFixed(4)),
      Number(cumulative.toFixed(4)),
      row.status ?? (analysed.length ? "" : "NOT ANALYSED"),
      row.elevation_m ?? "",
      row.slope_deg ?? "",
      row.aspect_deg ?? "",
      row.roughness_m ?? "",
      row.local_elevation_min_m ?? "",
      row.local_elevation_max_m ?? "",
    ]);
  });
  const body = [csvRow(ROUTE_CSV_COLUMNS), ...rows].join("\r\n");
  return options.bom === false ? body : `\uFEFF${body}`;
}

export function exportFilename(kind, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `neuronexus-${kind}-${stamp}.${extension}`;
}
