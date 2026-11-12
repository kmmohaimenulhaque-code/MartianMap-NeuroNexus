/* The activeSol context object and its hook (provider in SolContext.jsx). */

import { createContext, useContext } from "react";

export const SolContext = createContext(null);

/* Latest activeSol value for code outside React (exports run from the wheel or the Command Index). */
let snapshot = { sol: null, seasonLs: null };
export const solSnapshot = () => snapshot;
export function setSolSnapshot(value) {
  snapshot = value;
}

const FALLBACK = { sol: null, setSol: () => {}, seasonLs: null, season: "season unknown", missionSol: {}, label: "" };

export function useSol() {
  return useContext(SolContext) ?? FALLBACK;
}
