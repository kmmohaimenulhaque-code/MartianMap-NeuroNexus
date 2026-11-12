/*
 * One activeSol for the whole console (MY34 scenario sol). Every panel reads it from here: the dust
 * scenario, the THEMIS heatmap season marker, rover traverse filters, MARSWALK conditions and the
 * AI Route Designer. The Ls table is the MGCM's own (GET /api/dust/meta).
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { dustFrameFailed, loadDustFrame, peekDustFrame, prefetchDustFrames } from "./dustFrames";

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

  // Playback: advance 2 sols per 120 ms tick, but only once the next dust frame is in the shared cache, so the
  // maps play in step with the slider. After about 1.5 s without the frame (slow or failed request) it moves on.
  const solRef = useRef(sol);
  useEffect(() => {
    solRef.current = sol;
  }, [sol]);
  useEffect(() => {
    if (!playing) return undefined;
    let waited = 0;
    prefetchDustFrames(solRef.current, 24);
    const timer = window.setInterval(() => {
      const current = solRef.current ?? 1;
      const next = current >= 668 ? 1 : current + 2;
      if (peekDustFrame(next) || dustFrameFailed(next) || waited >= 12) {
        waited = 0;
        prefetchDustFrames(next, 24);
        setSol(next);
      } else {
        waited += 1;
        loadDustFrame(next).catch(() => {});
      }
    }, 120);
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
