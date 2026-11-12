import { openNeuronexusDb } from "../perf/tileCache";

/*
 * Saved route records (schema v4) and comparison metrics.
 * v4 adds resolution_ladder, data_versions, config_hash and source_ids (reproducibility, T3.7).
 *
 * A saved route has one colour, one name and one stats record shared by the
 * 2D map, the 3D globe, the comparison workspace, snapshots and exports.
 * Stats come from the deterministic along-track evaluation (POST
 * /routes/evaluate). Until that arrives, waypoint-only numbers are shown and
 * labelled as such.
 */

export const ROUTE_COLOURS = ["#75e6ff", "#4ea8de", "#8cf0b1", "#3fbcd4", "#d8f6ff", "#a7d8ff", "#6fd3c1", "#b8f27a"];
export const STORAGE_KEY_V2 = "neuronexus.savedRoutes.v2";
export const STORAGE_KEY_V3 = "neuronexus.savedRoutes.v3";
export const STORAGE_KEY_V4 = "neuronexus.savedRoutes.v4";

/* Routes saved before v4 came from the global MOLA route engine. */
const LEGACY_PROVENANCE = {
  resolution_ladder: { mode: "mola", rungs: ["MOLA"], note: "global route engine on MOLA MEGDR 128 ppd" },
  data_versions: [{ product_id: "MGS-M-MOLA-5-MEGDR-L3-V1.0 (128 ppd)", ledger_id: "MOLA_MEGDR" }],
  source_ids: ["MOLA_MEGDR", "NN_ROUTE_ENGINE"],
};

