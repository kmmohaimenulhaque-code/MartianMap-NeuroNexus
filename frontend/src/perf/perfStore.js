/*
 * Browser Optimization store. OFF by default (MAX FIDELITY: no throttling, full WebGL, immediate
 * rendering). Turning it ON (LOW-RAM / 4 GB) is an explicit user choice for low-end devices; AUTO is
 * an opt-in preset that switches the protections on when navigator.deviceMemory <= 4 or the frame
 * rate stays low. No setting changes a computed number: only where and when work happens.
 */

export const TOGGLES = {
  workerMath: "Run Marswalk math in a Web Worker (zero-copy buffers)",
  lazyHeavyViews: "Load the 3D globe, MARSWALK and the manual on demand",
  suspendWebGL: "Destroy the 3D globe's WebGL context when hidden (camera restored on return)",
  canvasCulling: "Canvas markers culled to the viewport (features, waypoints)",
  tileCache: "IndexedDB tile cache, 150 MB LRU",
  debounceDrags: "Debounce slider and vertex drags; cancel stale requests",
};

export const PRESETS = {
  LOW_RAM: { label: "LOW-RAM / 4 GB MODE", toggles: Object.fromEntries(Object.keys(TOGGLES).map((k) => [k, true])) },
  MAX_FIDELITY: { label: "MAX FIDELITY", toggles: Object.fromEntries(Object.keys(TOGGLES).map((k) => [k, false])) },
};

export const DEFAULT_PRESET = "MAX_FIDELITY";

/* v2 key: earlier builds defaulted to AUTO; nobody inherits an optimization they did not choose. */
const KEY = "nn.browserOptimization.v2";
const LOW_FPS = 40;
const LOW_FPS_SECONDS = 5;

function read() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

function initial() {
  const saved = read();
  return { preset: PRESETS[saved?.preset] || saved?.preset === "AUTO" ? saved.preset : DEFAULT_PRESET, custom: saved?.custom ?? {}, lowFpsStreak: 0, autoLow: false };
}

let state = initial();
const listeners = new Set();

function emit(next) {
  state = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ preset: state.preset, custom: state.custom }));
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  listeners.forEach((l) => l());
}

export function deviceMemoryGb(nav = globalThis.navigator) {
  return typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null;
}

/* The effective toggles for a state; pure so it can be tested. */
export function effectiveToggles(s, memoryGb = deviceMemoryGb()) {
  let base;
  if (s.preset === "AUTO") {
    const low = (memoryGb != null && memoryGb <= 4) || s.autoLow;
    base = low ? PRESETS.LOW_RAM.toggles : PRESETS.MAX_FIDELITY.toggles;
  } else {
    base = PRESETS[s.preset]?.toggles ?? PRESETS.MAX_FIDELITY.toggles;
  }
  return { ...base, ...s.custom };
}

export function autoReason(s, memoryGb = deviceMemoryGb()) {
  if (s.preset !== "AUTO") return null;
  if (memoryGb != null && memoryGb <= 4) return `navigator.deviceMemory = ${memoryGb} GB (<= 4)`;
  if (s.autoLow) return `frame rate below ${LOW_FPS} FPS for ${LOW_FPS_SECONDS} s`;
  return memoryGb == null ? "deviceMemory not exposed by this browser; watching FPS" : `deviceMemory = ${memoryGb} GB`;
}

/* AUTO watches the frame rate; a sustained low rate switches on the protections (never back off mid-session). */
export function reportFps(fps, s = state) {
  if (s.preset !== "AUTO" || s.autoLow) return s;
  const streak = fps < LOW_FPS ? s.lowFpsStreak + 1 : 0;
  return { ...s, lowFpsStreak: streak, autoLow: streak >= LOW_FPS_SECONDS };
}

export const perfStore = {
  get: () => state,
  subscribe: (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setPreset: (preset) => emit({ ...state, preset, custom: {} }),
  setToggle: (key, value) => emit({ ...state, custom: { ...state.custom, [key]: value } }),
  fps: (fps) => {
    const next = reportFps(fps);
    if (next !== state && next.autoLow !== state.autoLow) emit(next);
    else state = next;
  },
  enabled: (key) => Boolean(effectiveToggles(state)[key]),
  /* The single [BROWSER OPTIMIZATION] switch: ON = LOW-RAM preset, OFF = MAX FIDELITY. */
  isOn: () => isOptimizationOn(state),
  toggle: () => emit({ ...state, preset: isOptimizationOn(state) ? "MAX_FIDELITY" : "LOW_RAM", custom: {} }),
};

export function isOptimizationOn(s, memoryGb = deviceMemoryGb()) {
  return Object.values(effectiveToggles(s, memoryGb)).some(Boolean);
}
