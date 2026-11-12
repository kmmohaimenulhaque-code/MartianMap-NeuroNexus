/*
 * One layer catalog shared by the three maps: the colored 2D map (Leaflet), the ArcGIS 2D view in the USGS
 * panel and the 3D globe. "map" rows are layers; `maps` lists which maps can draw each one, and toggling it on
 * any map toggles it on all of them (components/layers/layerStore.js). "link" rows point to where that
 * information lives (a panel or MARSWALK) instead of pretending it is a map layer. `opacity` marks overlays that
 * get an opacity slider; the value is shared by every map.
 */

export const MAPS = { "2d": "2D", arcgis: "ARCGIS", "3d": "3D" };
const ALL = ["2d", "arcgis", "3d"];

export const LAYER_CATEGORIES = [
  {
    id: "topography",
    label: "Topography and Elevation",
    layers: [
      { id: "mola", kind: "map", label: "MOLA 463 m colorized elevation", ledgerId: "MOLA_MEGDR", on: true, maps: ALL, opacity: 0.65 },
      { id: "imagery", kind: "map", label: "Viking MDIM 2.1 imagery", ledgerId: "NASA_PDS", on: true, maps: ["arcgis", "3d"] },
      { id: "terrain", kind: "map", label: "3D terrain relief (MOLA/HRSC 200 m DEM)", ledgerId: "MOLA_MEGDR", on: true, maps: ["3d"] },
      { id: "hiriseFootprints", kind: "map", label: "HiRISE 1 m DTM footprints (near site)", ledgerId: "HIRISE_STAC_DTM", on: false, maps: ALL },
      { id: "slope", kind: "map", label: "Slope heatmap · local MOLA 128 ppd (DERIVED)", ledgerId: "MOLA_MEGDR", on: false, maps: ALL, opacity: 0.55 },
      { id: "roughness", kind: "map", label: "Roughness heatmap · local MOLA 128 ppd (DERIVED)", ledgerId: "MOLA_MEGDR", on: false, maps: ALL, opacity: 0.55 },
      { id: "walkability", kind: "map", label: "Walkability heatmap · NeuroNexus terrain score (DERIVED)", ledgerId: "NN_WALKABILITY", on: false, maps: ALL, opacity: 0.55 },
      { id: "ctxRung", kind: "link", label: "CTX 20 m DTMs, slope and roughness at 1-463 m baselines", ledgerId: "CTX_STAC_DTM", action: "marswalk" },
    ],
  },
  {
    id: "geology",
    label: "Geology and Science Context",
    layers: [
      { id: "features", kind: "map", label: "IAU named features (2,052)", ledgerId: "USGS_IAU_GAZETTEER", on: true, maps: ALL },
      { id: "labels", kind: "map", label: "Persistent feature labels", ledgerId: "USGS_IAU_GAZETTEER", on: true, maps: ["3d"] },
      { id: "units", kind: "map", label: "USGS SIM 3292 geologic units", ledgerId: "USGS_SIM_3292_ARCGIS", on: false, maps: ["arcgis", "3d"], opacity: 0.4 },
      { id: "contacts", kind: "map", label: "SIM 3292 geologic contacts", ledgerId: "USGS_SIM_3292_ARCGIS", on: false, maps: ["arcgis", "3d"] },
      { id: "structures", kind: "map", label: "SIM 3292 geologic structures", ledgerId: "USGS_SIM_3292_ARCGIS", on: false, maps: ["arcgis", "3d"] },
      { id: "waypoints", kind: "map", label: "Rover waypoints, sized by IMU tilt", ledgerId: "MMGIS_MSL_WAYPOINTS", on: false, maps: ["2d", "arcgis"] },
      { id: "themisObs", kind: "map", label: "THEMIS thermal observations near the site", ledgerId: "THEMIS", on: false, maps: ALL },
      { id: "thermal", kind: "link", label: "THEMIS thermal heatmap (left panel)", ledgerId: "THEMIS", action: "thermal" },
      { id: "sim3292", kind: "link", label: "USGS geologic map web app (USGS panel)", ledgerId: "USGS_SIM_3292", action: "usgs" },
    ],
  },
  {
    id: "atmosphere",
    label: "Atmosphere and Environment",
    layers: [
      { id: "dust", kind: "map", label: "MY34 dust optical depth τ (modeled, current sol)", ledgerId: "NASA_AMES_MGCM", on: false, maps: ALL, opacity: 0.55 },
      { id: "solar", kind: "link", label: "Solar geometry (left panel)", ledgerId: "NEURONEXUS_SOLAR_GEOMETRY", action: "solar" },
      { id: "radiation", kind: "link", label: "Radiation and weather context (MARSWALK conditions)", ledgerId: "MSL_RAD_RDR", action: "marswalk" },
    ],
  },
  {
    id: "missions",
    label: "Missions and Ground Truth",
    layers: [
      { id: "landingSites", kind: "map", label: "Landing sites", ledgerId: "NASA_MARS", on: false, maps: ALL },
      { id: "rovers", kind: "map", label: "Rover locations (latest position)", ledgerId: "NASA_MMGIS", on: true, maps: ["3d"] },
      { id: "mslTraverse", kind: "map", label: "Curiosity traverse", ledgerId: "MMGIS_MSL_TRAVERSE", on: true, maps: ALL },
      { id: "m2020Traverse", kind: "map", label: "Perseverance traverse", ledgerId: "MMGIS_M2020_TRAVERSE", on: true, maps: ALL },
      { id: "routes", kind: "map", label: "Planned routes, AI candidates and safe havens", ledgerId: "NN_ROUTE_ENGINE", on: true, maps: ALL },
    ],
  },
  {
    id: "exploration",
    label: "Exploration Context",
    layers: [
      { id: "zones", kind: "map", label: "Potential Exploration Zones (DERIVED)", ledgerId: "NN_EXPLORATION_ZONES", on: false, maps: ["3d"] },
      { id: "iceRegions", kind: "map", label: "Documented ice study regions", ledgerId: "NASA_MARS_WATER_MAPS", on: false, maps: ["3d"] },
      { id: "ancient", kind: "map", label: "Ancient habitability evidence (not present-day)", ledgerId: "NASA_CURIOSITY", on: false, maps: ["3d"] },
    ],
  },
];

