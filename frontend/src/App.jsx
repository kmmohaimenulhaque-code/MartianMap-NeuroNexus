
import { useEffect, useState } from 'react'

import MarsMap from './components/mars/MarsMap'
import MarsTopographicMap from './components/mars/MarsTopographicMap'
import MarsBriefingPanel from './components/mars/MarsBriefingPanel'
import RoverPhotosPanel from './components/mars/RoverPhotosPanel'
import SiteSciencePanel from './components/mars/SiteSciencePanel'

import {
  fetchEnvironmentByPlace,
  fetchPlaceSuggestions,
  fetchPlaces,
  fetchRoutePlan,
} from './services/marsEnvironmentApi'

import './App.css'


const DEFAULT_PLACE = 'Gale'
const DEFAULT_SOL = 100
const MAX_ROUTE_POINTS = 32


function Panel({ eyebrow, title, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
        </div>
        <span className="panel-mark">+</span>
      </div>

      <div className="panel-body">
        {children}
      </div>
    </section>
  )
}


function Metric({ label, value, detail }) {
  return (
    <div className="metric">
      <span>{label}</span>

      <strong>
        {value ?? '—'}
      </strong>

      {detail && (
        <small>
          {detail}
        </small>
      )}
    </div>
  )
}


function SearchBar({
  query,
  suggestions,
  onQueryChange,
  onSelect,
}) {
  return (
    <div className="search-wrapper">
      <div className="search-box">
        <span className="search-icon">
          ⌕
        </span>

        <input
          value={query}
          onChange={(event) =>
            onQueryChange(
              event.target.value,
            )
          }
          placeholder="Search Mars place..."
          aria-label="Search Mars place"
        />

        <span className="search-hint">
          USGS
        </span>
      </div>

      {suggestions.length > 0 && (
        <div className="suggestions">
          <div className="suggestions-header">
            MARS PLACES
          </div>

          {suggestions.map(
            (suggestion) => (
              <button
                key={[
                  suggestion.feature_name,
                  suggestion.latitude_deg,
                  suggestion.longitude_deg,
                ].join(':')}
                type="button"
                onClick={() =>
                  onSelect(
                    suggestion,
                  )
                }
              >
                <span className="suggestion-dot" />

                <span className="suggestion-main">
                  <strong>
                    {
                      suggestion.feature_name
                    }
                  </strong>

                  <small>
                    {
                      suggestion.feature_type
                    }
                  </small>
                </span>

                <span className="suggestion-meta">
                  {suggestion.diameter_km == null
                    ? '—'
                    : `${Number(
                        suggestion.diameter_km,
                      ).toFixed(2)} km`}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}


function MissionSystemsPanel() {
  const systems = [
    'Mission plans',
    'Crew health',
    'Life support',
    'Food / water / O₂',
    'Fuel & propellant',
    'Spacecraft health',
    'Rover health',
    'Greenhouse / biomass',
  ]

  return (
    <Panel
      eyebrow="MISSION / SYSTEMS"
      title="Operational state"
    >
      <div className="system-list">
        {systems.map(
          (system) => (
            <div
              className="system-row"
              key={system}
            >
              <span>
                {system}
              </span>

              <strong>
                NOT CONNECTED
              </strong>
            </div>
          ),
        )}
      </div>

      <div className="simulation-note">
        <span>DATA CLASS</span>

        <strong>
          Simulation layer reserved for
          mission-state models.
        </strong>
      </div>
    </Panel>
  )
}


function RouteSummary({
  routePlan,
  routePoints,
  loading,
  onClear,
}) {
  if (!routePoints.length) {
    return (
      <div className="route-empty">
        <span>ROUTE STATE</span>

        <strong>
          Enter PLAN ROUTE mode on the
          topographic map and click at least
          two points.
        </strong>
      </div>
    )
  }

  const displacement =
    routePlan?.displacement
      ?.distance_km

  const planned =
    routePlan?.planned_route
      ?.planned_route_km

  const extension =
    routePlan?.planned_route
      ?.extension_km

  const extensionPercent =
    routePlan?.planned_route
      ?.extension_percent

  return (
    <div className="route-summary-body">
      <div className="route-kpis">
        <Metric
          label="Straight-line displacement"
          value={
            displacement == null
              ? 'PENDING'
              : `${Number(
                  displacement,
                ).toFixed(2)} km`
          }
          detail="Haversine · first point → last point"
        />

        <Metric
          label="Planned route"
          value={
            planned == null
              ? 'PENDING'
              : `${Number(
                  planned,
                ).toFixed(2)} km`
          }
          detail="Haversine sum of user waypoints"
        />

        <Metric
          label="Route extension"
          value={
            extension == null
              ? 'PENDING'
              : `${Number(
                  extension,
                ).toFixed(2)} km`
          }
          detail={
            extensionPercent == null
              ? '—'
              : `${Number(
                  extensionPercent,
                ).toFixed(1)}% longer than displacement`
          }
        />
      </div>

      <div className="route-meta-grid">
        <Metric
          label="Waypoints"
          value={routePoints.length}
        />

        <Metric
          label="Legs"
          value={
            routePlan?.planned_route
              ?.leg_count ?? '—'
          }
        />

        <Metric
          label="Terrain search"
          value="NONE"
          detail="No corridor / no A*"
        />

        <Metric
          label="MOLA guidance"
          value={
            loading
              ? 'ANALYZING'
              : routePlan
                ? 'LOCAL SAMPLES'
                : 'PENDING'
          }
          detail="Only selected waypoint neighborhoods"
        />
      </div>

      {routePlan?.guidance?.notes?.map(
        (note) => (
          <div
            className="route-guidance"
            key={note}
          >
            {note}
          </div>
        ),
      )}

      {routePlan?.guidance
        ?.disclaimer && (
        <div className="route-disclaimer">
          {
            routePlan.guidance
              .disclaimer
          }
        </div>
      )}

      <button
        type="button"
        className="clear-route-button"
        onClick={onClear}
      >
        CLEAR ROUTE
      </button>
    </div>
  )
}


export default function App() {
  const [places, setPlaces] =
    useState([])

  const [query, setQuery] =
    useState('')

  const [suggestions, setSuggestions] =
    useState([])

  const [
    selectedFeature,
    setSelectedFeature,
  ] = useState(null)

  const [environment, setEnvironment] =
    useState(null)

  const [loading, setLoading] =
    useState(true)

  const [searching, setSearching] =
    useState(false)

  const [error, setError] =
    useState('')

  const [routeMode, setRouteMode] =
    useState(false)

  const [routePoints, setRoutePoints] =
    useState([])

  const [routePlan, setRoutePlan] =
    useState(null)

  const [routeLoading, setRouteLoading] =
    useState(false)


  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        setLoading(true)
        setError('')

        const [
          placesResponse,
          galeResponse,
        ] = await Promise.all([
          fetchPlaces(2052),
          fetchEnvironmentByPlace(
            DEFAULT_PLACE,
            DEFAULT_SOL,
          ),
        ])

        if (cancelled) {
          return
        }

        setPlaces(
          placesResponse.features ??
            [],
        )

        setEnvironment(
          galeResponse,
        )

        setSelectedFeature(
          galeResponse?.gazetteer
            ?.selected_feature ??
            galeResponse?.gazetteer
              ?.nearest_feature ??
            null,
        )

        setQuery(
          galeResponse?.query
            ?.resolved_name ??
            DEFAULT_PLACE,
        )
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message,
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    initialize()

    return () => {
      cancelled = true
    }
  }, [])


  useEffect(() => {
    const value =
      query.trim()

    if (!value.length) {
      setSuggestions([])
      setSearching(false)
      return undefined
    }

    if (
      selectedFeature &&
      value.toLowerCase() ===
        String(
          selectedFeature.feature_name,
        ).toLowerCase()
    ) {
      setSuggestions([])
    }

    const controller =
      new AbortController()

    const timer =
      setTimeout(
        async () => {
          try {
            setSearching(true)

            const response =
              await fetchPlaceSuggestions(
                value,
                8,
              )

            if (
              !controller.signal
                .aborted
            ) {
              setSuggestions(
                response.suggestions ??
                  [],
              )
            }
          } catch {
            if (
              !controller.signal
                .aborted
            ) {
              setSuggestions([])
            }
          } finally {
            if (
              !controller.signal
                .aborted
            ) {
              setSearching(false)
            }
          }
        },
        180,
      )

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [
    query,
    selectedFeature,
  ])


  async function handleSelectPlace(
    feature,
  ) {
    try {
      setQuery(
        feature.feature_name,
      )

      setSuggestions([])

      setSelectedFeature(
        feature,
      )

      setLoading(true)
      setError('')

      const response =
        await fetchEnvironmentByPlace(
          feature.feature_name,
          DEFAULT_SOL,
        )

      setEnvironment(
        response,
      )

      setSelectedFeature(
        response?.gazetteer
          ?.selected_feature ??
          feature,
      )
    } catch (err) {
      setError(
        err.message,
      )
    } finally {
      setLoading(false)
    }
  }


  function normalizeRoutePoint(
    point,
    fallbackLabel = null,
  ) {
    return {
      latitude_deg:
        Number(
          point.latitude_deg,
        ),

      longitude_deg:
        (
          Number(
            point.longitude_deg,
          ) % 360 +
          360
        ) % 360,

      label:
        point.label ||
        fallbackLabel ||
        null,
    }
  }


  function handleRoutePointAdd(
    point,
  ) {
    setError('')
    setRoutePlan(null)

    setRoutePoints(
      (current) => {
        if (
          current.length >=
          MAX_ROUTE_POINTS
        ) {
          return current
        }

        const label =
          point.label ||
          `WP ${current.length + 1}`

        return [
          ...current,
          normalizeRoutePoint(
            point,
            label,
          ),
        ]
      },
    )
  }


  function handleAddSelected() {
    if (
      !place ||
      routePoints.length >=
        MAX_ROUTE_POINTS
    ) {
      return
    }

    handleRoutePointAdd({
      latitude_deg:
        place.latitude_deg,
      longitude_deg:
        place.longitude_deg,
      label:
        place.feature_name,
    })
  }


  async function handleAnalyzeRoute() {
    if (
      routePoints.length < 2
    ) {
      return
    }

    try {
      setRouteLoading(true)
      setError('')

      const response =
        await fetchRoutePlan(
          routePoints,
        )

      setRoutePlan(
        response,
      )
    } catch (err) {
      setRoutePlan(null)

      setError(
        err.message,
      )
    } finally {
      setRouteLoading(false)
    }
  }


  function toggleRouteMode() {
    setRouteMode(
      (active) => !active,
    )
  }


  function clearRoute() {
    setRoutePoints([])
    setRoutePlan(null)
    setRouteMode(false)
  }


  const place =
    environment?.gazetteer
      ?.selected_feature ??
    environment?.gazetteer
      ?.nearest_feature ??
    selectedFeature

  const thermal =
    environment?.thermal
      ?.observations?.[0]

  const thermalEvidence =
    thermal?.evidence

  const dust =
    environment?.dust

  const terrain =
    environment?.terrain

  const solar =
    environment?.solar

  const siteScience =
    environment?.site_science


  return (
    <main className="mission-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-kicker">
            NASA SPACE APPS 2026
          </div>

          <h1>
            NEURONEXUS
          </h1>

          <span>
            MARTIAN MAP / MISSION CONTROL
          </span>
        </div>

        <SearchBar
          query={query}
          suggestions={
            suggestions
          }
          onQueryChange={
            setQuery
          }
          onSelect={
            handleSelectPlace
          }
        />

        <div className="mission-state">
          <div>
            <span className="state-label">
              SOL
            </span>

            <strong>
              {DEFAULT_SOL}
            </strong>
          </div>

          <div>
            <span className="state-label">
              FEATURES
            </span>

            <strong>
              {places.length.toLocaleString()}
            </strong>
          </div>

          <div className="status-dot">
            <span />

            {searching
              ? 'SEARCHING'
              : routeLoading
                ? 'ROUTING'
                : error
                  ? 'DEGRADED'
                  : 'SYSTEM ONLINE'}
          </div>
        </div>
      </header>


      <div className="workspace">
        <aside className="left-column">
          <Panel
            eyebrow="GEOGRAPHY / NOMENCLATURE"
            title="Selected site"
          >
            <div className="place-title">
              <span className="signal">
                ●
              </span>

              <div>
                <h3>
                  {
                    place
                      ?.feature_name ??
                    'Loading'
                  }
                </h3>

                <p>
                  {
                    place
                      ?.feature_type ??
                    'USGS feature'
                  }
                </p>
              </div>
            </div>

            <div className="coordinate-block">
              <span>
                LATITUDE
              </span>

              <strong>
                {place
                  ? `${Number(
                      place.latitude_deg,
                    ).toFixed(4)}°`
                  : '—'}
              </strong>

              <span>
                LONGITUDE
              </span>

              <strong>
                {place
                  ? `${Number(
                      place.longitude_deg,
                    ).toFixed(4)}°E`
                  : '—'}
              </strong>
            </div>

            <div className="rule" />

            <Metric
              label="Diameter"
              value={
                place?.diameter_km ==
                null
                  ? '—'
                  : `${Number(
                      place.diameter_km,
                    ).toFixed(2)} km`
              }
              detail="USGS / IAU nomenclature"
            />

            <Metric
              label="Approval"
              value={
                place?.approval_status
              }
            />

            <Metric
              label="Quadrangle"
              value={
                place?.quadrangle_name
              }
              detail={
                place?.quadrangle_code
              }
            />
          </Panel>


          <Panel
            eyebrow="IMAGERY / ROVER"
            title="Applicable rover photos"
          >
            <RoverPhotosPanel
              feature={place}
            />
          </Panel>


          <Panel
            eyebrow="THERMAL / NASA THEMIS"
            title="Historical evidence"
          >
            <Metric
              label="Brightness temperature"
              value={
                thermal
                  ? `${Number(
                      thermal.brightness_temperature_k,
                    ).toFixed(1)} K`
                  : '—'
              }
              detail={
                thermal
                  ? `${Number(
                      thermal.brightness_temperature_c,
                    ).toFixed(1)} °C · historical brightness temperature`
                  : loading
                    ? 'Loading...'
                    : 'No historical observation'
              }
            />

            <div className="evidence-grid">
              <Metric
                label="Evidence"
                value={
                  thermalEvidence
                    ?.label
                }
              />

              <Metric
                label="Score"
                value={
                  thermalEvidence
                    ?.score ==
                    null
                    ? '—'
                    : Number(
                        thermalEvidence.score,
                      ).toFixed(1)
                }
              />

              <Metric
                label="Observations"
                value={
                  thermalEvidence
                    ?.observation_count
                }
              />

              <Metric
                label="Years"
                value={
                  thermalEvidence?.years
                }
              />
            </div>

            <div className="source-note">
              <span>
                SOURCE
              </span>

              <strong>
                {
                  thermal?.product_id ??
                  'NASA THEMIS IR-PBT'
                }
              </strong>
            </div>
          </Panel>


          <Panel
            eyebrow="ENVIRONMENT / SOLAR"
            title="Solar geometry"
          >
            <Metric
              label="Areocentric longitude"
              value={
                solar
                  ? `${Number(
                      solar.areocentric_longitude_deg,
                    ).toFixed(2)}°`
                  : '—'
              }
              detail="Ls"
            />

            <Metric
              label="Observation local solar time"
              value={
                thermal
                  ? `${Number(
                      thermal.local_solar_time_hours,
                    ).toFixed(2)} h`
                  : '—'
              }
            />
          </Panel>
        </aside>


        <section className="site-field">
          <div className="field-header">
            <div>
              <span className="field-label-inline">
                MARTIAN SITE / 2D NAVIGATION
              </span>

              <strong>
                {
                  place?.feature_name ??
                  'MARS'
                }
              </strong>
            </div>

            <div className="map-status-inline">
              <span>
                {
                  places.length.toLocaleString()
                }{' '}
                USGS FEATURES
              </span>

              <span>
                MOLA 128 PX/DEG
              </span>
            </div>
          </div>


          <div className="maps-grid">
            <div className="map-panel">
              <div className="map-panel-title">
                <span>
                  COLORED GLOBAL MAP
                </span>

                <small>
                  USGS FEATURE NAVIGATION
                </small>
              </div>

              <div className="map-panel-body">
                <MarsMap
                  features={
                    places
                  }
                  selectedFeature={
                    selectedFeature
                  }
                  onSelect={
                    handleSelectPlace
                  }
                />
              </div>
            </div>


            <div className="map-panel">
              <div className="map-panel-title topo-title">
                <span>
                  2D TOPOGRAPHIC MAP
                </span>

                <small>
                  MOLA / HILLSHADE / ELEVATION
                </small>
              </div>

              <div className="map-panel-body">
                <MarsTopographicMap
                  features={
                    places
                  }
                  selectedFeature={
                    selectedFeature
                  }
                  routeMode={
                    routeMode
                  }
                  routePoints={
                    routePoints
                  }
                  routePlan={
                    routePlan
                  }
                  routeLoading={
                    routeLoading
                  }
                  terrain={
                    terrain
                  }
                  onSelect={
                    handleSelectPlace
                  }
                  onRoutePointAdd={
                    handleRoutePointAdd
                  }
                  onToggleRouteMode={
                    toggleRouteMode
                  }
                  onAddSelected={
                    handleAddSelected
                  }
                  onAnalyzeRoute={
                    handleAnalyzeRoute
                  }
                  onClear={
                    clearRoute
                  }
                />
              </div>
            </div>
          </div>


          <div className="map-legend">
            <div>
              <span className="legend-mark crater" />
              Crater
            </div>

            <div>
              <span className="legend-mark valley" />
              Vallis / Chasma
            </div>

            <div>
              <span className="legend-mark mountain" />
              Mons / highland
            </div>

            <div>
              <span className="legend-mark feature" />
              Other USGS feature
            </div>
          </div>


          <Panel
            eyebrow="NAVIGATION / GEOMETRY"
            title="Route analysis"
            className="route-analysis-panel"
          >
            <RouteSummary
              routePlan={
                routePlan
              }
              routePoints={
                routePoints
              }
              loading={
                routeLoading
              }
              onClear={
                clearRoute
              }
            />
          </Panel>
        </section>


        <aside className="right-column">
          <Panel
            eyebrow="ATMOSPHERE / NASA AMES"
            title="Dust scenario"
          >
            <Metric
              label="Opacity"
              value={
                dust
                  ? Number(
                      dust.opacity,
                    ).toFixed(3)
                  : '—'
              }
              detail="MY34 modeled scenario"
            />

            <Metric
              label="Classification"
              value={
                environment?.assessment
                  ?.dust?.level
                  ?.toUpperCase()
              }
            />

            <Metric
              label="Modeled height"
              value={
                dust
                  ? `${Number(
                      dust.height_km,
                    ).toFixed(2)} km`
                  : '—'
              }
            />
          </Panel>


          <Panel
            eyebrow="TERRAIN / NASA MOLA"
            title="Site morphology"
          >
            <div className="metric-grid">
              <Metric
                label="Elevation"
                value={
                  terrain
                    ? `${Number(
                        terrain.elevation_m,
                      ).toFixed(0)} m`
                    : '—'
                }
              />

              <Metric
                label="Slope"
                value={
                  terrain
                    ? `${Number(
                        terrain.slope_deg,
                      ).toFixed(2)}°`
                    : '—'
                }
              />

              <Metric
                label="Aspect"
                value={
                  terrain
                    ? `${Number(
                        terrain.aspect_deg,
                      ).toFixed(1)}°`
                    : '—'
                }
              />

              <Metric
                label="Roughness"
                value={
                  terrain
                    ? `${Number(
                        terrain.roughness_m,
                      ).toFixed(0)} m`
                    : '—'
                }
              />
            </div>
          </Panel>


          <Panel
            eyebrow="SITE SCIENCE / SURVIVAL"
            title="Material + habitability context"
          >
            <SiteSciencePanel
              science={
                siteScience
              }
            />
          </Panel>


          <Panel
            eyebrow="ASSESSMENT / EVIDENCE"
            title="Interpretation"
          >
            <div className="assessment-status">
              <span>
                STATUS
              </span>

              <strong>
                {
                  environment
                    ?.assessment
                    ?.assessment_status ??
                  '—'
                }
              </strong>
            </div>

            <div className="source-note">
              <span>
                THERMAL
              </span>

              <strong>
                Historical observation
              </strong>
            </div>

            <div className="source-note">
              <span>
                DUST
              </span>

              <strong>
                Modeled MY34 scenario
              </strong>
            </div>

            <div className="source-note">
              <span>
                TERRAIN
              </span>

              <strong>
                NASA MOLA
              </strong>
            </div>

            {
              environment
                ?.assessment
                ?.warnings
                ?.length > 0 && (
              <div className="warning-box">
                {
                  environment.assessment
                    .warnings.map(
                      (warning) => (
                        <p
                          key={warning}
                        >
                          {warning}
                        </p>
                      ),
                    )
                }
              </div>
            )}
          </Panel>


          <MissionSystemsPanel />


          <Panel
            eyebrow="BRIEFING / LIVE WEB"
            title="Mars reference feed"
          >
            <MarsBriefingPanel />
          </Panel>
        </aside>
      </div>


      <footer className="evidence-bar">
        <div>
          <span>USGS</span>
          <strong>
            2,052 REGISTERED FEATURES
          </strong>
        </div>

        <div>
          <span>THEMIS</span>
          <strong>
            HISTORICAL IR-PBT
          </strong>
        </div>

        <div>
          <span>GCM</span>
          <strong>
            AMES MY34
          </strong>
        </div>

        <div>
          <span>MOLA</span>
          <strong>
            128 PX / DEG
          </strong>
        </div>

        <div>
          <span>MEDIA</span>
          <strong>
            NASA IMAGE LIBRARY
          </strong>
        </div>

        <div className="evidence-warning">
          <span>DATA MODEL</span>

          <strong>
            Observed · Modeled · Derived · Simulated
          </strong>
        </div>
      </footer>
    </main>
  )
}
