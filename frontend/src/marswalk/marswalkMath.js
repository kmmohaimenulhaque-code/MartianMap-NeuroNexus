/*
 * Client-side Marswalk math: exact ports of science/marswalk/eva_model.py (A6, A6b, A7) and the
 * LocalGrid projection, plus display-only decimation (LTTB, RDP; A10). The worker and the main
 * thread share this module, and a parity test checks it against the backend within 1e-6 relative.
 */

export const MARS_RADIUS_M = 3396190.0;
const TOBLER_K = 3.5;
const TOBLER_OFFSET = 0.05;
const DEG = Math.PI / 180;

export function toLocal(lat, lon, frame) {
  const dlon = ((((lon - frame.lon) % 360) + 540) % 360) - 180;
  return [MARS_RADIUS_M * Math.cos(frame.lat * DEG) * dlon * DEG, MARS_RADIUS_M * (lat - frame.lat) * DEG];
}

export function toLatLon(x, y, frame) {
  const lat = frame.lat + y / MARS_RADIUS_M / DEG;
  const lon = frame.lon + x / (MARS_RADIUS_M * Math.cos(frame.lat * DEG)) / DEG;
  return [lat, ((((lon + 180) % 360) + 360) % 360) - 180];
}

export function toblerSpeedKmh(thetaDeg, paceKmh) {
  const t = Math.tan(thetaDeg * DEG);
  return (paceKmh * Math.exp(-TOBLER_K * Math.abs(t + TOBLER_OFFSET))) / Math.exp(-TOBLER_K * TOBLER_OFFSET);
}

export function stepTime(ds, dz, v) {
  if (v.pace_model === "naismith") {
    return ds / (v.eva_pace_kmh / 3.6) + Math.max(dz, 0) / (v.ascent_allowance_m_per_h / 3600);
  }
  const theta = Math.atan2(dz, ds) / DEG;
  return ds / (toblerSpeedKmh(theta, v.eva_pace_kmh) / 3.6);
}

export function terrainFactor(roughness, v) {
  const frac = Number.isFinite(roughness) ? Math.min(roughness / v.walk_ref_roughness_m, 1) : 0;
  return v.terrain_factor_base + (v.terrain_factor_rough - v.terrain_factor_base) * frac;
}

export function metabolicRateW(speedMs, thetaDeg, eta, v) {
  const W = v.body_mass_kg;
  const L = v.suit_and_payload_mass_kg;
  const gamma = v.g_mars / v.g_earth;
  const G = 100 * Math.max(Math.tan(thetaDeg * DEG), 0);
  return 1.5 * W + gamma * (2.0 * (W + L) * (L / W) ** 2 + eta * (W + L) * (1.5 * speedMs ** 2 + 0.35 * speedMs * G));
}

export function consumables(energyJ, v) {
  const kcal = energyJ / 4184;
  const o2 = (energyJ / 1000 / v.o2_energy_equivalent_kj_per_l) * v.o2_density_kg_per_l;
  const water = (v.heat_rejected_by_water_fraction * energyJ) / (v.water_latent_heat_mj_per_kg * 1e6);
  const u = v.metabolic_uncertainty_fraction;
  const band = (x) => ({ value: x, low: x * (1 - u), high: x * (1 + u) });
  return { metabolic_kcal_est: band(kcal), o2_kg_est: band(o2), water_l_est: band(water) };
}

/* Same as eva_model.along_track: ds, dz, roughness are per-step arrays (Float32Array or Array). */
export function alongTrack(ds, dz, rough, v) {
  const n = ds.length;
  const tOut = new Float64Array(n);
  const tBack = new Float64Array(n);
  let eOut = 0;
  let eBack = 0;
  for (let i = 0; i < n; i += 1) {
    const d = ds[i];
    const z = Number.isFinite(dz[i]) ? dz[i] : 0;
    tOut[i] = stepTime(d, z, v);
    tBack[i] = stepTime(d, -z, v);
    const eta = terrainFactor(rough[i], v);
    const theta = Math.atan2(z, d) / DEG;
    eOut += metabolicRateW(d / tOut[i], theta, eta, v) * tOut[i];
    eBack += metabolicRateW(d / tBack[i], -theta, eta, v) * tBack[i];
  }
  return { tOut, tBack, eOut, eBack };
}

/* A7: first sample where outbound + walk-back time >= (1 - reserve) * T_EVA. */
export function turnaround(cum, tOut, tBack, evaH, reserve) {
  const usable = (1 - reserve) * evaH * 3600;
  let out = 0;
  let back = 0;
  let index = cum.length - 1;
  let reached = true;
  if (usable <= 0) return { index: 0, distance_m: 0, reached_target: false, usable_s: usable };
  for (let i = 1; i < cum.length; i += 1) {
    out += tOut[i - 1];
    back += tBack[i - 1];
    if (out + back >= usable) {
      index = i;
      reached = false;
      break;
    }
  }
  return { index, distance_m: cum[index], reached_target: reached, usable_s: usable };
}

