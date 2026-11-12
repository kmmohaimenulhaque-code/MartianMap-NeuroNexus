/* Conditions at a coordinate for the console's activeSol: MY34 dust tau (MGCM cell series) + solar geometry. */

import { useEffect, useMemo, useState } from "react";

import { fetchDustSeries } from "../services/marsEnvironmentApi";
import { useSol } from "./solStore";
import { solarGeometry } from "./solMath";

const cache = new Map();

export function useSolConditions(lat, lon) {
  const { sol, seasonLs } = useSol();
  const key = Number.isFinite(lat) && Number.isFinite(lon) ? `${Math.round(lat / 3)},${Math.round(lon / 3)}` : "";
  const [state, setState] = useState({ key: "", series: null, error: "" });

  useEffect(() => {
    if (!key || cache.has(key)) return undefined;
    const controller = new AbortController();
    fetchDustSeries(lat, lon, { signal: controller.signal })
      .then((series) => {
        cache.set(key, series);
        setState({ key, series, error: "" });
      })
      .catch((error) => error.name !== "AbortError" && setState({ key, series: null, error: error.message }));
    return () => controller.abort();
  }, [key, lat, lon]);

  return useMemo(() => {
    const series = cache.get(key) ?? (state.key === key ? state.series : null);
    const i = sol == null ? -1 : sol - 1;
    const tau = series?.tau?.[i] ?? null;
    const ls = series?.ls_deg?.[i] ?? seasonLs;
    return {
      sol,
      ls,
      tau,
      filled: series?.filled?.[i] ?? false,
      cell: series?.cell ?? null,
      tauByLs: series ? series.ls_deg.map((l, k) => [l, series.tau[k]]).filter(([l, t]) => l != null && t != null).sort((a, b) => a[0] - b[0]) : [],
      solar: solarGeometry(lat, ls, tau),
      error: state.key === key ? state.error : "",
      loading: Boolean(key) && !series && !(state.key === key && state.error),
    };
  }, [state, key, sol, seasonLs, lat]);
}
