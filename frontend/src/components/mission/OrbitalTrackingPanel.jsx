import { useMemo } from "react";

/*
 * NEAR-MARS SMALL-BODY TRACKING
 *
 * Observation, tracking and close-approach awareness only. This subsystem
 * contains no interception, targeting or countermeasure capability.
 *
 * Source: NASA/JPL Solar System Dynamics Close-Approach Data API, queried
 * with body=Mars. A close approach is not an impact prediction.
 */

const BAND_TONE = {
  "HIGH-PRIORITY MONITORING": "high",
  REVIEW: "review",
  MONITORING: "monitor",
  "LOW-CONCERN": "low",
  "DATA ONLY": "unclassified",
};

function format(value, digits = 3, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "UNAVAILABLE";
  }
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function SchematicTrack({ objects }) {
  /*
   * Mars-centred distance schematic. This is a log-distance plot of nominal
   * close-approach distance with the 3-sigma distance range drawn as the
   * uncertainty bar. It is deliberately NOT presented as a 3-D orbit: JPL CAD
   * does not supply approach direction, so no direction is implied.
   */
  const width = 760;
  const height = 210;
  const marsX = 70;
  const maxAu = Math.max(0.06, ...objects.map((object) => object.distance_max_au ?? object.distance_au ?? 0));
  const scale = (au) => {
    const clamped = Math.max(au ?? 0, 0.0005);
    return marsX + ((Math.log10(clamped) - Math.log10(0.0005)) / (Math.log10(maxAu) - Math.log10(0.0005))) * (width - marsX - 40);
  };
  const rows = objects.slice(0, 8);
  const step = rows.length ? (height - 60) / rows.length : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      className="orbital-schematic"
      role="img"
      aria-label="Mars-centred close-approach distance schematic"
    >
      <line x1={marsX} y1="26" x2={marsX} y2={height - 18} stroke="#75e6ff" strokeOpacity="0.35" strokeDasharray="3 3" />
      <circle cx={marsX} cy={height / 2} r="12" fill="#c1440e" stroke="#ff9f68" strokeWidth="1.5" />
      <text x={marsX} y={height - 4} fontSize="9" fill="#8aa0a8" textAnchor="middle">
        MARS
      </text>
      {[0.001, 0.01, 0.05].map((au) => (
        <g key={au}>
          <line x1={scale(au)} y1="22" x2={scale(au)} y2={height - 22} stroke="#29414b" strokeDasharray="2 4" />
          <text x={scale(au)} y="16" fontSize="9" fill="#5d7078" textAnchor="middle">
            {au} au
          </text>
        </g>
      ))}
      {rows.map((object, index) => {
        const y = 34 + index * step;
        const x = scale(object.distance_au);
        const xMin = scale(object.distance_min_au ?? object.distance_au);
        const xMax = scale(object.distance_max_au ?? object.distance_au);
        return (
          <g key={object.designation ?? index}>
            <line x1={xMin} y1={y} x2={xMax} y2={y} stroke="#75e6ff" strokeOpacity="0.35" strokeWidth="6" strokeLinecap="round" />
            <circle cx={x} cy={y} r="4.5" fill={object.tracking_status === "HIGH-PRIORITY MONITORING" ? "#ff647c" : "#75e6ff"} />
            <text x={x + 10} y={y + 3.5} fontSize="9" fill="#a8bbc1">
              {object.designation}
            </text>
          </g>
        );
      })}
      <text x={width - 8} y={height - 4} fontSize="8" fill="#5d7078" textAnchor="end">
        LOG DISTANCE · BAR = JPL 3σ RANGE · DIRECTION NOT IMPLIED
      </text>
    </svg>
  );
}

