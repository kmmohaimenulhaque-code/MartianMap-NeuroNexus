import { useSyncExternalStore } from "react";
import { DEFAULT_OPACITY, DEFAULT_VISIBILITY } from "./layerCatalog";

/*
 * Shared layer state for the three maps (2D, ArcGIS 2D, 3D): which layers are on and each overlay's opacity.
 * Any map's LAYERS control writes here and every map redraws from it. Persisted per browser (nn.layers,
 * nn.layerOpacity); storage failures (private mode) only mean the choice is not remembered.
 */
const read = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
};
const write = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered; the session still works
  }
};

let state = {
  visibility: typeof window === "undefined" ? { ...DEFAULT_VISIBILITY } : read("nn.layers", DEFAULT_VISIBILITY),
  opacity: typeof window === "undefined" ? { ...DEFAULT_OPACITY } : read("nn.layerOpacity", DEFAULT_OPACITY),
};
const listeners = new Set();
const emit = (next) => {
  state = next;
  write("nn.layers", state.visibility);
  write("nn.layerOpacity", state.opacity);
  listeners.forEach((listener) => listener());
};

export const layerStore = {
  get: () => state,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /* Same contract as React's setState: a value or an updater of the visibility object. */
  setVisibility(update) {
    const visibility = typeof update === "function" ? update(state.visibility) : update;
    if (visibility !== state.visibility) emit({ ...state, visibility: { ...visibility } });
  },
  toggle(id) {
    emit({ ...state, visibility: { ...state.visibility, [id]: !state.visibility[id] } });
  },
  setMany(patch) {
    emit({ ...state, visibility: { ...state.visibility, ...patch } });
  },
  setOpacity(id, value) {
    const v = Math.min(1, Math.max(0.05, Number(value)));
    if (Number.isFinite(v)) emit({ ...state, opacity: { ...state.opacity, [id]: v } });
  },
};

export function useLayers() {
  return useSyncExternalStore(layerStore.subscribe, layerStore.get, layerStore.get);
}

export const layerOpacity = (id) => state.opacity[id] ?? DEFAULT_OPACITY[id] ?? 1;