export function geometryHash(points) {
  // FNV-1a over rounded coordinates: stable, fast, no crypto dependency.
  const text = points.map((p) => `${Number(p.latitude_deg).toFixed(5)},${Number(p.longitude_deg).toFixed(5)}`).join(";");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function routeColour(route) {
  return ROUTE_COLOURS[(route?.colourIndex ?? 0) % ROUTE_COLOURS.length];
}

export function upgradeRoute(route, index) {
  const points = route.points ?? [];
  return {
    ...route,
    schema: 4,
    colourIndex: route.colourIndex ?? index,
    geometryHash: route.geometryHash ?? geometryHash(points),
    // An evaluation interrupted by a reload is simply run again.
    evaluation: !route.evaluation || route.evaluation.status === "running" ? { status: "pending" } : route.evaluation,
    resolution_ladder: route.resolution_ladder ?? LEGACY_PROVENANCE.resolution_ladder,
    data_versions: route.data_versions ?? LEGACY_PROVENANCE.data_versions,
    config_hash: route.config_hash ?? null,
    source_ids: route.source_ids ?? LEGACY_PROVENANCE.source_ids,
  };
}

export function loadSavedRoutes(storage = globalThis.localStorage) {
  try {
    const v4 = JSON.parse(storage.getItem(STORAGE_KEY_V4) ?? "null");
    if (Array.isArray(v4)) return v4.map(upgradeRoute);
    const v3 = JSON.parse(storage.getItem(STORAGE_KEY_V3) ?? "null");
    if (Array.isArray(v3)) return v3.map(upgradeRoute);
    const v2 = JSON.parse(storage.getItem(STORAGE_KEY_V2) ?? "null");
    return Array.isArray(v2) ? v2.map(upgradeRoute) : [];
  } catch {
    return [];
  }
}

export function nextColourIndex(routes) {
  const used = new Set(routes.map((r) => r.colourIndex));
  for (let i = 0; i < ROUTE_COLOURS.length; i += 1) if (!used.has(i)) return i;
  return routes.length;
}

const triplet = (min, mean, max) => ({ min: min ?? null, mean: mean ?? null, max: max ?? null });

/* Map an /routes/evaluate response onto the v3 evaluation record. */
export function evaluationFromResponse(response) {
  const m = response?.metrics ?? {};
  return {
    status: response?.status === "ok" ? "ok" : "partial",
    evaluatedAt: new Date().toISOString(),
    error: response?.error ?? null,
    sampleCount: m.sample_count ?? null,
    sampleSpacingKm: m.sample_spacing_km ?? null,
    dataSupportPct: m.data_support_score ?? null,
    elevation_m: { ...triplet(m.elevation_min_m, m.mean_elevation_m, m.elevation_max_m), gain: m.elevation_gain_m ?? null, loss: m.elevation_loss_m ?? null },
    slope_deg: { ...triplet(m.min_slope_deg, m.mean_slope_deg, m.max_slope_deg), p90: m.p90_slope_deg ?? null },
    roughness_m: triplet(m.min_roughness_m, m.mean_roughness_m, m.max_roughness_m),
    distanceKm: m.distance_km ?? null,
    evaHours: m.estimated_eva_hours ?? null,
    terrainRisk: m.terrain_risk_proxy ?? null,
    terrainBurden: m.terrain_burden_score ?? null,
    maxFromSafeHavenKm: m.max_distance_from_safe_haven_km ?? null,
    segments: m.segment_count ?? 1,
    profile: m.profile ?? [],
  };
}

/* Waypoint-only fallback (3×3 samples at the clicked points, not the path). */
export function waypointStats(route) {
  const available = (route?.plan?.waypoint_analysis ?? []).filter((item) => item?.status === "available");
  const pick = (key) => available.map((item) => Number(item[key])).filter(Number.isFinite);
  const stat = (values) =>
    values.length ? triplet(Math.min(...values), values.reduce((a, b) => a + b, 0) / values.length, Math.max(...values)) : triplet();
  return {
    status: "waypoints-only",
    elevation_m: stat(pick("elevation_m")),
    slope_deg: stat(pick("slope_deg")),
    roughness_m: stat(pick("roughness_m")),
    distanceKm: route?.plan?.planned_route?.planned_route_km ?? null,
    sampleCount: available.length,
    profile: [],
  };
}

export function routeStats(route) {
  return route?.evaluation?.status === "ok" || route?.evaluation?.status === "partial" ? route.evaluation : waypointStats(route);
}

/*
 * Comparison rows. `better` drives best/worst marking: "lower", "higher" or
 * "none" (informational, e.g. elevation).
 */
export const COMPARISON_METRICS = [
  { key: "distance", label: "Distance", unit: "km", digits: 2, better: "lower", get: (s) => s.distanceKm },
  { key: "eva", label: "EVA time", unit: "h", digits: 2, better: "lower", get: (s) => s.evaHours },
  { key: "elev_min", label: "Elevation MIN", unit: "m", digits: 0, better: "none", get: (s) => s.elevation_m?.min },
  { key: "elev_mean", label: "Elevation MEAN", unit: "m", digits: 0, better: "none", get: (s) => s.elevation_m?.mean },
  { key: "elev_max", label: "Elevation MAX", unit: "m", digits: 0, better: "none", get: (s) => s.elevation_m?.max },
  { key: "gain", label: "Elevation gain", unit: "m", digits: 0, better: "lower", get: (s) => s.elevation_m?.gain },
  { key: "loss", label: "Elevation loss", unit: "m", digits: 0, better: "lower", get: (s) => s.elevation_m?.loss },
  { key: "slope_min", label: "Slope MIN", unit: "°", digits: 2, better: "none", get: (s) => s.slope_deg?.min },
  { key: "slope_mean", label: "Slope MEAN", unit: "°", digits: 2, better: "lower", get: (s) => s.slope_deg?.mean },
  { key: "slope_max", label: "Slope MAX", unit: "°", digits: 2, better: "lower", get: (s) => s.slope_deg?.max },
  { key: "slope_p90", label: "Slope p90", unit: "°", digits: 2, better: "lower", get: (s) => s.slope_deg?.p90 },
  { key: "rough_min", label: "Roughness MIN", unit: "m", digits: 1, better: "none", get: (s) => s.roughness_m?.min },
  { key: "rough_mean", label: "Roughness MEAN", unit: "m", digits: 1, better: "lower", get: (s) => s.roughness_m?.mean },
  { key: "rough_max", label: "Roughness MAX", unit: "m", digits: 1, better: "lower", get: (s) => s.roughness_m?.max },
  { key: "risk", label: "Terrain risk proxy", unit: "/100", digits: 1, better: "lower", get: (s) => s.terrainRisk },
  { key: "haven", label: "Max from Safe Haven", unit: "km", digits: 2, better: "lower", get: (s) => s.maxFromSafeHavenKm },
  { key: "support", label: "Data support", unit: "%", digits: 1, better: "higher", get: (s) => s.dataSupportPct },
];

/* { best: index|null, worst: index|null } for one metric across routes. */
export function rankMetric(metric, statsList) {
  if (metric.better === "none") return { best: null, worst: null };
  const values = statsList.map((s) => {
    const v = metric.get(s);
    return v === null || v === undefined ? null : Number(v);
  });
  const finite = values.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v));
  if (finite.length < 2) return { best: null, worst: null };
  const sorted = [...finite].sort((a, b) => (metric.better === "lower" ? a[0] - b[0] : b[0] - a[0]));
  if (sorted[0][0] === sorted[sorted.length - 1][0]) return { best: null, worst: null };
  return { best: sorted[0][1], worst: sorted[sorted.length - 1][1] };
}

export function comparisonToCsv(routes) {
  const header = ["route_id", "route_name", "metric", "value", "unit", "basis"];
  const rows = [header];
  routes.forEach((route) => {
    const stats = routeStats(route);
    const basis = stats.status === "waypoints-only" ? "waypoints only" : `along-track ${stats.sampleCount ?? "?"} samples @ ${stats.sampleSpacingKm ?? "?"} km`;
    COMPARISON_METRICS.forEach((metric) => rows.push([route.id, route.name, metric.label, metric.get(stats) ?? "", metric.unit, basis]));
  });
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/* ---------------------------------------------------------------- snapshot cache (IndexedDB) */

const STORE = "usgsSnapshots";

/* Shared with the Browser Optimization tile cache (database version 2 keeps every snapshot). */
const openDb = openNeuronexusDb;

export async function readSnapshot(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function writeSnapshot(key, value) {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
  } catch {
    // The cache is an optimisation only.
  }
}
