/* Conditions at a coordinate for the console's activeSol: modeled dust tau, solar geometry, EVA dust class. */

import SourceTag from "../sources/SourceTag";
import { useSol } from "../state/solStore";
import { useSolConditions } from "../state/useSolConditions";
import Popover from "../ui/Popover";
import SeasonalCharts from "./SeasonalCharts";

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

export default function SolConditionsCard({ lat, lon, title = "CONDITIONS AT ACTIVE SOL" }) {
  const { label, season } = useSol();
  const c = useSolConditions(lat, lon);
  if (!Number.isFinite(lat)) return <div className="nn-solcond nn-dim">Select a site to read its conditions at the active sol.</div>;
  const cls = c.solar?.dustClass;
  return (
    <div className="nn-solcond" data-testid="sol-conditions">
      <div className="nn-solcond-head">
        <span>{title}</span>
        <strong>{label}</strong>
        <small>{season}</small>
      </div>
      <dl className="nn-solcond-grid">
        <div>
          <dt>DUST τ (MY34)</dt>
          <dd>{c.loading ? "…" : fmt(c.tau, 2)}</dd>
        </div>
        <div>
          <dt>EVA DUST CLASS</dt>
          <dd className={cls ? `nn-class nn-class--${cls.toLowerCase()}` : undefined}>{cls ? `[${cls}]` : "n/a"}</dd>
        </div>
        <div>
          <dt>NOON SUN</dt>
          <dd>{fmt(c.solar?.noonElevationDeg, 0)}°</dd>
        </div>
        <div>
          <dt>DAYLIGHT</dt>
          <dd>{fmt(c.solar?.daylightH, 1)} H</dd>
        </div>
        <div>
          <dt>NOON DIRECT BEAM</dt>
          <dd>{c.solar?.directBeam != null ? `${(c.solar.directBeam * 100).toFixed(0)}%` : "n/a"}</dd>
        </div>
      </dl>
      {c.error && <p className="nn-solcond-error">Dust scenario: NOT AVAILABLE for this cell ({c.error.replace(/^Request failed: /, "HTTP ")})</p>}
      <SeasonalCharts ls={c.ls} tauByLs={c.tauByLs} />
      <div className="nn-solcond-foot">
        <SourceTag ledgerId="NASA_AMES_MGCM" evidence="MODELED" compact />
        <SourceTag ledgerId="NEURONEXUS_SOLAR_GEOMETRY" compact />
        <Popover label="METHOD" title="How these numbers are made">
          Dust τ is the NASA Ames MGCM MY34 scenario at this 3° cell and sol (a modeled year that includes the 2018 global storm),
          not an observation or a forecast. Declination follows Allison &amp; McEwen (2000) with 25.19° obliquity; noon elevation
          = 90° − |lat − δ|; the direct-beam fraction is exp(−τ / sin(elevation)). EVA dust classes reuse the console's dust bands:
          τ &lt; 0.5 WITHIN, 0.5–1.0 REVIEW, ≥ 1.0 EXCEED. A screening flag for human review, never a safety statement.
        </Popover>
      </div>
    </div>
  );
}
