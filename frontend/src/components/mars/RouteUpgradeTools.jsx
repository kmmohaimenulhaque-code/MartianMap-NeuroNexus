import React, { useEffect, useMemo, useState } from "react";
import {
  buildRouteAssessment,
  createRouteSnapshot,
  DEFAULT_EVA_PACE_KMH,
  formatMetric,
} from "../../utils/routeIntelligence";

const STORAGE_KEY =
  "neuronexus-route-snapshots-v1";

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

function saveSnapshots(routes) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(routes.slice(0, 4))
  );
}

function Metric({ label, value }) {
  return (
    <div className="nn-route-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EvidenceItem({
  icon,
  item,
}) {
  return (
    <div className="nn-route-evidence-item">
      <span className="nn-route-evidence-icon">
        {icon}
      </span>

      <div>
        <strong>{item.text}</strong>

        <small>{item.evidence}</small>
      </div>
    </div>
  );
}

export default function RouteUpgradeTools({
  routePoints = [],
  routePlan = null,
  routeLoading = false,
  onAnalyzeRoute,
  onClear,
  onCompare,
  compareMode = false,
}) {
  const [evaPace, setEvaPace] = useState(
    DEFAULT_EVA_PACE_KMH
  );

  const [routeName, setRouteName] =
    useState("");

  const [snapshots, setSnapshots] =
    useState(loadSnapshots);

  const analysis = useMemo(
    () =>
      buildRouteAssessment(
        routePlan,
        routePoints,
        { evaPaceKmh: evaPace }
      ),
    [routePlan, routePoints, evaPace]
  );

  useEffect(() => {
    saveSnapshots(snapshots);
  }, [snapshots]);

  const canSave =
    routePoints.length >= 2 &&
    snapshots.length < 4;

  function handleSaveSnapshot() {
    if (!canSave) {
      return;
    }

    const snapshot =
      createRouteSnapshot({
        name:
          routeName.trim() ||
          `ROUTE ${snapshots.length + 1}`,
        routePoints,
        routePlan,
        evaPaceKmh: evaPace,
      });

    const next = [
      ...snapshots,
      snapshot,
    ].slice(0, 4);

    setSnapshots(next);
    setRouteName("");
  }

  function handleDeleteSnapshot(id) {
    setSnapshots((current) =>
      current.filter(
        (route) => route.id !== id
      )
    );
  }

  return (
    <section className="nn-route-tools">
      <div className="nn-route-tools-header">
        <div>
          <div className="nn-route-eyebrow">
            NEURONEXUS / ROUTE INTELLIGENCE
          </div>

          <h3>Route Analysis</h3>

          <p>
            Evidence-aware route assessment.
            No unsupported hazard claims.
          </p>
        </div>

        <div
          className={
            routeLoading
              ? "nn-status loading"
              : "nn-status"
          }
        >
          {routeLoading
            ? "ANALYSING"
            : routePoints.length >= 2
            ? "READY"
            : "NO ROUTE"}
        </div>
      </div>

      <div className="nn-route-metrics-grid">
        <Metric
          label="DISTANCE"
          value={formatMetric(
            analysis.metrics.distanceKm,
            2,
            " km"
          )}
        />

        <Metric
          label="MAX SLOPE"
          value={formatMetric(
            analysis.metrics.maxSlopeDeg,
            2,
            "°"
          )}
        />

        <Metric
          label="MEAN SLOPE"
          value={formatMetric(
            analysis.metrics.meanSlopeDeg,
            2,
            "°"
          )}
        />

        <Metric
          label="MAX ROUGHNESS"
          value={formatMetric(
            analysis.metrics.maxRoughness
          )}
        />

        <Metric
          label="THERMAL"
          value={
            analysis.metrics.thermalCoveragePct !==
            null
              ? `${analysis.metrics.thermalCoveragePct.toFixed(
                  1
                )}%`
              : analysis.metrics.thermalStatus ||
                "UNAVAILABLE"
          }
        />

        <Metric
          label="EST. EVA"
          value={
            analysis.metrics.estimatedEvaHours !==
            null
              ? `${analysis.metrics.estimatedEvaHours.toFixed(
                  1
                )} h`
              : "UNAVAILABLE"
          }
        />
      </div>

      <div className="nn-route-eva-control">
        <label htmlFor="nn-eva-pace">
          ESTIMATED EVA PACE
        </label>

        <div>
          <input
            id="nn-eva-pace"
            type="number"
            min="0.1"
            max="20"
            step="0.1"
            value={evaPace}
            onChange={(event) =>
              setEvaPace(
                Number(event.target.value) ||
                  DEFAULT_EVA_PACE_KMH
              )
            }
          />

          <span>km/h</span>
        </div>
      </div>

      <div className="nn-route-evidence-grid">
        <div className="nn-route-evidence-column">
          <div className="nn-route-column-title positive">
            PROS
          </div>

          {analysis.pros.map((item) => (
            <EvidenceItem
              key={item.id}
              icon="✓"
              item={item}
            />
          ))}
        </div>

        <div className="nn-route-evidence-column">
          <div className="nn-route-column-title caution">
            CONS
          </div>

          {analysis.cons.map((item) => (
            <EvidenceItem
              key={item.id}
              icon="⚠"
              item={item}
            />
          ))}
        </div>
      </div>

      <div className="nn-route-methodology">
        <strong>ANALYST BASIS</strong>

        <span>
          Distance: {analysis.methodology.distance}
        </span>

        <span>
          Terrain: {analysis.methodology.terrain}
        </span>

        <span>
          EVA: {analysis.methodology.eva}
        </span>
      </div>

      <div className="nn-route-action-row">
        <button
          type="button"
          onClick={onAnalyzeRoute}
          disabled={
            routePoints.length < 2 ||
            routeLoading
          }
        >
          {routeLoading
            ? "ANALYSING..."
            : "ANALYSE ROUTE"}
        </button>

        <button
          type="button"
          onClick={onClear}
          disabled={routePoints.length === 0}
        >
          CLEAR
        </button>
      </div>

      <div className="nn-route-save-box">
        <div>
          <span>SAVE ROUTE SNAPSHOT</span>

          <small>
            {snapshots.length}/4 saved
          </small>
        </div>

        <input
          type="text"
          value={routeName}
          maxLength={48}
          placeholder="Route name"
          onChange={(event) =>
            setRouteName(event.target.value)
          }
        />

        <button
          type="button"
          onClick={handleSaveSnapshot}
          disabled={!canSave}
        >
          SAVE
        </button>
      </div>

      {snapshots.length > 0 && (
        <div className="nn-route-snapshot-list">
          {snapshots.map((route, index) => (
            <div
              className="nn-route-snapshot"
              key={route.id}
            >
              <div>
                <strong>
                  {route.name ||
                    `ROUTE ${index + 1}`}
                </strong>

                <small>
                  {formatMetric(
                    route.metrics?.distanceKm,
                    2,
                    " km"
                  )}
                </small>
              </div>

              <button
                type="button"
                onClick={() =>
                  handleDeleteSnapshot(
                    route.id
                  )
                }
                aria-label={`Delete ${route.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        className="nn-route-compare-button"
        type="button"
        disabled={snapshots.length < 2}
        onClick={() => onCompare?.(snapshots)}
      >
        {compareMode
          ? "CLOSE COMPARISON"
          : `COMPARE ROUTES (${snapshots.length}/4)`}
      </button>
    </section>
  );
}
