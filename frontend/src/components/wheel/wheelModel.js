/*
 * Radial Feature Wheel model: eight primary sectors, their sub-features (each a Command Index id),
 * SVG annulus geometry, the double-right-click detector and a pure state reducer (unit-tested).
 */

export const WHEEL = [
  { id: "views", label: ["MODE", "& VIEWS"], icon: "views", items: [
    { id: "global-console", label: "GLOBAL CONSOLE" },
    { id: "marswalk-mode", label: "MARSWALK EVA" },
    { id: "map-3d", label: "3D MARS GLOBE" },
    { id: "focus-usgs", label: "USGS GEOLOGY" },
  ] },
  { id: "route", label: ["ROUTE", "& EVA"], icon: "route", items: [
    { id: "ai-route-design", label: "AI ROUTE DESIGN" },
    { id: "marswalk-demo", label: "PLAN MARSWALK" },
    { id: "compare-routes", label: "COMPARE ROUTES" },
    { id: "rover-replay", label: "ROVER REPLAY" },
    { id: "multi-stop-eva", label: "MULTI-STOP EVA" },
  ] },
  { id: "terrain", label: ["TERRAIN", "LADDER"], icon: "terrain", items: [
    { id: "ladder-full", label: "FULL LADDER (1M)" },
    { id: "ladder-ctx", label: "CTX + MOLA (20M)" },
    { id: "ladder-mola", label: "MOLA ONLY (463M)" },
    { id: "slope-baseline", label: "SLOPE BASELINE" },
  ] },
  { id: "layers", label: ["LAYERS", "& LEGEND"], icon: "layers", items: [
    { id: "layer-topography", label: "TOPOGRAPHY" },
    { id: "layer-geology", label: "GEOLOGY" },
    { id: "layer-dust", label: "ATMOSPHERE / DUST" },
    { id: "layer-ground-truth", label: "GROUND TRUTH" },
    { id: "toggle-legend", label: "TOGGLE LEGEND" },
  ] },
  { id: "environment", label: ["ENVIRONMENT", "& SOL"], icon: "sol", items: [
    { id: "sol-scrubber", label: "SOL SCRUBBER" },
    { id: "thermal", label: "THEMIS HEATMAP" },
    { id: "rad-weather", label: "RAD / WEATHER" },
    { id: "sol-peak", label: "JUMP TO PEAK STORM" },
  ] },
  { id: "validation", label: ["VALIDATION", "& DATA"], icon: "validate", items: [
    { id: "validation-gale", label: "GALE VALIDATION" },
    { id: "validation-jezero", label: "JEZERO VALIDATION" },
    { id: "sources-ledger", label: "SOURCE LEDGER" },
    { id: "verify-plan", label: "VERIFY PLAN" },
    { id: "parameter-sensitivity", label: "SENSITIVITY" },
  ] },
  { id: "export", label: ["EXPORT", "& BRIEF"], icon: "export", items: [
    { id: "export-eva-brief", label: "EXPORT EVA BRIEF" },
    { id: "export-geojson", label: "EXPORT GEOJSON" },
    { id: "export-csv-profile", label: "EXPORT CSV PROFILE" },
    { id: "export-validation", label: "EXPORT VALIDATION" },
  ] },
  { id: "system", label: ["SYSTEM", "& PERF"], icon: "system", items: [
    { id: "browser-optimization", label: "BROWSER OPTIMIZATION" },
    { id: "mission-manual", label: "OPERATIONS MANUAL" },
    { id: "command-index", label: "COMMAND INDEX" },
    { id: "backend-status", label: "DATA STATUS" },
    { id: "judge-tour", label: "JUDGE TOUR" },
  ] },
];

export const WHEEL_ACTION_IDS = WHEEL.flatMap((s) => s.items.map((i) => i.id));

/* Geometry (SVG user units; 0 deg = up, clockwise). */
export const GEOM = { size: 600, inner: 92, outer: 176, subInner: 184, subOuter: 278, sectorGapDeg: 1.4, subSpanDeg: 30, subGapDeg: 1.2 };
const RAD = Math.PI / 180;

export function polar(r, deg, c = GEOM.size / 2) {
  return [c + r * Math.sin(deg * RAD), c - r * Math.cos(deg * RAD)];
}

export function annulusPath(r0, r1, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const f = (v) => v.toFixed(2);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

export function sectorAngles(i, n = WHEEL.length) {
  const span = 360 / n;
  const mid = i * span;
  return { a0: mid - span / 2 + GEOM.sectorGapDeg, a1: mid + span / 2 - GEOM.sectorGapDeg, mid };
}

export function subAngles(sectorIndex, k, j, n = WHEEL.length) {
  const mid = sectorIndex * (360 / n);
  const start = mid - (GEOM.subSpanDeg * k) / 2;
  const a0 = start + j * GEOM.subSpanDeg + GEOM.subGapDeg;
  const a1 = start + (j + 1) * GEOM.subSpanDeg - GEOM.subGapDeg;
  return { a0, a1, mid: (a0 + a1) / 2 };
}

/* Wrap a label into lines of at most `max` characters, keeping words whole. */
export function wrapLabel(text, max = 12) {
  const lines = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/* Keep the whole wheel on screen. */
export function clampCenter(x, y, vw, vh, size = GEOM.size) {
  const half = size / 2;
  const cx = vw <= size ? vw / 2 : Math.min(Math.max(x, half), vw - half);
  const cy = vh <= size ? vh / 2 : Math.min(Math.max(y, half), vh - half);
  return { x: cx, y: cy };
}

/* Two right-clicks within `windowMs` open the wheel. Returns a function(eventTimeMs) -> boolean. */
export function createDoubleRightClickDetector(windowMs = 300) {
  let last = -Infinity;
  return (t) => {
    if (t - last <= windowMs) {
      last = -Infinity;
      return true;
    }
    last = t;
    return false;
  };
}

export const initialWheel = { open: false, x: 0, y: 0, active: null, sub: null, lastAction: null };

export function wheelReducer(state, action) {
  switch (action.type) {
    case "open":
      return { ...initialWheel, open: true, x: action.x, y: action.y };
    case "close":
      return { ...state, open: false, active: null, sub: null };
    case "hover":
      return state.active === action.index ? state : { ...state, active: action.index, sub: null };
    case "hoverSub":
      return { ...state, sub: action.index };
    case "rotate": {
      const n = WHEEL.length;
      return { ...state, active: (((state.active ?? -action.step) + action.step) % n + n) % n, sub: null };
    }
    case "select": {
      const sector = WHEEL[action.sector ?? state.active];
      const item = sector?.items[action.item ?? state.sub];
      if (!item) return state;
      return { ...state, open: false, active: null, sub: null, lastAction: item.id };
    }
    default:
      return state;
  }
}
