/*
 * Categorized layers for the global 2D map. "map" rows toggle a layer on the map; "link" rows point to
 * where that information lives (a panel or MARSWALK) instead of pretending it is a map layer.
 */

export const LAYER_CATEGORIES = [
  {
    id: "topography",
    label: "Topography and Elevation",
    layers: [
      { id: "mola", kind: "map", label: "MOLA 463 m colorized elevation basemap", ledgerId: "MOLA_MEGDR", on: true },
      { id: "hiriseFootprints", kind: "map", label: "HiRISE 1 m DTM footprints (near site)", ledgerId: "HIRISE_STAC_DTM", on: false },
      { id: "ctxRung", kind: "link", label: "CTX 20 m DTMs, slope and roughness at 1-463 m baselines", ledgerId: "CTX_STAC_DTM", action: "marswalk" },
    ],
  },
  {
    id: "geology",
    label: "Geology and Science Context",
    layers: [
      { id: "features", kind: "map", label: "IAU named features (2,052)", ledgerId: "USGS_IAU_GAZETTEER", on: true },
      { id: "sim3292", kind: "link", label: "USGS SIM 3292 geologic units (USGS scientific map)", ledgerId: "USGS_SIM_3292", action: "usgs" },
      { id: "waypoints", kind: "map", label: "Rover waypoints, sized by IMU tilt", ledgerId: "MMGIS_MSL_WAYPOINTS", on: false },
      { id: "thermal", kind: "link", label: "THEMIS thermal heatmap (left panel)", ledgerId: "THEMIS", action: "thermal" },
    ],
  },
  {
    id: "atmosphere",
    label: "Atmosphere and Environment",
    layers: [
      { id: "dust", kind: "map", label: "MY34 dust optical depth τ (modeled, current sol)", ledgerId: "NASA_AMES_MGCM", on: false },
      { id: "solar", kind: "link", label: "Solar geometry (left panel)", ledgerId: "NEURONEXUS_SOLAR_GEOMETRY", action: "solar" },
      { id: "radiation", kind: "link", label: "Radiation and weather context (MARSWALK conditions)", ledgerId: "MSL_RAD_RDR", action: "marswalk" },
    ],
  },
  {
    id: "missions",
    label: "Missions and Ground Truth",
    layers: [
      { id: "landingSites", kind: "map", label: "Landing sites", ledgerId: "NASA_MARS", on: false },
      { id: "mslTraverse", kind: "map", label: "Curiosity traverse", ledgerId: "MMGIS_MSL_TRAVERSE", on: true },
      { id: "m2020Traverse", kind: "map", label: "Perseverance traverse", ledgerId: "MMGIS_M2020_TRAVERSE", on: true },
      { id: "routes", kind: "map", label: "Planned routes (route console)", ledgerId: "NN_ROUTE_ENGINE", on: true },
    ],
  },
];

export const DEFAULT_VISIBILITY = Object.fromEntries(
  LAYER_CATEGORIES.flatMap((c) => c.layers.filter((l) => l.kind === "map").map((l) => [l.id, l.on])),
);

export function activeLayers(visibility) {
  return LAYER_CATEGORIES.flatMap((c) => c.layers.filter((l) => l.kind === "map" && visibility[l.id]));
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
  landingSites: [{ swatch: "ring", token: "--nn-text-strong", label: "Landing site" }],
  mslTraverse: [{ swatch: "line", token: "--nn-rover-msl", label: "Curiosity traverse (MMGIS)" }],
  m2020Traverse: [{ swatch: "line", token: "--nn-rover-m2020", label: "Perseverance traverse (MMGIS)" }],
  routes: [{ swatch: "line", token: "--nn-cyan", label: "Planned route" }, { swatch: "dot", token: "--nn-green", label: "Safe haven" }],
};
