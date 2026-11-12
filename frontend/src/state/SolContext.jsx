/*
 * One activeSol for the whole console (MY34 scenario sol). Every panel reads it from here: the dust
 * scenario, the THEMIS heatmap season marker, rover traverse filters, MARSWALK conditions and the
 * AI Route Designer. The Ls table is the MGCM's own (GET /api/dust/meta).
 */

import { useEffect, useMemo, useState } from "react";

import { lsAt, missionSolAt, my34SolToUtc, seasonName } from "./solMath";
import { SolContext, setSolSnapshot } from "./solStore";

let tableCache = null;

export function SolProvider({ sol, setSol, playing = false, setPlaying, children }) {
  const [table, setTable] = useState(tableCache);
  useEffect(() => {
    if (tableCache) return undefined;
    const controller = new AbortController();
    fetch("/api/dust/meta", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((meta) => {
        tableCache = meta.ls_deg ?? null;
        setTable(tableCache);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setSol((current) => (current >= 668 ? 1 : current + 2)), 120);
    return () => window.clearInterval(timer);
  }, [playing, setSol]);

  const value = useMemo(() => {
    const seasonLs = lsAt(table, sol);
    return {
      sol,
      setSol,
      playing,
      setPlaying,
      seasonLs,
      season: seasonName(seasonLs),
      utc: my34SolToUtc(sol),
      missionSol: { msl: missionSolAt("msl", sol), m2020: missionSolAt("m2020", sol) },
      label: seasonLs == null ? `MY34 SOL ${sol}` : `MY34 SOL ${sol} · LS ${seasonLs.toFixed(0)}°`,
    };
  }, [sol, setSol, playing, setPlaying, table]);
  useEffect(() => setSolSnapshot(value), [value]);
  return <SolContext.Provider value={value}>{children}</SolContext.Provider>;
}
