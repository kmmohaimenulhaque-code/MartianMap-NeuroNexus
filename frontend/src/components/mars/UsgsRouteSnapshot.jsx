/*
 * USGS ROUTE SNAPSHOT
 *
 * A scientific representation of the same geography as the left-hand route,
 * built from real USGS/ArcGIS map services:
 *   - geologic units, contacts, structures and landing sites from the
 *     SIM 3292 FeatureServer, drawn as vectors in the USGS web map's own
 *     renderer colors (no raster basemap, so the map stays sharp at any extent)
 * The route is drawn in the map's own Robinson projection, so the geometry is
 * correct rather than a visually impressive approximation.
 */

import { snapshotMarkScale } from "../../utils/snapshotScale";
import UsgsGeologyLayers from "./UsgsGeologyLayers";

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
  const k = snapshotMarkScale(width, height);
  const units = snapshot?.geology?.units_crossed ?? [];
  const multi = (snapshot?.routes ?? []).length > 1;

  return (
    <div className="snapshot-backdrop" role="dialog" aria-label="USGS route snapshot">
      <section className="snapshot">
        <header>
          <div>
            <span className="eyebrow">USGS SIM 3292 · ROUTE SCIENTIFIC SNAPSHOT</span>
            <h2>{snapshot?.route?.name ?? "ROUTE"} · USGS VIEW</h2>
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
        {error && <div className="ai-error">USGS SNAPSHOT UNAVAILABLE · {error}</div>}
        {snapshot?.errors?.length > 0 && <div className="ai-error">{snapshot.errors.join(" · ")}</div>}

        {snapshot && (
          <div className="snapshot-body">
            <div className="snapshot-canvas">
              <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="USGS route snapshot">
                <UsgsGeologyLayers geology={snapshot.geology} width={width} height={height} k={k} />
                {(snapshot.routes ?? []).map((overlay, overlayIndex) => (
                  <g key={overlay.route_id ?? overlayIndex}>
                    <polyline points={overlay.route_px.map((point) => point.join(",")).join(" ")} fill="none" stroke="#04080b" strokeOpacity="0.85" strokeWidth={7 * k} strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={overlay.route_px.map((point) => point.join(",")).join(" ")} fill="none" stroke={overlay.colour ?? "#01ffff"} strokeWidth={3 * k} strokeLinecap="round" strokeLinejoin="round" />
                    {[overlay.route_px[0], overlay.route_px[overlay.route_px.length - 1]].map((point, end) => (
                      <circle key={end} cx={point[0]} cy={point[1]} r={6 * k} fill={end ? "#ff647c" : "#62f59a"} stroke={overlay.colour ?? "#04080b"} strokeWidth={2 * k} />
                    ))}
                  </g>
                ))}
                {!(snapshot.routes ?? []).length && (
                  <polyline
                    points={(snapshot.route_px ?? []).map((point) => point.join(",")).join(" ")}
                    fill="none"
                    stroke="#04080b"
                    strokeOpacity="0.85"
                    strokeWidth={7 * k}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {!(snapshot.routes ?? []).length && (
                  <polyline
                    points={(snapshot.route_px ?? []).map((point) => point.join(",")).join(" ")}
                    fill="none"
                    stroke="#01ffff"
                    strokeWidth={3 * k}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {!(snapshot.routes ?? []).length && (snapshot.route_px ?? []).map((point, index) => (
                  <circle
                    key={index}
                    cx={point[0]}
                    cy={point[1]}
                    r={(index === 0 || index === snapshot.route_px.length - 1 ? 6 : 3) * k}
                    fill={index === 0 ? "#62f59a" : index === snapshot.route_px.length - 1 ? "#ff647c" : "#01ffff"}
                    stroke="#04080b"
                    strokeWidth={1.5 * k}
                  />
                ))}
                {(snapshot.geology?.landing_sites ?? []).map((site, index) => (
                  <g key={`l-${index}`}>
                    <rect x={site.px[0] - 4 * k} y={site.px[1] - 4 * k} width={8 * k} height={8 * k} fill="#ffffff" stroke="#04080b" />
                    <text x={site.px[0] + 8 * k} y={site.px[1] + 4 * k} fontSize={11 * k} fill="#04080b" stroke="#ffffff" strokeWidth={3 * k} paintOrder="stroke">
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
                  {!multi && (
                    <>
                      <dt>Route ID</dt>
                      <dd>{snapshot.route?.route_id ?? "n/a"}</dd>
                    </>
                  )}
                  {multi ? (
                    <>
                      <dt>Routes</dt>
                      <dd>{snapshot.routes.length} (metrics per route below)</dd>
                    </>
                  ) : (
                  <>
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
                  </>
                  )}
                  <dt>Method</dt>
                  <dd>{snapshot.route?.generation_method ?? "n/a"}</dd>
                </dl>
              </div>

              {(snapshot.routes ?? []).length > 0 && (
                <div className="snapshot-block">
                  <h3>Routes in this frame ({snapshot.routes.length})</h3>
                  <ul className="snapshot-units">
                    {snapshot.routes.map((overlay) => (
                      <li key={overlay.route_id ?? overlay.name}>
                        <span className="unit-swatch" style={{ background: overlay.colour }} />
                        <div>
                          <strong>{overlay.name}</strong>
                          {snapshot.route?.per_route?.[overlay.route_id] && (
                            <small>
                              {format(snapshot.route.per_route[overlay.route_id].distance_km, 2, " km")} ·{" "}
                              {format(snapshot.route.per_route[overlay.route_id].estimated_eva_hours, 2, " h EVA")} · risk{" "}
                              {format(snapshot.route.per_route[overlay.route_id].terrain_risk_proxy, 1)}
                            </small>
                          )}
                          <small>
                            {(overlay.units_crossed ?? []).map((unit) => `${unit.unit} ${(unit.fraction_of_route * 100).toFixed(0)}%`).join(" · ") ||
                              "No mapped unit crossed"}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!(snapshot.routes ?? []).length && <div className="snapshot-block">
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
              </div>}

              <div className="snapshot-block">
                <h3>Provenance</h3>
                <p>{snapshot.provenance?.basemap}</p>
                <p>{snapshot.provenance?.geology}</p>
                <p>{snapshot.provenance?.route_geometry}</p>
                <p>Projection: {snapshot.projection?.name}</p>
                <p>{snapshot.resolution_note}</p>
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
