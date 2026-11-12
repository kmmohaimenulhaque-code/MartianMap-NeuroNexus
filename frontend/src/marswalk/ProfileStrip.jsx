/*
 * ProfileStrip: elevation, slope at two baselines, walkability class band, the terrain-ladder ribbon
 * and cumulative EVA time with the turnaround (PNR) line. Hover is synced with the SiteMap.
 */

import { useMemo, useRef, useState, useLayoutEffect } from "react";

import SourceTag from "../sources/SourceTag";
import { CLASS_TOKENS, SOURCE_TOKENS, tokenColor } from "./walkabilityRamp";

const CLASS_BY_CODE = ["UNAVAILABLE", "WITHIN PLANNING LIMITS", "REVIEW REQUIRED", "EXCEEDS PLANNING LIMIT"];
const PAD = { l: 44, r: 44, t: 8 };

function useWidth(ref) {
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function path(xs, ys, sx, sy) {
  let d = "";
  let pen = false;
  for (let i = 0; i < xs.length; i += 1) {
    if (ys[i] == null || xs[i] == null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(ys[i]).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export default function ProfileStrip({ profile, hoverIndex, onHover, height = 180 }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const geo = useMemo(() => {
    if (!profile?.distance_m?.length) return null;
    const dist = profile.distance_m;
    const elev = profile.elevation_m.filter((v) => v != null);
    const zmin = Math.min(...elev);
    const zmax = Math.max(...elev);
    const slopes = [...profile.slope_3m_deg, ...profile.slope_1m_deg].filter((v) => v != null);
    const smax = Math.max(30, ...slopes);
    const tmax = Math.max(...profile.cum_time_h.filter((v) => v != null), 0.01);
    const L = dist[dist.length - 1] || 1;
    const plotH = height - 58;
    const sx = (d) => PAD.l + (d / L) * (width - PAD.l - PAD.r);
    const sz = (z) => PAD.t + plotH - ((z - zmin) / Math.max(1, zmax - zmin)) * plotH;
    const ss = (s) => PAD.t + plotH - (s / smax) * plotH;
    const st = (t) => PAD.t + plotH - (t / tmax) * plotH;
    return { dist, L, zmin, zmax, smax, tmax, sx, sz, ss, st, plotH };
  }, [profile, width, height]);

  if (!geo) {
    return (
      <div className="mw-profile mw-profile--empty" ref={ref}>
        PROFILE · plan a route to see elevation, slope at 1 m and 3 m baselines, walkability, terrain source and EVA time
      </div>
    );
  }
  const { dist, L, zmin, zmax, smax, tmax, sx, sz, ss, st, plotH } = geo;
  const bandY = PAD.t + plotH + 6;
  const ribbonY = bandY + 12;
  const pnr = profile.pnr_distance_m;
  const hx = hoverIndex != null ? sx(dist[hoverIndex]) : null;

  const handleMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const d = ((event.clientX - rect.left - PAD.l) / (width - PAD.l - PAD.r)) * L;
    let best = 0;
    for (let i = 0; i < dist.length; i += 1) if (Math.abs(dist[i] - d) < Math.abs(dist[best] - d)) best = i;
    onHover?.(best);
  };

  return (
    <div className="mw-profile" ref={ref}>
      <div className="mw-profile-head">
        <span>PROFILE</span>
        <span className="mw-key mw-key--elev">elevation (m, MOLA areoid)</span>
        <span className="mw-key mw-key--s3">slope @3 m</span>
        <span className="mw-key mw-key--s1">slope @1 m (HiRISE only)</span>
        <span className="mw-key mw-key--time">cumulative EVA time</span>
        <SourceTag ledgerId="NEURONEXUS_TERRAIN_LADDER" compact />
        <SourceTag ledgerId="NEURONEXUS_PACE_MODEL" compact />
        {profile.display_only && <small>display decimated from {profile.decimated_from} samples (metrics use all)</small>}
      </div>
      <svg width={width} height={height - 22} role="img" aria-label="Route profile" onMouseMove={handleMove} onMouseLeave={() => onHover?.(null)}>
        <text x={4} y={PAD.t + 8} className="mw-axis">{zmax.toFixed(0)} m</text>
        <text x={4} y={PAD.t + plotH} className="mw-axis">{zmin.toFixed(0)} m</text>
        <text x={width - PAD.r + 4} y={PAD.t + 8} className="mw-axis">{smax.toFixed(0)}°</text>
        <text x={width - PAD.r + 4} y={PAD.t + plotH} className="mw-axis">{tmax.toFixed(2)} h</text>
        <path d={path(dist, profile.elevation_m, sx, sz)} className="mw-line mw-line--elev" />
        <path d={path(dist, profile.slope_3m_deg, sx, ss)} className="mw-line mw-line--s3" />
        <path d={path(dist, profile.slope_1m_deg, sx, ss)} className="mw-line mw-line--s1" />
        <path d={path(dist, profile.cum_time_h, sx, st)} className="mw-line mw-line--time" />
        {dist.slice(1).map((d, i) => {
          const cls = CLASS_BY_CODE[profile.class[i]] ?? "UNAVAILABLE";
          const x0 = sx(dist[i]);
          const w = Math.max(0.5, sx(d) - x0);
          return (
            <g key={i}>
              <rect x={x0} y={bandY} width={w} height={8} fill={tokenColor(CLASS_TOKENS[cls])} className={cls === "EXCEEDS PLANNING LIMIT" ? "mw-hatch" : undefined} />
              <rect x={x0} y={ribbonY} width={w} height={8} fill={tokenColor(SOURCE_TOKENS[profile.source[i]] ?? SOURCE_TOKENS.NONE)} />
            </g>
          );
        })}
        <text x={4} y={bandY + 7} className="mw-axis">WALK</text>
        <text x={4} y={ribbonY + 7} className="mw-axis">LADDER</text>
        {pnr != null && pnr < L && (
          <g>
            <line x1={sx(pnr)} x2={sx(pnr)} y1={PAD.t} y2={ribbonY + 8} className="mw-pnr" />
            <text x={sx(pnr) + 3} y={PAD.t + 10} className="mw-axis mw-pnr-label">PNR {pnr.toFixed(0)} m</text>
          </g>
        )}
        {hx != null && <line x1={hx} x2={hx} y1={PAD.t} y2={ribbonY + 8} className="mw-hover" />}
      </svg>
      <div className="mw-profile-foot" aria-live="polite">
        {hoverIndex != null
          ? `${dist[hoverIndex].toFixed(0)} m · ${profile.elevation_m[hoverIndex]?.toFixed(1) ?? "n/a"} m · slope@3 m ${profile.slope_3m_deg[hoverIndex]?.toFixed(1) ?? "n/a"}° (baseline ${profile.slope_3m_baseline_m[hoverIndex] ?? "n/a"} m) · ${profile.source[hoverIndex]} · ${CLASS_BY_CODE[profile.class[hoverIndex]]} · t+${(profile.cum_time_h[hoverIndex] * 60).toFixed(0)} min`
          : `0 – ${L.toFixed(0)} m along track · hover to sync with the map`}
      </div>
    </div>
  );
}
