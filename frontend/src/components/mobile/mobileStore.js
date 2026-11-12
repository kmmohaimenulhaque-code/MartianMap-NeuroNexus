import { useSyncExternalStore } from "react";

/*
 * Tablet / mobile workspace state (< 1200 px): which bottom sheet or side drawer is open, and which map the
 * dual-map area shows. One tiny store so the dock, the sheet headers inside each panel and MARSWALK share it
 * without threading props through App. On desktop nothing reads it (the CSS ignores data-sheet there).
 */
export const SHEETS = ["intel", "route", "mission"];
export const MAP_VIEWS = ["2d", "usgs", "split"];

let state = { sheet: null, mapView: "2d" };
const listeners = new Set();

function emit(next) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const mobileUi = {
  get: () => state,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setSheet: (sheet) => emit({ sheet: SHEETS.includes(sheet) ? sheet : null }),
  toggleSheet: (sheet) => emit({ sheet: state.sheet === sheet ? null : SHEETS.includes(sheet) ? sheet : null }),
  setMapView: (mapView) => MAP_VIEWS.includes(mapView) && emit({ mapView }),
};

export function useMobileUi() {
  return useSyncExternalStore(mobileUi.subscribe, mobileUi.get, mobileUi.get);
}
