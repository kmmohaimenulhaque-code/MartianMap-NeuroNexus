/* Marswalk API client. Every call can be cancelled with an AbortSignal (stale drags are dropped). */

const API = "/api";

async function request(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    signal,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.reason ?? payload?.detail ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.hint = payload?.hint;
    throw error;
  }
  return payload;
}

const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)).toString();

export const marswalkApi = {
  config: (opts) => request("/marswalk/config", opts),
  plan: (body, opts = {}) => request("/marswalk/plan", { ...opts, method: "POST", body }),
  evaluate: (body, opts = {}) => request("/marswalk/evaluate", { ...opts, method: "POST", body }),
  brief: (planId, opts) => request(`/marswalk/brief/${planId}`, opts),
  briefHtmlUrl: (planId) => `${API}/marswalk/brief/${planId}?format=html`,
  roverLatest: (rover, opts) => request(`/rovers/${rover}/latest`, opts),
  roverWaypoints: (rover, opts) => request(`/rovers/${rover}/waypoints`, opts),
  roverTraverse: (rover, maxVertices = 4000, opts) => request(`/rovers/${rover}/traverse?${qs({ max_vertices: maxVertices })}`, opts),
  window: (frame, mode, layers, gridMax = 256, opts) =>
    request(`/terrain/hires/window?${qs({ lat: frame.lat, lon: frame.lon, half_width_m: frame.halfWidth, res_m: frame.res, mode, layers, grid_max: gridMax })}`, opts),
  imageUrl: (frame, mode, layer, maxSide = 1500) =>
    `${API}/terrain/hires/image?${qs({ layer, lat: frame.lat, lon: frame.lon, half_width_m: frame.halfWidth, res_m: frame.res, mode, max_side: maxSide })}`,
  conditions: (site, opts) => request(`/conditions?${qs({ site })}`, opts),
  validation: (opts) => request("/validation/latest", opts),
  dataStatus: (opts) => request("/data/status", opts),
};
