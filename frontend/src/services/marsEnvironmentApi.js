const API_BASE = "/api";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    try {
      const body = await response.json();

      if (body?.detail) {
        message = body.detail;
      }
    } catch {
      // Keep the HTTP status message.
    }

    throw new Error(message);
  }

  return response.json();
}

function normaliseLongitude(longitude) {
  return ((Number(longitude) % 360) + 360) % 360;
}

export async function fetchPlaces(limit = 2052) {
  return fetchJson(`${API_BASE}/places?limit=${encodeURIComponent(limit)}`);
}

export async function fetchPlaceSuggestions(query, limit = 8) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });

  return fetchJson(`${API_BASE}/places/suggest?${params}`);
}

export async function fetchEnvironmentByPlace(name, sol) {
  const params = new URLSearchParams({
    name,
    sol: String(sol),
  });

  return fetchJson(`${API_BASE}/environment/by-place?${params}`);
}

export async function fetchEnvironmentByCoordinate(latitude, longitude, sol) {
  const params = new URLSearchParams({
    latitude: String(Number(latitude)),

    longitude: String(normaliseLongitude(longitude)),

    sol: String(Number(sol)),
  });

  return fetchJson(`${API_BASE}/environment?${params.toString()}`);
}

export async function fetchTerrainMetadata() {
  return fetchJson(`${API_BASE}/terrain/metadata`);
}

export async function fetchRoutePlan(points) {
  return fetchJson(`${API_BASE}/terrain/route-plan`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      points: points.map((point) => ({
        latitude_deg: Number(point.latitude_deg),

        longitude_deg: normaliseLongitude(point.longitude_deg),

        label: point.label ?? "WAYPOINT",
      })),
    }),
  });
}

export async function fetchRoverPhotos(name, limit = 8) {
  const params = new URLSearchParams({
    name,
    limit: String(limit),
  });

  return fetchJson(`${API_BASE}/media/rover-photos?${params}`);
}

/* ------------------------------------------------------------------
 * NeuroNexus v2 subsystems
 *   /routes   deterministic multi-objective route engine
 *   /usgs     ArcGIS synchronisation + scientific route snapshot
 *   /orbital  near-Mars small-body tracking (NASA/JPL)
 *   /ai       server-side Gemini (the API key never reaches the browser)
 * ------------------------------------------------------------------ */

function routePoint(point, label = null) {
  return {
    latitude_deg: Number(point.latitude_deg),
    longitude_deg: normaliseLongitude(point.longitude_deg),
    label: point.label ?? label ?? undefined,
  };
}

function postJson(path, body) {
  return fetchJson(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchRouteMethodology() {
  return fetchJson(`${API_BASE}/routes/methodology`);
}

export async function generateRouteCandidates({
  start,
  destination,
  weights,
  evaPaceKmh,
  ascentAllowanceMPerH,
  safeHavens = [],
  includeScience = true,
}) {
  return postJson("/routes/candidates", {
    start: routePoint(start, "START"),
    destination: routePoint(destination, "DESTINATION"),
    weights,
    eva_pace_kmh: evaPaceKmh,
    ascent_allowance_m_per_h: ascentAllowanceMPerH,
    safe_havens: safeHavens.map((haven) => ({ ...routePoint(haven), id: haven.id, name: haven.name })),
    include_science: includeScience,
  });
}

export async function evaluateRoute({ coordinates, evaPaceKmh, ascentAllowanceMPerH, safeHavens = [], includeScience = true }) {
  return postJson("/routes/evaluate", {
    coordinates: coordinates.map((point) => routePoint(point)),
    eva_pace_kmh: evaPaceKmh,
    ascent_allowance_m_per_h: ascentAllowanceMPerH,
    safe_havens: safeHavens.map((haven) => ({ ...routePoint(haven), id: haven.id, name: haven.name })),
    include_science: includeScience,
  });
}

export async function fetchUsgsSync(latitude, longitude, halfWidthKm = 40) {
  const params = new URLSearchParams({
    latitude: String(Number(latitude)),
    longitude: String(normaliseLongitude(longitude)),
    half_width_km: String(halfWidthKm),
  });
  return fetchJson(`${API_BASE}/usgs/sync?${params}`);
}

export async function fetchUsgsRouteSnapshot(route) {
  return postJson("/usgs/route-snapshot", {
    route_id: route.id ?? route.route_id ?? null,
    name: route.name ?? null,
    coordinates: (route.coordinates ?? route.points ?? []).map((point) => routePoint(point)),
    metrics: route.metrics ?? null,
    objective_weights: route.objective_weights ?? null,
    generation_method: route.generation_method ?? null,
    eva: route.eva ?? null,
    provenance: route.provenance ?? null,
  });
}

export async function fetchOrbitalTracking({ days = 365, distMaxAu = 0.05, limit = 50 } = {}) {
  const params = new URLSearchParams({ days: String(days), dist_max_au: String(distMaxAu), limit: String(limit) });
  return fetchJson(`${API_BASE}/orbital/mars-close-approaches?${params}`);
}

export async function fetchAiStatus() {
  return fetchJson(`${API_BASE}/ai/status`);
}

export async function fetchProvenanceLedger() {
  return fetchJson(`${API_BASE}/ai/provenance`);
}

export async function askMarsIntelligence({ messages, missionState, enableSearch = false }) {
  return postJson("/ai/chat", { messages, mission_state: missionState ?? {}, enable_search: enableSearch });
}

export async function requestRouteAnalysis(payload) {
  return postJson("/ai/route-analysis", payload);
}

/* ------------------------------------------------------------------
 * 3D Mars view data (/mars3d): rover traverses, bounded local MOLA grid,
 * documented exploration context.
 * ------------------------------------------------------------------ */

export async function fetchMars3dTraverses() {
  return fetchJson(`${API_BASE}/mars3d/traverses`);
}

export async function fetchMars3dTerrainGrid(latitude, longitude, halfWidthKm = 20) {
  const params = new URLSearchParams({
    latitude: String(Number(latitude)),
    longitude: String(normaliseLongitude(longitude)),
    half_width_km: String(halfWidthKm),
  });
  return fetchJson(`${API_BASE}/mars3d/terrain-grid?${params}`);
}

export async function fetchMars3dContext() {
  return fetchJson(`${API_BASE}/mars3d/context`);
}

export async function fetchMars3dExplorationZones(site = null) {
  const params = new URLSearchParams();
  if (site) {
    params.set("latitude", String(Number(site.latitude_deg)));
    params.set("longitude", String(normaliseLongitude(site.longitude_deg)));
  }
  const query = params.toString();
  return fetchJson(`${API_BASE}/mars3d/exploration-zones${query ? `?${query}` : ""}`);
}
