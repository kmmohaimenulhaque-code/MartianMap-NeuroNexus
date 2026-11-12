/*
 * USGS ROUTE SNAPSHOT
 *
 * A scientific representation of the same geography as the left-hand route,
 * built from real USGS/ArcGIS map services:
 *   - MOLA hillshade tiles from the SIM 3292 web map's own basemap service
 *   - geologic units, contacts, structures and landing sites from the
 *     SIM 3292 FeatureServer
 * The route is drawn in the map's own Robinson projection, so the geometry is
 * correct rather than a visually impressive approximation.
 */

function format(value, digits = 2, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "UNAVAILABLE";
  }
  return `${Number(value).toFixed(digits)}${suffix}`;
}

export default function UsgsRouteSnapshot({ open, onClose, snapshot, loading, error, onExport }) {
  if (!open) {
    return null;
  }
  const image = snapshot?.image;
  const width = image?.width ?? 900;
  const height = image?.height ?? 600;
  const units = snapshot?.geology?.units_crossed ?? [];

  return (
    <div className="snapshot-backdrop" role="dialog" aria-label="USGS route snapshot">
      <section className="snapshot">
        <header>
          <div>
            <span className="eyebrow">USGS SIM 3292 · ROUTE SCIENTIFIC SNAPSHOT</span>
            <h2>{snapshot?.route?.name ?? "ROUTE"} — USGS VIEW</h2>
            <small>{snapshot?.source?.map ?? "USGS Geologic Map of Mars"}</small>
          </div>
          <div className="snapshot-actions">
            {snapshot && (
              <button type="button" onClick={onExport}>
                EXPORT ROUTE SNAPSHOT
              </button>
            )}
            {snapshot?.wab_sync_url && (
              <a className="snapshot-link" href={snapshot.wab_sync_url} target="_blank" rel="noreferrer">
                OPEN IN USGS MAP ↗
              </a>
            )}
            <button type="button" className="ai-close" onClick={onClose} aria-label="Close snapshot">
              ×
            </button>
          </div>
        </header>

        {loading && <div className="snapshot-status">BUILDING SNAPSHOT FROM USGS MAP SERVICES…</div>}
        {error && <div className="ai-error">USGS SNAPSHOT UNAVAILABLE — {error}</div>}
        {snapshot?.errors?.length > 0 && <div className="ai-error">{snapshot.errors.join(" · ")}</div>}

        {snapshot && (
          <div className="snapshot-body">
            <div className="snapshot-canvas">
              <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="USGS route snapshot">
                {image?.data_uri && <image href={image.data_uri} x="0" y="0" width={width} height={height} />}
                {(snapshot.geology?.polygons ?? []).map((polygon, index) =>
                  polygon.rings_px.map((ring, ringIndex) => (
                    <polygon
                      key={`${index}-${ringIndex}`}
                      points={ring.map((point) => point.join(",")).join(" ")}
                      fill={polygon.color}
                      fillOpacity="0.28"
                      stroke={polygon.color}
                      strokeOpacity="0.55"
                      strokeWidth="1"
                    />
                  )),
                )}
                {(snapshot.geology?.contacts ?? []).map((contact, index) =>
                  contact.paths_px.map((path, pathIndex) => (
                    <polyline
                      key={`c-${index}-${pathIndex}`}
                      points={path.map((point) => point.join(",")).join(" ")}
                      fill="none"
                      stroke="#e5e7eb"
                      strokeOpacity="0.5"
                      strokeWidth="1"
                      strokeDasharray="4 3"
                    />
                  )),
                )}
                {(snapshot.geology?.structures ?? []).map((structure, index) =>
                  structure.paths_px.map((path, pathIndex) => (
                    <polyline
                      key={`s-${index}-${pathIndex}`}
                      points={path.map((point) => point.join(",")).join(" ")}
                      fill="none"
                      stroke="#ff9f68"
                      strokeOpacity="0.8"
                      strokeWidth="1.4"
                    />
                  )),
                )}
                <polyline
                  points={(snapshot.route_px ?? []).map((point) => point.join(",")).join(" ")}
                  fill="none"
                  stroke="#75e6ff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {(snapshot.route_px ?? []).map((point, index) => (
                  <circle
                    key={index}
                    cx={point[0]}
                    cy={point[1]}
                    r={index === 0 || index === snapshot.route_px.length - 1 ? 6 : 3}
                    fill={index === 0 ? "#62f59a" : index === snapshot.route_px.length - 1 ? "#ff647c" : "#75e6ff"}
                    stroke="#04080b"
                    strokeWidth="1.5"
                  />
                ))}
                {(snapshot.geology?.landing_sites ?? []).map((site, index) => (
                  <g key={`l-${index}`}>
                    <rect x={site.px[0] - 4} y={site.px[1] - 4} width="8" height="8" fill="#ffd166" stroke="#04080b" />
                    <text x={site.px[0] + 8} y={site.px[1] + 4} fontSize="11" fill="#ffd166">
                      {site.attributes?.NAME}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <aside className="snapshot-side">
              <div className="snapshot-block">
                <h3>Route record</h3>
                <dl>
                  <dt>Route ID</dt>
                  <dd>{snapshot.route?.route_id ?? "—"}</dd>
                  <dt>Start</dt>
                  <dd>
                    {format(snapshot.start?.latitude_deg, 4, "°")}, {format(snapshot.start?.longitude_deg, 4, "°E")}
                  </dd>
                  <dt>End</dt>
                  <dd>
                    {format(snapshot.end?.latitude_deg, 4, "°")}, {format(snapshot.end?.longitude_deg, 4, "°E")}
                  </dd>
                  <dt>Waypoints</dt>
                  <dd>{snapshot.coordinates?.length ?? 0}</dd>
                  <dt>Distance</dt>
                  <dd>{format(snapshot.route?.metrics?.distance_km, 2, " km")}</dd>
                  <dt>Estimated EVA</dt>
                  <dd>{format(snapshot.route?.metrics?.estimated_eva_hours, 2, " h")}</dd>
                  <dt>Terrain burden</dt>
                  <dd>{format(snapshot.route?.metrics?.terrain_burden_score, 1)}</dd>
                  <dt>Risk proxy</dt>
                  <dd>{format(snapshot.route?.metrics?.terrain_risk_proxy, 1)}</dd>
                  <dt>Science evidence</dt>
                  <dd>{snapshot.route?.metrics?.science_evidence_count ?? "UNAVAILABLE"}</dd>
                  <dt>Method</dt>
                  <dd>{snapshot.route?.generation_method ?? "—"}</dd>
                </dl>
              </div>

              <div className="snapshot-block">
                <h3>USGS geologic units crossed</h3>
                {units.length === 0 && <p>No SIM 3292 unit polygon intersects the sampled route in this extent.</p>}
                <ul className="snapshot-units">
                  {units.map((unit) => (
                    <li key={unit.unit}>
                      <span className="unit-swatch" style={{ background: unit.color }} />
                      <div>
                        <strong>{unit.unit}</strong> · {(unit.fraction_of_route * 100).toFixed(0)}% of route
                        <small>{unit.description}</small>
                        {unit.interpretation && <small>{unit.interpretation}</small>}
                        <em>{unit.status}</em>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="snapshot-block">
                <h3>Provenance</h3>
                <p>{snapshot.provenance?.basemap}</p>
                <p>{snapshot.provenance?.geology}</p>
                <p>{snapshot.provenance?.route_geometry}</p>
                <p>Projection: {snapshot.projection?.name}</p>
                <p>{image?.resolution_note}</p>
                <p>
                  Native tile resolution: {format(snapshot.native_resolution_m_per_px, 1, " m/px")} (level {snapshot.level})
                </p>
                <p>{snapshot.geology?.note}</p>
                <a href={snapshot.source?.map_url} target="_blank" rel="noreferrer">
                  USGS SIM 3292 ↗
                </a>
              </div>
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}
