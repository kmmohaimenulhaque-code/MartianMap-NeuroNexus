/*
 * Sharp basemap under compared routes. The global JPEG is 4 px per degree, so a 30 km route spans ~2 px of it.
 * The Esri OnMars colour DEM (MOLA + HRSC, the ArcGIS map's basemap) is cached to level 7 (~364 px/deg) in
 * 512 px tiles from (-180, 90); its levels do not match Leaflet's zoom scale, so each tile is an image overlay.
 */
const COLOR_DEM_TILES = "https://astro.arcgis.com/arcgis/rest/services/OnMars/MColorDEM/MapServer/tile";
const COLOR_DEM_DEG_PER_PX_L0 = 360 / 1024;
const COLOR_DEM_MAX_LEVEL = 7;
const COLOR_DEM_MAX_TILES = 16;

/* Tiles ({url, bounds} in this map's lat / east-0-360 frame) covering points ([lat, lon 0-360]) plus a margin. */
// The 1.5 deg margin covers the comparison map's whole view at its zoom 9.
export function colorDemTiles(points, marginDeg = 1.5) {
  if (!points?.length) return [];
  const lats = points.map((p) => Number(p[0]));
  const lons = points.map((p) => Number(p[1]));
  const south = Math.max(-90, Math.min(...lats) - marginDeg);
  const north = Math.min(90, Math.max(...lats) + marginDeg);
  const west = Math.min(...lons) - marginDeg;
  const east = Math.max(...lons) + marginDeg;
  if (east - west > 180) return []; // shortcut: routes across the 0/360 seam keep the global basemap; split the box if one ever does
  for (let level = COLOR_DEM_MAX_LEVEL; level >= 0; level -= 1) {
    const span = COLOR_DEM_DEG_PER_PX_L0 * 512 / 2 ** level;
    const toCol = (lon) => Math.floor((((lon + 180) % 360) + 360) % 360 / span); // tiles start at -180; 0-360 east wraps in
    const row0 = Math.floor((90 - north) / span);
    const row1 = Math.floor((90 - south) / span - 1e-9);
    const col0 = toCol(west);
    const cols = Math.floor((east - west) / span) + 2;
    if ((row1 - row0 + 1) * cols > COLOR_DEM_MAX_TILES) continue;
    const tiles = [];
    for (let r = row0; r <= row1; r += 1)
      for (let i = 0; i < cols; i += 1) {
        const c = (col0 + i) % Math.round(360 / span);
        const w = ((-180 + c * span) % 360 + 360) % 360;
        if (w > east || w + span < west) continue;
        tiles.push({ url: `${COLOR_DEM_TILES}/${level}/${r}/${c}`, bounds: [[90 - (r + 1) * span, w], [90 - r * span, w + span]] });
      }
    return tiles;
  }
  return [];
}
