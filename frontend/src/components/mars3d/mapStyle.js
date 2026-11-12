/*
 * Shared visual language for the 3D map and its legend.
 * USGS class colours are IDENTICAL to the coloured 2D map (MarsMap.jsx featureColor).
 */

export const USGS_CLASS_COLOURS = {
  Crater: "#d9c2a5",
  Vallis: "#72d9ff",
  Mons: "#ff9f68",
  Fossa: "#9fe3a8",
  Mensa: "#e7d06f",
  Planum: "#c99bff",
  Patera: "#ff718d",
  Chaos: "#75e6ff",
  Rupes: "#ffbf69",
  Chasma: "#80aaff",
  Dorsum: "#c5a27b",
  Terra: "#f0c6a0",
  Planitia: "#9cc2b5",
};
export const USGS_OTHER_COLOUR = "#d5d9dc"; // same fallback as the coloured 2D map

export function featureClass(featureType = "") {
  const type = String(featureType).split(",")[0].trim();
  return USGS_CLASS_COLOURS[type] ? type : "Other";
}

export function classColour(cls) {
  return USGS_CLASS_COLOURS[cls] ?? USGS_OTHER_COLOUR;
}

/* Scientifically important sites: always labelled, whatever their size. */
export const PRIORITY_NAMES = new Set([
  "Gale",
  "Jezero",
  "Olympus Mons",
  "Arcadia Planitia",
  "Deuteronilus Mensae",
  "Utopia Planitia",
  "Valles Marineris",
  "Hellas Planitia",
  "Elysium Mons",
  "Arsia Mons",
  "Pavonis Mons",
  "Ascraeus Mons",
  "Gusev",
  "Meridiani Planum",
  "Phlegra Montes",
  "Isidis Planitia",
  "Argyre Planitia",
  "Acidalia Planitia",
  "Holden",
  "Eberswalde",
  "Mawrth Vallis",
  "Tharsis Montes",
  "Syrtis Major Planum",
  "Aeolis Mons",
]);

/* Label tiers: 0 always, then progressively smaller features as the camera descends. */
export const LABEL_TIERS = [
  { tier: 0, minScale: 0 },
  { tier: 1, minScale: 0 },
  { tier: 2, minScale: 60000000 },
  { tier: 3, minScale: 16000000 },
  { tier: 4, minScale: 4000000 },
];

export function labelTier(feature) {
  const d = Number(feature.diameter_km) || 0;
  if (PRIORITY_NAMES.has(feature.feature_name)) return 0;
  if (d >= 1000) return 1;
  if (d >= 300) return 2;
  if (d >= 100) return 3;
  return 4;
}

/* Non-USGS entities (shape = ArcGIS icon primitive; also drawn by the legend). */
export const ENTITY_STYLES = {
  landing: { label: "USGS landing site", colour: "#ffe9a8", shape: "square", size: 10, status: "OBSERVED" },
  curiosity: { label: "Curiosity — latest traverse position", colour: "#ffd166", shape: "triangle", size: 13, status: "OBSERVED" },
  perseverance: { label: "Perseverance — latest traverse position", colour: "#ff8fa3", shape: "triangle", size: 13, status: "OBSERVED" },
  safeHaven: { label: "Safe Haven (user-defined)", colour: "#62f59a", shape: "kite", size: 12, status: "DERIVED" },
  customPlace: { label: "Custom place (user-defined)", colour: "#ffb347", shape: "circle", size: 10, status: "DERIVED" },
  routeStart: { label: "Route start", colour: "#62f59a", shape: "circle", size: 11, status: "DERIVED" },
  routeWaypoint: { label: "Route waypoint", colour: "#75e6ff", shape: "circle", size: 8, status: "DERIVED" },
  routeEnd: { label: "Route destination", colour: "#ff647c", shape: "circle", size: 11, status: "DERIVED" },
  zone: { label: "Potential Exploration Zone (NeuroNexus-derived)", colour: "#2ef0b4", shape: "kite", size: 13, status: "DERIVED" },
  ancient: { label: "Ancient habitability evidence (not present-day)", colour: "#ff6ad5", shape: "circle", size: 12, status: "OBSERVED" },
  iceRegion: { label: "Documented ice study region (not the SWIM ice map)", colour: "#b8ecff", shape: "circle", size: 13, status: "DERIVED" },
  thermal: { label: "THEMIS observation (colour = brightness temperature)", colour: "#ffb347", shape: "circle", size: 9, status: "OBSERVED" },
};

export const LINE_STYLES = {
  curiosity: { label: "Curiosity traverse (NASA MMGIS)", colour: "#ffd166", width: 3, status: "OBSERVED" },
  perseverance: { label: "Perseverance traverse (NASA MMGIS)", colour: "#ff8fa3", width: 3, status: "OBSERVED" },
  route: { label: "Active route", colour: "#75e6ff", width: 4, status: "DERIVED" },
  candidate: { label: "AI candidate route (colour per candidate; selected = solid)", colour: "#c99bff", width: 3, dashed: true, status: "DERIVED" },
  contact: { label: "USGS geologic contact", colour: "#e5e7eb", width: 1, dashed: true, status: "DERIVED" },
  structure: { label: "USGS geologic structure", colour: "#ff9f68", width: 1.5, status: "DERIVED" },
};

export const AREA_STYLES = {
  units: { label: "USGS geologic unit (SIM 3292 colours)", colour: "#b07a5a", status: "DERIVED" },
  zone: { label: "Potential Exploration Zone candidate cells", colour: "#2ef0b4", status: "DERIVED" },
  slope: { label: "Slope 0° (green) → 20°+ (red)", gradient: true, status: "DERIVED" },
  roughness: { label: "Roughness 0 m (green) → 60 m+ (red)", gradient: true, status: "DERIVED" },
  walkability: { label: "Walkability 100 (green) → 0 (red)", gradient: true, status: "DERIVED" },
};

export function hexToRgb(hex) {
  const value = String(hex).replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/* Glowing HUD marker: soft halo + crisp core + thin callout to the ground. */
export function pointSymbol(colour, shape = "circle", size = 9) {
  const rgb = hexToRgb(colour);
  return {
    type: "point-3d",
    symbolLayers: [
      { type: "icon", resource: { primitive: shape }, material: { color: [...rgb, 0.16] }, size: size * 2.6 },
      { type: "icon", resource: { primitive: shape }, material: { color: [...rgb, 0.35] }, size: size * 1.6 },
      { type: "icon", resource: { primitive: shape }, material: { color: [...rgb, 1] }, outline: { color: [4, 8, 11, 0.95], size: 1 }, size },
    ],
    verticalOffset: { screenLength: 8, maxWorldLength: 40000, minWorldLength: 0 },
    callout: { type: "line", size: 0.75, color: [...rgb, 0.7] },
  };
}

export function labelSymbol(colour, size = 9) {
  return {
    type: "label-3d",
    symbolLayers: [
      {
        type: "text",
        material: { color: colour },
        halo: { color: [3, 7, 10, 0.92], size: 1.4 },
        font: { weight: "bold" },
        size,
      },
    ],
  };
}
