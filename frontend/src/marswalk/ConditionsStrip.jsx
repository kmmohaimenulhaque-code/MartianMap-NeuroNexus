/* CONDITIONS: archived RAD dose rate (with lag), EVA dose band, REMS outreach line, and the modeled dust and
 * solar geometry at the console's activeSol (refetched as the sol slider moves). */

import { useEffect, useState } from "react";

import { useSol } from "../state/solStore";

import SourceTag from "../sources/SourceTag";
import { marswalkApi } from "./marswalkApi";

export default function ConditionsStrip({ site, evaHours, onConditions }) {
  const { sol } = useSol();
  const [state, setState] = useState({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      marswalkApi
        .conditions(site, sol, { signal: controller.signal })
        .then((data) => {
          setState({ status: "ready", data });
          onConditions?.(data);
        })
        .catch((error) => error.name !== "AbortError" && setState({ status: "error", error: error.message }));
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [site, sol, onConditions]);

  if (state.status === "loading") return <section className="mw-card mw-skeleton">CONDITIONS · loading…</section>;
  if (state.status === "error") {
    return (
      <section className="mw-card">
        <h3>CONDITIONS</h3>
        <p className="mw-error">INSUFFICIENT DATA FOR AN ESTIMATE · {state.error}</p>
      </section>
    );
  }
  const { rad, weather, dust, season, meda, solar } = state.data;
  const dose = rad?.rate_E_median != null ? rad.rate_E_median * (evaHours / 24) : null;
  return (
    <section className="mw-card">
      <h3>CONDITIONS · {season?.label ?? site.toUpperCase()}</h3>
      <div className="mw-row">
        <span className="mw-row-label">RAD dose rate (E)</span>
        {rad?.status === "UNAVAILABLE" ? (
          <strong className="mw-error">{rad.reason}</strong>
        ) : (
          <strong>
            {rad.rate_E_median?.toFixed(0)} µGy/day (IQR {rad.iqr?.[0]?.toFixed(0)}–{rad.iqr?.[1]?.toFixed(0)})
          </strong>
        )}
        <SourceTag ledgerId="MSL_RAD_RDR" detail={rad?.latest_sol ? `sol ${rad.latest_sol} · lag ${rad.lag_days} d` : undefined} />
        <small>Archived, not live: latest archived sol {rad?.latest_sol ?? "n/a"}, archive lag {rad?.lag_days ?? "n/a"} days.</small>
      </div>
      <div className="mw-row">
        <span className="mw-row-label">EVA dose band</span>
        <strong>{dose != null ? `${dose.toFixed(0)} µGy for ${evaHours} h` : "n/a"}</strong>
        <SourceTag ledgerId="NEURONEXUS_DOSE_SCREENING" />
        <small>Screening estimate. At EVA scale the altitude term is below 1%, so the route is not colored by dose.</small>
      </div>
      <div className="mw-row">
        <span className="mw-row-label">Weather</span>
        <strong>{weather?.line ?? weather?.reason ?? "n/a"}</strong>
        <SourceTag ledgerId={weather?.ledger_id ?? "MSL_REMS_OUTREACH"} />
        <small>OUTREACH FEED (CAB/NASA), not for operations.</small>
      </div>
      {meda && (
        <div className="mw-row">
          <span className="mw-row-label">Perseverance MEDA</span>
          <strong>{meda.status}</strong>
          <SourceTag ledgerId="M2020_MEDA_OUTREACH" />
        </div>
      )}
      <div className="mw-row">
        <span className="mw-row-label">Dust τ (MY34 sol {dust?.my34_sol ?? "n/a"})</span>
        <strong>
          {dust?.tau != null ? dust.tau.toFixed(2) : "n/a"}
          {solar?.dust_class && <span className={`nn-class nn-class--${solar.dust_class.toLowerCase()}`}> [{solar.dust_class}]</span>}
        </strong>
        <SourceTag ledgerId="NASA_AMES_MGCM" evidence="MODELED" />
        <small>Modeled scenario, not an observation or forecast.</small>
      </div>
      {solar && (
        <div className="mw-row">
          <span className="mw-row-label">Solar geometry</span>
          <strong>
            noon {solar.noon_elevation_deg.toFixed(0)}° · day {solar.daylight_h.toFixed(1)} h
            {solar.noon_direct_beam_fraction != null ? ` · direct beam ${(solar.noon_direct_beam_fraction * 100).toFixed(0)}%` : ""}
          </strong>
          <SourceTag ledgerId="NEURONEXUS_SOLAR_GEOMETRY" />
          <small>{solar.basis}</small>
        </div>
      )}
    </section>
  );
}
