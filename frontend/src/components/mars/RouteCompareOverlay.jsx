import React, {
  useMemo,
  useState,
} from "react";

import MarsMap from "./MarsMap";
import MarsTopographicMap from "./MarsTopographicMap";

function metric(route, key, suffix = "") {
  const value = route?.metrics?.[key];

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "UNAVAILABLE";
  }

  return `${Number(value).toFixed(2)}${suffix}`;
}

export default function RouteCompareOverlay({
  open,
  routes = [],
  features = [],
  selectedFeature = null,
  onClose,
}) {
  const [activeRouteId, setActiveRouteId] =
    useState(routes[0]?.id || null);

  const activeRoute = useMemo(
    () =>
      routes.find(
        (route) =>
          route.id === activeRouteId
      ) || routes[0] || null,
    [routes, activeRouteId]
  );

  if (!open || !activeRoute) {
    return null;
  }

  return (
    <div className="nn-compare-overlay">
      <div
        className="nn-compare-backdrop"
        aria-hidden="true"
      />

      <section className="nn-compare-workspace">
        <header className="nn-compare-header">
          <div>
            <div className="nn-route-eyebrow">
              NEURONEXUS / ROUTE COMPARISON
            </div>

            <h2>
              Compare up to 4 Marswalk routes
            </h2>

            <p>
              The workspace combines the
              NeuroNexus terrain map and the
              scientific USGS view.
            </p>
          </div>

          <button
            type="button"
            className="nn-compare-close"
            onClick={onClose}
          >
            CLOSE ×
          </button>
        </header>

        <div className="nn-compare-map-grid">
          <div className="nn-compare-map-panel">
            <div className="nn-compare-map-label">
              NEURONEXUS / ROUTE MAP
            </div>

            <MarsMap
              features={features}
              selectedFeature={selectedFeature}
              onSelect={() => {}}
              routeMode={false}
              routePoints={
                activeRoute.points || []
              }
              routePlan={null}
              routeLoading={false}
              onMapLocationSelect={() => {}}
              onToggleRouteMode={() => {}}
              onAddSelected={() => {}}
              onAnalyzeRoute={() => {}}
              onClear={() => {}}
            />
          </div>

          <div className="nn-compare-map-panel">
            <div className="nn-compare-map-label">
              USGS / SCIENTIFIC MAP
            </div>

            <MarsTopographicMap />
          </div>
        </div>

        <div className="nn-compare-route-strip">
          {routes.slice(0, 4).map((route, index) => {
            const active =
              route.id === activeRoute.id;

            return (
              <button
                type="button"
                className={
                  active
                    ? "nn-compare-route-card active"
                    : "nn-compare-route-card"
                }
                key={route.id}
                onClick={() =>
                  setActiveRouteId(route.id)
                }
              >
                <div className="nn-compare-route-card-top">
                  <strong>
                    {route.name ||
                      `ROUTE ${index + 1}`}
                  </strong>

                  {active && (
                    <span>ACTIVE</span>
                  )}
                </div>

                <div className="nn-compare-mini-grid">
                  <div>
                    <span>DISTANCE</span>
                    <strong>
                      {metric(
                        route,
                        "distanceKm",
                        " km"
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>MAX SLOPE</span>
                    <strong>
                      {metric(
                        route,
                        "maxSlopeDeg",
                        "°"
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>ROUGHNESS</span>
                    <strong>
                      {metric(
                        route,
                        "maxRoughness"
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>EVA</span>
                    <strong>
                      {metric(
                        route,
                        "estimatedEvaHours",
                        " h"
                      )}
                    </strong>
                  </div>
                </div>

                <div className="nn-compare-card-columns">
                  <div>
                    <small>PROS</small>

                    {route.pros
                      ?.slice(0, 2)
                      .map((item) => (
                        <span key={item.id}>
                          ✓ {item.text}
                        </span>
                      ))}
                  </div>

                  <div>
                    <small>CONS</small>

                    {route.cons
                      ?.slice(0, 2)
                      .map((item) => (
                        <span key={item.id}>
                          ⚠ {item.text}
                        </span>
                      ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
