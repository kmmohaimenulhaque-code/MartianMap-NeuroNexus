/* The activeSol context object and its hook (provider in SolContext.jsx). */

import { createContext, useContext } from "react";

export const SolContext = createContext(null);

const FALLBACK = { sol: null, setSol: () => {}, seasonLs: null, season: "season unknown", missionSol: {}, label: "" };

export function useSol() {
  return useContext(SolContext) ?? FALLBACK;
}