export function evaluateProfile(ds, dz, rough, v) {
  const track = alongTrack(ds, dz, rough, v);
  const cum = new Float64Array(ds.length + 1);
  for (let i = 0; i < ds.length; i += 1) cum[i + 1] = cum[i] + ds[i];
  const tp = turnaround(cum, track.tOut, track.tBack, v.eva_duration_h, v.reserve_fraction);
  const outbound = track.tOut.reduce((a, b) => a + b, 0);
  const ret = track.tBack.reduce((a, b) => a + b, 0);
  return {
    length_m: cum[cum.length - 1],
    outbound_h: outbound / 3600,
    return_h: ret / 3600,
    margin_h: tp.usable_s / 3600 - (outbound + ret) / 3600,
    turnaround: tp,
    outbound: consumables(track.eOut, v),
    round_trip: consumables(track.eOut + track.eBack, v),
  };
}

/*
 * Sample a row-major display grid {values, rows, cols, x0, y0, step} at local (x, y): value[r][c] is
 * the pixel centered at (x0 + c * step, y0 - r * step). Bilinear, or nearest for class/source codes.
 * NaN (nodata) in any bilinear neighbor gives NaN: no filling across gaps.
 */
export function sampleGrid(grid, x, y, nearest = false) {
  const { rows, cols, x0, y0, step, values } = grid;
  const c = (x - x0) / step;
  const r = (y0 - y) / step;
  if (r < -0.5 || c < -0.5 || r > rows - 0.5 || c > cols - 0.5) return NaN;
  if (nearest) {
    const rr = Math.min(rows - 1, Math.max(0, Math.round(r)));
    const cc = Math.min(cols - 1, Math.max(0, Math.round(c)));
    return values[rr * cols + cc];
  }
  const r0 = Math.max(0, Math.min(rows - 2, Math.floor(r)));
  const c0 = Math.max(0, Math.min(cols - 2, Math.floor(c)));
  const fr = Math.min(1, Math.max(0, r - r0));
  const fc = Math.min(1, Math.max(0, c - c0));
  const v00 = values[r0 * cols + c0];
  const v01 = values[r0 * cols + c0 + 1];
  const v10 = values[(r0 + 1) * cols + c0];
  const v11 = values[(r0 + 1) * cols + c0 + 1];
  return v00 * (1 - fr) * (1 - fc) + v01 * (1 - fr) * fc + v10 * fr * (1 - fc) + v11 * fr * fc;
}

/* Window JSON layer -> flat Float32Array display grid (null -> NaN). */
export function displayGrid(windowJson, layer) {
  const nested = windowJson?.layers?.[layer]?.grid;
  const meta = windowJson?.display_grid;
  if (!nested || !meta) return null;
  const rows = nested.length;
  const cols = nested[0]?.length ?? 0;
  const values = new Float32Array(rows * cols);
  nested.forEach((row, r) => row.forEach((v, c) => (values[r * cols + c] = v == null ? NaN : v)));
  return { values, rows, cols, x0: meta.x0, y0: meta.y0, step: meta.step_m };
}

/* Densified along-track samples of a local polyline over the cached window grids. */
export function trackFromGrids(localPts, grids, step) {
  const pts = [localPts[0]];
  for (let i = 1; i < localPts.length; i += 1) {
    const [ax, ay] = localPts[i - 1];
    const [bx, by] = localPts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k += 1) pts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const elev = pts.map(([x, y]) => sampleGrid(grids.elevation, x, y));
  const cls = pts.map(([x, y]) => sampleGrid(grids.walk_class, x, y, true));
  const ds = new Float64Array(pts.length - 1);
  const dz = new Float64Array(pts.length - 1);
  const rough = new Float64Array(pts.length - 1).fill(NaN);
  for (let i = 1; i < pts.length; i += 1) {
    ds[i - 1] = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    dz[i - 1] = elev[i] - elev[i - 1];
  }
  return { pts, elev, cls, ds, dz, rough };
}

/* Largest-Triangle-Three-Buckets: display-only decimation of an (x, y) series to `threshold` points. */
export function lttb(xs, ys, threshold) {
  const n = xs.length;
  if (threshold >= n || threshold < 3) return Array.from({ length: n }, (_, i) => i);
  const out = [0];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i += 1) {
    const start = Math.floor((i + 1) * every) + 1;
    const end = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0;
    let avgY = 0;
    for (let j = start; j < end; j += 1) {
      avgX += xs[j];
      avgY += ys[j];
    }
    const count = Math.max(1, end - start);
    avgX /= count;
    avgY /= count;
    const rStart = Math.floor(i * every) + 1;
    const rEnd = Math.floor((i + 1) * every) + 1;
    let best = rStart;
    let bestArea = -1;
    for (let j = rStart; j < rEnd; j += 1) {
      const area = Math.abs((xs[a] - avgX) * (ys[j] - ys[a]) - (xs[a] - xs[j]) * (avgY - ys[a]));
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    out.push(best);
    a = best;
  }
  out.push(n - 1);
  return out;
}

/* Ramer-Douglas-Peucker on [[x, y], ...]; returns kept indices (display only). */
export function rdp(points, epsilon) {
  const n = points.length;
  if (n < 3) return points.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j <= i + 1) continue;
    const [ax, ay] = points[i];
    const [bx, by] = points[j];
    const dx = bx - ax;
    const dy = by - ay;
    const norm = Math.hypot(dx, dy);
    let best = -1;
    let bestD = -1;
    for (let k = i + 1; k < j; k += 1) {
      const px = points[k][0] - ax;
      const py = points[k][1] - ay;
      const d = norm > 0 ? Math.abs(px * dy - py * dx) / norm : Math.hypot(px, py);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (bestD > epsilon) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  const idx = [];
  keep.forEach((flag, i) => flag && idx.push(i));
  return idx;
}
