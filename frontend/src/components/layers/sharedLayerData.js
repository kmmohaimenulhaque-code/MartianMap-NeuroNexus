/*
 * Data and drawing helpers shared by the three maps, so a layer looks the same everywhere:
 * the local MOLA terrain grid (slope, roughness, walkability), its color ramp, and feature colors.
 */
import { useEffect, useState } from "react";
import { fetchMars3dTerrainGrid } from "../../services/marsEnvironmentApi";
import { rampColor } from "../../marswalk/walkabilityRamp";

/* Green (low) -> amber -> red (high); the 3D globe uses the same stops. */
export function walkRamp(value, lo, hi) {
  const t = Math.max(0, Math.min(1, (Number(value) - lo) / (hi - lo || 1)));
  const r = Math.round(t < 0.5 ? 98 + t * 2 * (255 - 98) : 255);
  const g = Math.round(t < 0.5 ? 245 - t * 2 * (245 - 179) : 179 - (t - 0.5) * 2 * (179 - 100));
  const b = Math.round(t < 0.5 ? 154 - t * 2 * (154 - 71) : 71 + (t - 0.5) * 2 * (124 - 71));
  return [r, g, b];
}

/* Which cell value each grid heatmap shows, and its ramp range (high = red). */
export const GRID_LAYERS = {
  slope: { value: (c) => c.slope_deg, lo: 0, hi: 20, unit: "°" },
  roughness: { value: (c) => c.roughness_m, lo: 0, hi: 60, unit: " m" },
  walkability: { value: (c) => 100 - c.walkability, lo: 0, hi: 100, unit: "" },
};

export function featureColor(featureType = "") {
  const type = String(featureType).split(",")[0].trim();
  const colors = {
    Crater: "#b9cfd6", Vallis: "#72d9ff", Mons: "#4ea8de", Fossa: "#9fe3a8", Mensa: "#e7d06f", Planum: "#3fbcd4", Patera: "#ff718d",
    Chaos: "#75e6ff", Rupes: "#b9cfd6", Chasma: "#80aaff", Dorsum: "#c5a27b", Terra: "#f0c6a0", Planitia: "#9cc2b5",
  };
  return colors[type] ?? "#d5d9dc";
}

const lon360 = (lon) => ((Number(lon) % 360) + 360) % 360;
const gridCache = new Map(); // "lat,lon" -> promise (the same request the 3D globe makes)

export function loadTerrainGrid(lat, lon) {
  const key = `${Number(lat).toFixed(3)},${lon360(lon).toFixed(3)}`;
  if (!gridCache.has(key)) {
    const p = fetchMars3dTerrainGrid(lat, lon, 20).catch((error) => {
      gridCache.delete(key);
      throw error;
    });
    gridCache.set(key, p);
  }
  return { key, promise: gridCache.get(key) };
}

/* The local terrain grid around the selected site while any grid heatmap is on: { key, data, error }. */
export function useTerrainGrid(location, enabled) {
  const lat = location?.latitude_deg;
  const lon = location?.longitude_deg;
  const [state, setState] = useState({ key: "", data: null, error: "" });
  const want = enabled && lat != null && lon != null;
  const key = want ? `${Number(lat).toFixed(3)},${lon360(lon).toFixed(3)}` : "";
  useEffect(() => {
    if (!want) return undefined;
    let live = true;
    const { key: k, promise } = loadTerrainGrid(lat, lon);
    promise.then((data) => live && setState({ key: k, data, error: "" })).catch((error) => live && setState({ key: k, data: null, error: error.message }));
    return () => {
      live = false;
    };
  }, [want, lat, lon]);
  return state.key === key ? state : { key, data: null, error: "" };
}

/*
 * A regular cell grid drawn into a PNG data URL (one pixel per cell) with its bounds in 0-360 E longitudes,
 * for image overlays. Cells without a value stay transparent.
 */
export function gridImage(grid, layer) {
  const cells = grid?.cells ?? [];
  const spec = GRID_LAYERS[layer];
  if (!cells.length || !spec || typeof document === "undefined") return null;
  const step = grid.cell_size_deg;
  const lats = cells.map((c) => c.lat_min);
  const lons = cells.map((c) => lon360(c.lon_min));
  const lat0 = Math.min(...lats);
  const lon0 = Math.min(...lons);
  const ny = Math.round((Math.max(...lats) - lat0) / step) + 1;
  const nx = Math.round((Math.max(...lons) - lon0) / step) + 1;
  const canvas = document.createElement("canvas");
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(nx, ny);
  for (const c of cells) {
    const v = spec.value(c);
    if (v == null || !Number.isFinite(v)) continue;
    const x = Math.round((lon360(c.lon_min) - lon0) / step);
    const y = ny - 1 - Math.round((c.lat_min - lat0) / step);
    const [r, g, b] = walkRamp(v, spec.lo, spec.hi);
    const i = (y * nx + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL("image/png"), bounds: [[lat0, lon0], [lat0 + ny * step, lon0 + nx * step]] };
}

/*
 * The global MY34 dust frame as a PNG data URL (one pixel per 3° cell, log ramp 0 -> 2). Columns run 0-360 E;
 * roll180 re-orders them to -180..180 E for maps in that longitude convention (the ArcGIS views).
 */
export function dustImage(dust, stops, roll180 = false) {
  if (typeof document === "undefined" || !dust?.tau?.length) return null;
  const rows = dust.tau.length;
  const cols = dust.tau[0].length;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v = dust.tau[r][c];
      if (v == null) continue;
      ctx.fillStyle = rampColor((Math.log1p(v) / Math.log1p(2)) * 100, stops);
      ctx.fillRect(roll180 ? (c + cols / 2) % cols : c, rows - 1 - r, 1, 1); // data row 0 is the southernmost latitude
    }
  }
  return canvas.toDataURL("image/png");
}
