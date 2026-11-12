/*
 * THEMIS thermal heatmap: historical IR brightness temperature near the site by local solar time
 * (rows) and season Ls (columns), with a color bar, search radius and sample count.
 * OBSERVED · HISTORICAL: brightness temperature, not surface temperature or current weather.
 */

import { useEffect, useMemo, useState } from "react";

import SourceTag from "../sources/SourceTag";
import { cssVar, rampColor } from "../marswalk/walkabilityRamp";

const RAMP = ["--nn-thermal-cold", "--nn-thermal-mid", "--nn-thermal-hot"];

export default function ThermalHeatmapCard({ location, radiusKm = 50 }) {
  const [state, setState] = useState({ key: "", data: null, error: "" });
  const lat = location?.latitude_deg;
  const lon = location?.longitude_deg;
  const key = lat == null ? "" : `${lat},${lon},${radiusKm}`;

  useEffect(() => {
    if (lat == null || lon == null) return undefined;
    const controller = new AbortController();
    const k = `${lat},${lon},${radiusKm}`;
    fetch(`/api/thermal/samples?lat=${lat}&lon=${lon}&radius_km=${radiusKm}&limit=50`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setState({ key: k, data, error: "" }))
      .catch((error) => error.name !== "AbortError" && setState({ key: k, data: null, error: error.message }));
    return () => controller.abort();
  }, [lat, lon, radiusKm]);

  const stops = useMemo(() => RAMP.map((t) => cssVar(t) || "#808080"), []);
  const data = state.key === key ? state.data : null;
  const error = state.key === key ? state.error : "";
  const tag = <SourceTag ledgerId="THEMIS" evidence="OBSERVED" detail="HISTORICAL · Mars Odyssey THEMIS" />;
  if (!key) return <div className="nn-thermal-card nn-dim">Select a site to see the THEMIS heatmap.</div>;
  if (error) return <div className="nn-thermal-card">THEMIS samples UNAVAILABLE · {error} {tag}</div>;
  if (!data) return <div className="nn-thermal-card nn-dim" aria-busy="true">THEMIS heatmap · loading…</div>;
  if (!data.count) {
    return (
      <div className="nn-thermal-card">
        No archived THEMIS IR-PBT samples within {radiusKm} km. Nothing is interpolated. {tag}
      </div>
    );
  }
  const { mean_k: grid, row_bin_h: rowH, col_bin_deg: colDeg } = data.heatmap;
  const lo = data.stats.min_k;
  const hi = data.stats.max_k;
  const span = Math.max(1, hi - lo);
  const cell = 14;
  const rows = grid.length;
  const cols = grid[0].length;
  const nearest = data.samples[0];
  return (
    <div className="nn-thermal-card">
      <div className="nn-thermal-head">
        <span>THERMAL HEATMAP · local time × season</span>
        {tag}
      </div>
      <svg width={cols * cell + 34} height={rows * cell + 24} role="img" aria-label={`THEMIS brightness temperature heatmap, ${data.count} samples within ${radiusKm} km`}>
        {grid.map((row, r) =>
          row.map((v, c) => (
            <rect key={`${r}-${c}`} x={30 + c * cell} y={r * cell} width={cell - 1} height={cell - 1} style={{ fill: v == null ? "var(--nn-surface-2)" : rampColor(((v - lo) / span) * 100, stops) }}>
              <title>{v == null ? `LST ${r * rowH}-${(r + 1) * rowH} h, Ls ${c * colDeg}-${(c + 1) * colDeg}°: no sample` : `LST ${r * rowH}-${(r + 1) * rowH} h, Ls ${c * colDeg}-${(c + 1) * colDeg}°: ${v.toFixed(1)} K (n=${data.heatmap.counts[r][c]})`}</title>
            </rect>
          )),
        )}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={0} y={(h / rowH) * cell + 9} className="nn-thermal-axis">{`${h}h`}</text>
        ))}
        {[0, 90, 180, 270].map((ls) => (
          <text key={ls} x={30 + (ls / colDeg) * cell} y={rows * cell + 12} className="nn-thermal-axis">{`Ls ${ls}`}</text>
        ))}
      </svg>
      <div className="nn-thermal-bar" aria-label={`Color bar ${lo.toFixed(0)} to ${hi.toFixed(0)} K`}>
        <span>{lo.toFixed(0)} K</span>
        <i style={{ background: `linear-gradient(90deg, ${stops.join(", ")})` }} />
        <span>{hi.toFixed(0)} K</span>
      </div>
      <div className="nn-thermal-meta">
        n = {data.count} samples within {radiusKm} km · MIN {data.stats.min_k.toFixed(1)} · MEAN {data.stats.mean_k.toFixed(1)} · MAX {data.stats.max_k.toFixed(1)} K
        <br />
        nearest {nearest.product_id} at {nearest.distance_km} km · {nearest.tb_k} K · Ls {nearest.ls_deg}° · LST {nearest.lst_h} h
      </div>
    </div>
  );
}