export default function OrbitalTrackingPanel({ open, onClose, data, loading, error, onRefresh, horizonDays, onHorizonChange }) {
  const objects = useMemo(() => data?.objects ?? [], [data]);

  if (!open) {
    return null;
  }

  return (
    <div className="orbital-backdrop" role="dialog" aria-label="Near-Mars orbital tracking">
      <section className="orbital">
        <header>
          <div>
            <span className="eyebrow">SITUATIONAL AWARENESS · NASA/JPL</span>
            <h2>NEAR-MARS ORBITAL TRACKING</h2>
            <small>Detection, tracking and close-approach awareness. Not an interception or defence system.</small>
          </div>
          <div className="orbital-actions">
            <label>
              HORIZON
              <select value={horizonDays} onChange={(event) => onHorizonChange(Number(event.target.value))}>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
                <option value={1095}>3 years</option>
              </select>
            </label>
            <button type="button" onClick={onRefresh} disabled={loading}>
              {loading ? "QUERYING…" : "REFRESH"}
            </button>
            <button type="button" className="ai-close" onClick={onClose} aria-label="Close tracking">
              ×
            </button>
          </div>
        </header>

        <div className="orbital-status">
          <span className={`orbital-state ${data?.status === "live" ? "ok" : "warn"}`}>
            {data?.tracking_status ?? (loading ? "QUERYING SOURCE…" : "NOT QUERIED")}
          </span>
          {data?.retrieved_at && <span>RETRIEVED {new Date(data.retrieved_at).toLocaleString()}</span>}
          {data?.signature && (
            <span>
              {data.signature.source} v{data.signature.version}
            </span>
          )}
          <a href="https://ssd-api.jpl.nasa.gov/doc/cad.html" target="_blank" rel="noreferrer">
            JPL CAD API ↗
          </a>
          <a href="https://cneos.jpl.nasa.gov/" target="_blank" rel="noreferrer">
            CNEOS ↗
          </a>
        </div>

        {(error || data?.status === "unavailable") && (
          <div className="ai-error">
            DATA SOURCE UNAVAILABLE — {error || data?.error}. No close-approach events are shown or inferred while the source is unavailable.
          </div>
        )}

        {objects.length > 0 && (
          <>
            <SchematicTrack objects={objects} />

            <div className="orbital-table-wrap">
              <table className="orbital-table">
                <thead>
                  <tr>
                    <th>Object</th>
                    <th>Designation</th>
                    <th>Close approach (TDB)</th>
                    <th>Distance</th>
                    <th>3σ range</th>
                    <th>Rel. velocity</th>
                    <th>Time 3σ</th>
                    <th>Diameter</th>
                    <th>Status</th>
                    <th>Orbit</th>
                  </tr>
                </thead>
                <tbody>
                  {objects.map((object) => (
                    <tr key={`${object.designation}-${object.close_approach_tdb}`}>
                      <td>{object.object}</td>
                      <td>{object.designation}</td>
                      <td>{object.close_approach_tdb}</td>
                      <td>
                        {format(object.distance_au, 5, " au")}
                        <small>
                          {format(object.distance_km, 0, " km")} · {format(object.distance_mars_radii, 0, " R♂")}
                        </small>
                      </td>
                      <td>
                        {format(object.distance_min_au, 5)} – {format(object.distance_max_au, 5)} au
                      </td>
                      <td>{format(object.relative_velocity_km_s, 2, " km/s")}</td>
                      <td>
                        {object.time_sigma_raw ?? "UNAVAILABLE"}
                        {object.time_sigma_is_upper_bound ? " (upper bound)" : ""}
                      </td>
                      <td>{object.diameter_km == null ? "UNAVAILABLE" : format(object.diameter_km, 2, " km")}</td>
                      <td>
                        <span className={`orbital-band ${BAND_TONE[object.tracking_status] ?? "unclassified"}`}>{object.tracking_status}</span>
                      </td>
                      <td>
                        <a href={object.sbdb_url} target="_blank" rel="noreferrer">
                          SBDB ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {data?.status === "live" && objects.length === 0 && (
          <div className="orbital-empty">No JPL close-approach record matches this query window. Nothing is inferred from an empty result.</div>
        )}

        <footer className="orbital-footer">
          <p>
            <strong>Classification basis.</strong> {data?.classification_basis}
          </p>
          <ul>
            {(data?.limitations ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="orbital-boundary">
            NeuroNexus performs monitoring only. It does not model, plan or recommend interception, deflection or any destructive countermeasure, and
            a close approach is never presented as a guaranteed impact.
          </p>
        </footer>
      </section>
    </div>
  );
}
