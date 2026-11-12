import { useEffect, useMemo, useState } from "react";

import MarsMap from "../components/mars/MarsMap";
import { fetchUsgsMultiRouteSnapshot, fetchUsgsRouteSnapshot } from "../services/marsEnvironmentApi";
import NeonLineChart from "../ui/NeonLineChart";
import { ProvenanceTag } from "../ui/StatTriplet";
import { fmt } from "../ui/format";
import { COMPARISON_METRICS, comparisonToCsv, rankMetric, readSnapshot, routeColour, routeStats, writeSnapshot } from "../utils/savedRoutes";
import Icon from "../ui/Icon";
import { provenance, provenanceCsvHeader } from "../exports/exporters";
import { useSol } from "../state/solStore";

/*
 * ROUTE COMPARISON WORKSPACE
 *
 * Up to four saved routes side by side: map, overlaid elevation profiles,
 * along-track MIN / MEAN / MAX table with best [BEST] and worst [WORST] marked per row,
 * a USGS SIM 3292 snapshot per route and one combined snapshot.
 */

export const MAX_COMPARE_ROUTES = 4;

function SnapshotFigure({ snapshot, routes, height = 220 }) {
  const image = snapshot?.image;
  const width = image?.width ?? 900;
  const h = image?.height ?? 600;
  const overlays = snapshot?.routes?.length ? snapshot.routes : [{ route_px: snapshot?.route_px ?? [], colour: routes?.[0]?.colour ?? "#75e6ff" }];
  return (
    <svg viewBox={`0 0 ${width} ${h}`} width="100%" style={{ maxHeight: height, display: "block" }} role="img" aria-label="USGS geology snapshot">
      {image?.data_uri && <image href={image.data_uri} x="0" y="0" width={width} height={h} />}
      {(snapshot?.geology?.polygons ?? []).map((polygon, index) =>
        polygon.rings_px.map((ring, ringIndex) => (
          <polygon key={`${index}-${ringIndex}`} points={ring.map((p) => p.join(",")).join(" ")} fill={polygon.color} fillOpacity="0.22" stroke={polygon.color} strokeOpacity="0.45" strokeWidth="1" />
        )),
      )}
      {overlays.map((overlay, index) => (
        <g key={overlay.route_id ?? index}>
          <polyline points={overlay.route_px.map((p) => p.join(",")).join(" ")} fill="none" stroke={overlay.colour ?? "#75e6ff"} strokeOpacity="0.3" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={overlay.route_px.map((p) => p.join(",")).join(" ")} fill="none" stroke={overlay.colour ?? "#75e6ff"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {overlay.route_px.length > 0 && <circle cx={overlay.route_px[0][0]} cy={overlay.route_px[0][1]} r="6" fill="#62f59a" stroke="#04080b" strokeWidth="1.5" />}
          {overlay.route_px.length > 1 && (
            <circle cx={overlay.route_px[overlay.route_px.length - 1][0]} cy={overlay.route_px[overlay.route_px.length - 1][1]} r="6" fill="#ff647c" stroke="#04080b" strokeWidth="1.5" />
          )}
        </g>
      ))}
    </svg>
  );
}

function UnitsCrossed({ units }) {
  if (!units?.length) return <small className="nn-dim">No mapped units crossed (or geology unavailable).</small>;
  return (
    <ul className="cmp-units">
      {units.slice(0, 4).map((unit) => (
        <li key={unit.unit}>
          <span style={{ background: unit.color }} />
          <b>{unit.unit}</b> {Math.round(unit.fraction_of_route * 100)}% <small>{unit.description}</small>
        </li>
      ))}
    </ul>
  );
}

function useRouteSnapshots(routes) {
  const [state, setState] = useState({});
  const key = routes.map((r) => r.geometryHash).join("|");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const route of routes) {
        if (cancelled) return;
        const cacheKey = `route:${route.geometryHash}`;
        setState((s) => (s[route.id]?.snapshot ? s : { ...s, [route.id]: { loading: true } }));
        let snapshot = await readSnapshot(cacheKey);
        let error = "";
        if (!snapshot) {
          try {
            snapshot = await fetchUsgsRouteSnapshot({ id: route.id, name: route.name, coordinates: route.points });
            if (snapshot?.status === "ok") writeSnapshot(cacheKey, snapshot);
          } catch (err) {
            error = err.message;
          }
        }
        if (!cancelled) setState((s) => ({ ...s, [route.id]: { loading: false, snapshot, error } }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

export default function RouteComparisonWorkspace({ routes, compareRouteIds, onToggleRoute, onClose, onDeleteRoute, onReevaluate, onRename, onVerify, onShowIn3D, onExportFile }) {
  const { sol, seasonLs } = useSol();
  const [view, setView] = useState("map");
  const [combinedState, setCombined] = useState({ key: null, loading: false, snapshot: null, error: "" });

  const selected = useMemo(
    () => routes.filter((r) => compareRouteIds.includes(r.id)).map((r) => ({ ...r, colour: routeColour(r) })),
    [routes, compareRouteIds],
  );
  const statsList = useMemo(() => selected.map(routeStats), [selected]);
  const snapshots = useRouteSnapshots(selected);
  const pendingCount = selected.filter((r) => r.evaluation?.status === "pending" || r.evaluation?.status === "running").length;

  const combinedKey = selected.map((r) => r.geometryHash).join("+");
  const combined = combinedState.key === combinedKey ? combinedState : { loading: false, snapshot: null, error: "" };

  async function loadCombined() {
    const key = combinedKey;
    setCombined({ key, loading: true, snapshot: null, error: "" });
    try {
      const cacheKey = `combined:${selected.map((r) => r.geometryHash).join("+")}`;
      let snapshot = await readSnapshot(cacheKey);
      if (!snapshot) {
        snapshot = await fetchUsgsMultiRouteSnapshot(selected);
        if (snapshot?.status === "ok") writeSnapshot(cacheKey, snapshot);
      }
      setCombined({ key, loading: false, snapshot, error: "" });
    } catch (err) {
      setCombined({ key, loading: false, snapshot: null, error: err.message });
    }
  }

  const profileSeries = selected
    .map((route, i) => ({ id: route.id, label: route.name, colour: route.colour, points: (statsList[i].profile ?? []).map(([d, e]) => [d, e]) }))
    .filter((s) => s.points.length > 1);

  return (
    <div className="cmp-backdrop" role="dialog" aria-modal="true" aria-label="Compare saved routes">
      <section className="cmp">
        <header className="cmp-header">
          <div>
            <span className="eyebrow">ROUTE ANALYSIS / ALONG-TRACK NASA MOLA</span>
            <h2>COMPARE MARSWALK ROUTES</h2>
            <small>
              Up to {MAX_COMPARE_ROUTES} routes. Statistics are sampled along each whole path, not only at the waypoints.
              {pendingCount > 0 && ` Evaluating ${pendingCount} route${pendingCount > 1 ? "s" : ""}…`}
            </small>
          </div>
          <div className="cmp-actions">
            <div className="cmp-tabs" role="tablist">
              {[
                ["map", "2D MAP"],
                ["profile", "PROFILE"],
              ].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
                  {label}
                </button>
              ))}
              <button type="button" onClick={onShowIn3D} disabled={selected.length === 0}>
                3D ↗
              </button>
            </div>
            <button type="button" disabled={!selected.length} onClick={() => onExportFile("route-comparison", "csv", provenanceCsvHeader(provenance({ sol, seasonLs })) + comparisonToCsv(selected), "text/csv;charset=utf-8")}>
              CSV
            </button>
            <button
              type="button"
              disabled={!selected.length}
              onClick={() =>
                onExportFile(
                  "route-comparison",
                  "json",
                  JSON.stringify(
                    {
                      schema: "neuronexus.route-comparison.v1",
                      generated_at: new Date().toISOString(),
                      provenance: "NASA MOLA MEGDR 128 ppd along-track sampling (DERIVED) · USGS SIM 3292",
                      export_provenance: provenance({ sol, seasonLs }),
                      routes: selected.map((r, i) => ({ id: r.id, name: r.name, colour: r.colour, points: r.points, generation: r.generation ?? null, reproducibility: r.reproducibility ?? null, stats: statsList[i] })),
                    },
                    null,
                    2,
                  ),
                  "application/json",
                )
              }
            >
              JSON
            </button>
            <button type="button" className="ai-close" onClick={onClose} aria-label="Close comparison">
              ×
            </button>
          </div>
        </header>

        <div className="cmp-chips">
          {routes.map((route) => {
            const active = compareRouteIds.includes(route.id);
            const colour = routeColour(route);
            const full = !active && compareRouteIds.length >= MAX_COMPARE_ROUTES;
            return (
              <button
                key={route.id}
                type="button"
                onClick={() => onToggleRoute(route.id)}
                disabled={full}
                title={full ? `Maximum ${MAX_COMPARE_ROUTES} routes` : undefined}
                className={active ? "active" : ""}
                style={{ "--chip": colour }}
              >
                <span className="cmp-swatch" />
                {active ? <Icon name="check" size={12} /> : null}
                {route.name}
              </button>
            );
          })}
        </div>

        {selected.length < 2 ? (
          <div className="cmp-empty">SELECT AT LEAST TWO SAVED ROUTES · MAXIMUM {MAX_COMPARE_ROUTES}</div>
        ) : (
          <>
            {view === "map" ? (
              <div className="cmp-map">
                <MarsMap features={[]} selectedFeature={null} selectedLocation={null} customPlaces={[]} safeHavens={[]} routeMode={false} routePoints={[]} routePlan={null} comparisonMode comparisonRoutes={selected} interactive />
              </div>
            ) : (
              <div className="cmp-profile">
                {profileSeries.length ? (
                  <NeonLineChart
                    series={profileSeries}
                    height={200}
                    width={900}
                    area={false}
                    formatX={(x) => `${x.toFixed(1)} km`}
                    formatY={(y) => `${Math.round(y).toLocaleString()} m`}
                    xLabel="DISTANCE ALONG ROUTE"
                    yLabel="ELEVATION m"
                    ariaLabel="Elevation profiles of compared routes"
                  />
                ) : (
                  <div className="nn-degraded">Profiles appear once the along-track evaluation finishes.</div>
                )}
              </div>
            )}

            <div className="cmp-table-wrap">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th scope="col">METRIC</th>
                    {selected.map((route, i) => (
                      <th key={route.id} scope="col" style={{ color: route.colour }}>
                        ■ {route.name}
                        <small>{statsList[i].status === "waypoints-only" ? "WAYPOINTS ONLY" : `${statsList[i].sampleCount ?? "?"} samples`}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_METRICS.map((metric) => {
                    const { best, worst } = rankMetric(metric, statsList);
                    return (
                      <tr key={metric.key}>
                        <th scope="row">
                          {metric.label} <small>{metric.unit}</small>
                        </th>
                        {statsList.map((stats, i) => (
                          <td key={selected[i].id} className={i === best ? "cmp-best" : i === worst ? "cmp-worst" : ""}>
                            {fmt(metric.get(stats), metric.digits) ?? "n/a"}
                            {i === best ? <span className="rc-mark rc-best"> [BEST]</span> : i === worst ? <span className="rc-mark rc-worst"> [WORST]</span> : null}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="nn-footnote">
                [BEST] best · gold dotted = [WORST] worst, per row and by stated direction (elevation rows are informational). Basis: NASA MOLA MEGDR 128 ppd sampled along each path
                (DERIVED). Terrain risk is a NeuroNexus planning proxy, not a safety certification.
              </div>
            </div>

            <div className="cmp-snapshots-head">
              <span className="eyebrow">USGS SIM 3292 SNAPSHOTS</span>
              <ProvenanceTag dataClass="OBSERVED" ledgerId="USGS_SIM_3292_ARCGIS" source="USGS MOLA hillshade + SIM 3292 FeatureServer" />
              <button type="button" onClick={loadCombined} disabled={combined.loading}>
                {combined.loading ? "BUILDING…" : "COMBINED SNAPSHOT"}
              </button>
            </div>
            {(combined.snapshot || combined.error) && (
              <div className="cmp-combined">
                {combined.error ? <div className="nn-degraded">COMBINED SNAPSHOT UNAVAILABLE · {combined.error}</div> : <SnapshotFigure snapshot={combined.snapshot} height={380} />}
              </div>
            )}
            <div className="cmp-snapshots">
              {selected.map((route, i) => {
                const entry = snapshots[route.id] ?? { loading: true };
                const stats = statsList[i];
                return (
                  <article key={route.id} className="cmp-card" style={{ "--chip": route.colour }}>
                    <header>
                      <strong>
                        ■ {route.name}
                        <small className="cmp-source">{route.generation?.source === "ai-route-designer" ? ` AI · ${route.generation.candidate_name ?? ""}` : " MANUAL"}</small>
                      </strong>
                      {entry.snapshot?.wab_sync_url && (
                        <a href={entry.snapshot.wab_sync_url} target="_blank" rel="noreferrer">
                          USGS MAP ↗
                        </a>
                      )}
                    </header>
                    {entry.loading ? (
                      <div className="cmp-snap-loading">BUILDING SNAPSHOT…</div>
                    ) : entry.error || !entry.snapshot ? (
                      <div className="nn-degraded">SNAPSHOT UNAVAILABLE · {entry.error || "no response"}</div>
                    ) : (
                      <SnapshotFigure snapshot={entry.snapshot} routes={[route]} />
                    )}
                    <div className="cmp-card-stats">
                      <span>ELEV</span>
                      <b>
                        {fmt(stats.elevation_m?.min, 0) ?? "n/a"} / {fmt(stats.elevation_m?.mean, 0) ?? "n/a"} / {fmt(stats.elevation_m?.max, 0) ?? "n/a"} m
                      </b>
                      <span>SLOPE</span>
                      <b>
                        {fmt(stats.slope_deg?.min, 1) ?? "n/a"} / {fmt(stats.slope_deg?.mean, 1) ?? "n/a"} / {fmt(stats.slope_deg?.max, 1) ?? "n/a"}°
                      </b>
                      <span>ROUGH</span>
                      <b>
                        {fmt(stats.roughness_m?.min, 1) ?? "n/a"} / {fmt(stats.roughness_m?.mean, 1) ?? "n/a"} / {fmt(stats.roughness_m?.max, 1) ?? "n/a"} m
                      </b>
                    </div>
                    <UnitsCrossed units={entry.snapshot?.geology?.units_crossed} />
                    {route.reproducibility && (
                      <div className={`cmp-repro cmp-repro-${route.reproducibility.status}`}>
                        {route.reproducibility.status === "checking" ? "VERIFYING…" : `${route.reproducibility.status.toUpperCase()} · ${route.reproducibility.detail}`}
                      </div>
                    )}
                    <footer>
                      <button type="button" onClick={() => onRename(route.id)}>
                        RENAME
                      </button>
                      <button type="button" onClick={() => onVerify(route.id)} title="Regenerate or re-evaluate and compare with the saved record">
                        VERIFY
                      </button>
                      {route.evaluation?.status === "error" && (
                        <button type="button" onClick={() => onReevaluate(route.id)}>
                          RETRY EVALUATION
                        </button>
                      )}
                      <button type="button" className="danger" onClick={() => onDeleteRoute(route.id)}>
                        DELETE
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