export const MAP_LAYERS = LAYER_CATEGORIES.flatMap((c) => c.layers.filter((l) => l.kind === "map"));
export const LAYER_BY_ID = Object.fromEntries(MAP_LAYERS.map((l) => [l.id, l]));
export const DEFAULT_OPACITY = Object.fromEntries(MAP_LAYERS.filter((l) => l.opacity != null).map((l) => [l.id, l.opacity]));

export const DEFAULT_VISIBILITY = Object.fromEntries(MAP_LAYERS.map((l) => [l.id, l.on]));

export function activeLayers(visibility, map = null) {
  return MAP_LAYERS.filter((l) => visibility[l.id] && (!map || l.maps.includes(map)));
}

/* Legend entries for the active layers only. Colors are token names, never hex values. */
export const LEGEND = {
  mola: [{ swatch: "ramp-mola", label: "MOLA colorized shaded-relief basemap (thumbnail; no numeric scale)" }],
  hiriseFootprints: [{ swatch: "outline", token: "--nn-src-hirise", label: "HiRISE DTM footprint bounding box (readable)" }, { swatch: "outline-dashed", token: "--nn-red", label: "HiRISE DTM unavailable (HTTP 404)" }],
  features: [
    { swatch: "dot", token: "--nn-feature-crater", label: "Crater" },
    { swatch: "dot", token: "--nn-feature-valley", label: "Vallis / Chasma" },
    { swatch: "dot", token: "--nn-feature-mons", label: "Mons / highland" },
    { swatch: "dot", token: "--nn-feature-other", label: "Other USGS feature" },
  ],
  waypoints: [{ swatch: "dot-scale", token: "--nn-rover-msl", label: "Waypoint (size = rover tilt, IMU)" }],
  dust: [{ swatch: "ramp-dust", label: "Dust τ 0 → 2 (log), MY34 scenario" }],
  imagery: [{ swatch: "ramp-mola", label: "Viking MDIM 2.1 mosaic (ArcGIS, 3D)" }],
  terrain: [{ swatch: "ramp-mola", label: "Relief from the MOLA/HRSC 200 m DEM (3D)" }],
  labels: [{ swatch: "dot", token: "--nn-text-strong", label: "Feature name labels (3D)" }],
  units: [{ swatch: "outline", token: "--nn-amber", label: "SIM 3292 geologic units (USGS symbology)" }],
  contacts: [{ swatch: "line", token: "--nn-text-strong", label: "Geologic contacts" }],
  structures: [{ swatch: "line", token: "--nn-red", label: "Geologic structures" }],
  rovers: [{ swatch: "dot", token: "--nn-rover-msl", label: "Rover latest position" }],
  zones: [{ swatch: "outline-dashed", token: "--nn-green", label: "Potential Exploration Zone (DERIVED)" }],
  iceRegions: [{ swatch: "dot", token: "--nn-cyan", label: "Ice study region" }],
  ancient: [{ swatch: "dot", token: "--nn-amber", label: "Ancient habitability evidence site" }],
  slope: [{ swatch: "ramp-walk", label: "Slope 0 → 20° (green → red)" }],
  roughness: [{ swatch: "ramp-walk", label: "Roughness 0 → 60 m (green → red)" }],
  walkability: [{ swatch: "ramp-walk", label: "Walkability score 100 → 0 (green → red)" }],
  themisObs: [{ swatch: "ramp-walk", label: "THEMIS brightness temperature 170 → 290 K" }],
  landingSites: [{ swatch: "ring", token: "--nn-text-strong", label: "Landing site" }],
  mslTraverse: [{ swatch: "line", token: "--nn-rover-msl", label: "Curiosity traverse (MMGIS)" }],
  m2020Traverse: [{ swatch: "line", token: "--nn-rover-m2020", label: "Perseverance traverse (MMGIS)" }],
  routes: [{ swatch: "line", token: "--nn-cyan", label: "Planned route" }, { swatch: "dot", token: "--nn-green", label: "Safe haven" }],
};
