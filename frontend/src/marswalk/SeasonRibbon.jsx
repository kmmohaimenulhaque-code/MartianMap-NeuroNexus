/*
 * Season status ribbon: this route's status combined with the modeled dust class for every sol of MY34
 * (the same worst-of rule as the decision card's AT-SOL line), so the plan answers "when could this walk be done?".
 * Dust is the NASA Ames MGCM MY34 scenario for the same grid cell the conditions block uses: a modeled year,
 * not a forecast. Tap or click a sol to make it the console's active sol.
 */
import { useEffect, useMemo, useState } from "react";

import SourceTag from "../sources/SourceTag";
import { fetchDustSeries } from "../services/marsEnvironmentApi";
import { useSol } from "../state/solStore";
import { seasonStatuses } from "./decision";
import { CLASS_TOKENS, tokenColor } from "./walkabilityRamp";

const SHORT = { "WITHIN PLANNING LIMITS": "WITHIN", "REVIEW REQUIRED": "REVIEW", "EXCEEDS PLANNING LIMIT": "EXCEEDS" };

export default function SeasonRibbon({ routeStatus, lat, lon }) {
  const { sol, setSol } = useSol();
  const [series, setSeries] = useState({ key: "", data: null, error: "" });
  const key = Number.isFinite(lat) && Number.isFinite(lon) ? `${lat},${lon}` : "";

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    fetchDustSeries(lat, lon, { signal: controller.signal })
      .then((data) => setSeries({ key, data, error: "" }))
      .catch((error) => error.name !== "AbortError" && setSeries({ key, data: null, error: error.message }));
    return () => controller.abort();
  }, [key, lat, lon]);

  const data = series.key === key ? series.data : null;
  const result = useMemo(() => (data?.tau?.length ? seasonStatuses(routeStatus, data.tau) : null), [data, routeStatus]);

  if (!key || !(routeStatus in SHORT)) return null;
  if (series.key === key && series.error) return <section className="mw-card"><h3>STATUS BY SOL</h3><p className="mw-error">UNAVAILABLE · dust scenario: {series.error}</p></section>;
  if (!result) return <section className="mw-card mw-skeleton">STATUS BY SOL · reading the MY34 dust scenario…</section>;

  const n = result.statuses.length;
  const pick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = Math.min(n, Math.max(1, Math.floor(((event.clientX - rect.left) / rect.width) * n) + 1));
    setSol(next);
  };
  const best = result.longestWithin;
  return (
    <section className="mw-card mw-season" data-testid="season-ribbon">
      <h3>
        STATUS BY SOL · MY34
        <SourceTag ledgerId="NASA_AMES_MGCM" evidence="MODELED" compact />
        <SourceTag ledgerId="NEURONEXUS_MARSWALK_PARAMETERS" compact />
      </h3>
      <svg
        className="mw-season-strip"
        viewBox={`0 0 ${n} 20`}
        preserveAspectRatio="none"
        role="slider"
        aria-label="Route status at each sol of MY34; select a sol"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={sol ?? undefined}
        tabIndex={0}
        onPointerDown={pick}
        onKeyDown={(event) => {
          const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
          if (step && sol) {
            event.preventDefault();
            setSol(Math.min(n, Math.max(1, sol + step)));
          }
        }}
      >
        {result.statuses.map((status, i) => (
          <rect key={i} x={i} y={0} width={1.05} height={20} fill={status ? tokenColor(CLASS_TOKENS[status]) : "transparent"} opacity={data.filled?.[i] ? 0.45 : 0.9} />
        ))}
        {sol && <rect x={sol - 1} y={0} width={Math.max(2, n / 220)} height={20} className="mw-season-cursor" />}
      </svg>
      <div className="mw-season-axis"><span>sol 1 · Ls 0°</span><span>sol {n}</span></div>
      <p className="mw-season-counts">
        {Object.entries(SHORT).map(([status, label]) => (
          <span key={status} style={{ color: tokenColor(CLASS_TOKENS[status]) }}>
            {label} {result.counts[status] ?? 0}
          </span>
        ))}
      </p>
      <p className="mw-dim">
        {best ? `Longest WITHIN window: sol ${best.start} to ${best.end} (${best.end - best.start + 1} sols). ` : "No sol is WITHIN planning limits for this route. "}
        Route status ({SHORT[routeStatus]}) combined with the modeled dust class at each sol; the MY34 scenario is a modeled year, not a forecast. Paler cells are gap-filled sols.
      </p>
    </section>
  );
}
