/* Season charts for the conditions card: MY34 dust tau, REMS pressure and air temperature, archived RAD dose,
 * all on one Ls axis with the cursor at the active sol's season. Different years and sources: each is labeled. */

import { useEffect, useState } from "react";

import NeonLineChart from "../ui/NeonLineChart";
import SourceTag from "../sources/SourceTag";

let cache = null;

export default function SeasonalCharts({ ls, tauByLs }) {
  const [data, setData] = useState(cache);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cache) return undefined;
    const controller = new AbortController();
    fetch("/api/conditions/seasonal?site=gale", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => {
        cache = body;
        setData(body);
      })
      .catch((e) => e.name !== "AbortError" && setError(e.message));
    return () => controller.abort();
  }, []);
  const fmtLs = (x) => `Ls ${Math.round(x)}°`;
  const charts = [
    { id: "tau", title: "DUST τ · MY34 SCENARIO (THIS CELL)", series: [{ id: "tau", label: "τ", colour: "#75e6ff", points: tauByLs }], fy: (y) => y.toFixed(2), tag: "NASA_AMES_MGCM" },
    data && { id: "p", title: `PRESSURE · REMS SOLS ${data.pressure_pa.sols?.join("–")} (GALE)`, series: [{ id: "p", label: "Pa", colour: "#4ea8de", points: data.pressure_pa.points }], fy: (y) => `${Math.round(y)} Pa`, tag: "MSL_REMS_OUTREACH" },
    data && {
      id: "t",
      title: "AIR TEMPERATURE MIN / MAX · REMS (GALE)",
      series: [
        { id: "tmin", label: "min", colour: "#1a8fa8", points: data.air_temp_min_k.points },
        { id: "tmax", label: "max", colour: "#8cf0b1", points: data.air_temp_max_k.points },
      ],
      fy: (y) => `${Math.round(y)} K`,
      tag: "MSL_REMS_OUTREACH",
    },
    data && { id: "rad", title: `RAD DOSE RATE (E) · SOLS ${data.rad_e_ugy_day.sols?.join("–")} (GALE)`, series: [{ id: "r", label: "µGy/day", colour: "#d8f6ff", points: data.rad_e_ugy_day.points }], fy: (y) => `${Math.round(y)} µGy/d`, tag: "MSL_RAD_RDR" },
  ].filter(Boolean);
  return (
    <div className="nn-season-charts" data-testid="season-charts">
      {charts.map((c) =>
        c.series[0].points.length ? (
          <figure key={c.id} className="nn-season-chart">
            <figcaption>
              {c.title} <SourceTag ledgerId={c.tag} compact />
            </figcaption>
            <NeonLineChart series={c.series} cursorX={ls} height={64} area={false} formatX={fmtLs} formatY={c.fy} ariaLabel={c.title} />
          </figure>
        ) : null,
      )}
      {error && <p className="nn-solcond-error">Season series unavailable: {error}</p>}
      <small className="nn-dim">Different Mars years and instruments on one season axis: context, not one record. Cursor = active sol&apos;s Ls.</small>
    </div>
  );
}
