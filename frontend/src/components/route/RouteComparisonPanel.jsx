import { useState } from 'react'

import MarsMap from '../mars/MarsMap'


function Metric({
  label,
  value,
  unit = '',
}) {
  return (
    <div className="comparison-metric">
      <span>
        {label}
      </span>

      <strong>
        {value ?? '—'}
      </strong>

      {unit && (
        <small>
          {unit}
        </small>
      )}
    </div>
  )
}


export default function RouteComparisonPanel({
  routes,
  onClose,
}) {
  const [
    leftId,
    setLeftId,
  ] = useState(
    routes[0]?.id ?? '',
  )

  const [
    rightId,
    setRightId,
  ] = useState(
    routes[1]?.id ??
      routes[0]?.id ??
      '',
  )

  const left =
    routes.find(
      (route) =>
        route.id ===
        leftId,
    ) ??
    routes[0]

  const right =
    routes.find(
      (route) =>
        route.id ===
        rightId,
    ) ??
    routes[1] ??
    routes[0]

  if (
    !left ||
    !right
  ) {
    return null
  }

  return (
    <div className="comparison-backdrop">
      <section className="comparison-workspace">
        <header className="comparison-header">
          <div>
            <div className="eyebrow">
              NEURONEXUS / ROUTE
              INTELLIGENCE
            </div>

            <h2>
              ROUTE COMPARISON
            </h2>

            <p>
              Compare saved Marswalk
              alternatives using their
              recorded geometry and
              evidence-derived metrics.
            </p>
          </div>

          <button
            type="button"
            className="comparison-close"
            onClick={
              onClose
            }
          >
            CLOSE ×
          </button>
        </header>


        <div className="comparison-selectors">
          <label>
            ROUTE A

            <select
              value={
                left.id
              }
              onChange={(
                event,
              ) =>
                setLeftId(
                  event.target
                    .value,
                )
              }
            >
              {routes.map(
                (route) => (
                  <option
                    key={
                      route.id
                    }
                    value={
                      route.id
                    }
                  >
                    {
                      route.name
                    }
                  </option>
                ),
              )}
            </select>
          </label>


          <label>
            ROUTE B

            <select
              value={
                right.id
              }
              onChange={(
                event,
              ) =>
                setRightId(
                  event.target
                    .value,
                )
              }
            >
              {routes.map(
                (route) => (
                  <option
                    key={
                      route.id
                    }
                    value={
                      route.id
                    }
                  >
                    {
                      route.name
                    }
                  </option>
                ),
              )}
            </select>
          </label>
        </div>


        <div className="comparison-main">
          <RouteMapCard
            title="ROUTE A"
            route={left}
          />

          <RouteMapCard
            title="ROUTE B"
            route={right}
          />
        </div>


        <div className="comparison-detail-grid">
          <RouteDetail
            title="ROUTE A"
            route={left}
          />

          <RouteDetail
            title="ROUTE B"
            route={right}
          />
        </div>


        <div className="comparison-all-routes">
          <div className="eyebrow">
            SAVED ROUTES ·
            MAX 4
          </div>

          <div className="comparison-route-strip">
            {routes.map(
              (route) => (
                <button
                  type="button"
                  key={
                    route.id
                  }
                  className={
                    route.id ===
                      left.id ||
                    route.id ===
                      right.id
                      ? 'selected'
                      : ''
                  }
                  onClick={() => {
                    if (
                      route.id !==
                      left.id
                    ) {
                      setLeftId(
                        route.id,
                      )
                    } else {
                      setRightId(
                        route.id,
                      )
                    }
                  }}
                >
                  <strong>
                    {
                      route.name
                    }
                  </strong>

                  <span>
                    {route
                      .analysis
                      ?.distanceKm ==
                    null
                      ? '—'
                      : `${route.analysis.distanceKm.toFixed(
                          2,
                        )} km`}
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
      </section>
    </div>
  )
}


function RouteMapCard({
  title,
  route,
}) {
  return (
    <div className="comparison-map-card">
      <div className="comparison-card-head">
        <span>
          {title}
        </span>

        <strong>
          {route.name}
        </strong>
      </div>

      <div className="comparison-map">
        <MarsMap
          features={[]}
          selectedFeature={null}
          routeMode={false}
          routePoints={
            route.routePoints
          }
          routePlan={
            route.routePlan
          }
          comparisonMode
          fitRoute
        />
      </div>
    </div>
  )
}


function RouteDetail({
  title,
  route,
}) {
  const analysis =
    route.analysis

  return (
    <article className="comparison-detail-card">
      <div className="eyebrow">
        {title}
      </div>

      <h3>
        {route.name}
      </h3>

      <div className="comparison-metric-grid">
        <Metric
          label="DISTANCE"
          value={
            analysis?.distanceKm ==
            null
              ? null
              : analysis.distanceKm.toFixed(
                  2,
                )
          }
          unit="KM"
        />

        <Metric
          label="MAX SLOPE"
          value={
            analysis?.maxSlopeDeg ==
            null
              ? null
              : analysis.maxSlopeDeg.toFixed(
                  2,
                )
          }
          unit="DEG"
        />

        <Metric
          label="MEAN SLOPE"
          value={
            analysis?.meanSlopeDeg ==
            null
              ? null
              : analysis.meanSlopeDeg.toFixed(
                  2,
                )
          }
          unit="DEG"
        />

        <Metric
          label="COVERAGE"
          value={
            analysis?.dataCoveragePercent ==
            null
              ? null
              : analysis.dataCoveragePercent.toFixed(
                  0,
                )
          }
          unit="%"
        />
      </div>


      <div className="comparison-pros-cons">
        <div>
          <span>
            EVIDENCE / PROS
          </span>

          {(
            analysis?.pros ??
            []
          ).map(
            (item, index) => (
              <p
                key={
                  `pro-${index}`
                }
              >
                + {item}
              </p>
            ),
          )}
        </div>

        <div>
          <span>
            CONSTRAINTS
          </span>

          {(
            analysis?.cons ??
            []
          ).map(
            (item, index) => (
              <p
                key={
                  `con-${index}`
                }
              >
                − {item}
              </p>
            ),
          )}
        </div>
      </div>
    </article>
  )
}
