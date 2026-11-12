import { useEffect } from 'react'

import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'

import {
  CRS,
} from 'leaflet'

import 'leaflet/dist/leaflet.css'


const MARS_BOUNDS = [
  [0, 0],
  [180, 360],
]


function marsPosition(
  feature,
) {
  return [
    90 -
      Number(
        feature.latitude_deg,
      ),

    Number(
      feature.longitude_deg,
    ) % 360,
  ]
}


function featureColor(
  featureType = '',
) {
  const type =
    featureType
      .split(',')[0]
      .trim()

  const colors = {
    Crater: '#d9c2a5',
    Vallis: '#72d9ff',
    Mons: '#ff9f68',
    Fossa: '#9fe3a8',
    Mensa: '#e7d06f',
    Planum: '#c99bff',
    Patera: '#ff718d',
    Chaos: '#75e6ff',
    Rupes: '#ffbf69',
    Chasma: '#80aaff',
    Dorsum: '#c5a27b',
    Terra: '#f0c6a0',
    Planitia: '#9cc2b5',
  }

  return (
    colors[type] ??
    '#d5d9dc'
  )
}


function MapFocus({
  feature,
}) {
  const map = useMap()

  useEffect(() => {
    if (!feature) {
      return
    }

    map.flyTo(
      marsPosition(
        feature,
      ),
      2.5,
      {
        duration: 0.8,
      },
    )
  }, [
    feature,
    map,
  ])

  return null
}


function MapClickHandler({
  routeMode,
  onRoutePointAdd,
}) {
  useMapEvents({
    click(event) {
      if (!routeMode) {
        return
      }

      const latitude =
        90 -
        Number(
          event.latlng.lat,
        )

      const longitude =
        (
          Number(
            event.latlng.lng,
          ) %
            360 +
          360
        ) % 360

      onRoutePointAdd({
        latitude_deg:
          latitude,

        longitude_deg:
          longitude,

        label:
          null,
      })
    },
  })

  return null
}


function TopographicToolbar({
  routeMode,
  routePoints,
  selectedFeature,
  onToggleRouteMode,
  onAddSelected,
  onAnalyzeRoute,
  onClear,
  loading,
}) {
  return (
    <div className="topographic-toolbar">
      <div className="topographic-toolbar-copy">
        <span>
          MOLA / 128 PX PER DEGREE
        </span>

        <strong>
          INTERACTIVE TOPOGRAPHIC ROUTE PLANNER
        </strong>

        <small>
          {routeMode
            ? 'MAP CLICK = ADD WAYPOINT'
            : 'SELECT A SITE OR ENTER ROUTE MODE'}
        </small>
      </div>


      <div className="topographic-toolbar-actions">
        <button
          type="button"
          className={
            routeMode
              ? 'topo-control active'
              : 'topo-control'
          }
          onClick={
            onToggleRouteMode
          }
        >
          {routeMode
            ? 'STOP PLANNING'
            : 'PLAN ROUTE'}
        </button>


        <button
          type="button"
          className="topo-control"
          onClick={
            onAddSelected
          }
          disabled={
            !selectedFeature ||
            routePoints.length >=
              32
          }
        >
          ADD SELECTED
        </button>


        <button
          type="button"
          className="topo-control primary"
          onClick={
            onAnalyzeRoute
          }
          disabled={
            routePoints.length <
              2 ||
            loading
          }
        >
          {loading
            ? 'ANALYZING…'
            : 'ANALYZE ROUTE'}
        </button>


        <button
          type="button"
          className="topo-control danger"
          onClick={
            onClear
          }
          disabled={
            routePoints.length ===
              0
          }
        >
          CLEAR
        </button>
      </div>


      <div className="topographic-route-strip">
        {routePoints.length === 0 ? (
          <span>
            NO WAYPOINTS
          </span>
        ) : (
          routePoints.map(
            (
              point,
              index,
            ) => (
              <span
                key={`${point.latitude_deg}:${point.longitude_deg}:${index}`}
              >
                {
                  index === 0
                    ? 'A'
                    : index ===
                        routePoints.length -
                          1
                      ? 'B'
                      : `P${index}`
                }

                {' · '}

                {
                  point.label ??
                  'COORDINATE'
                }
              </span>
            ),
          )
        )}
      </div>
    </div>
  )
}


export default function MarsTopographicMap({
  features,
  selectedFeature,
  routeMode,
  routePoints,
  routePlan,
  routeLoading,
  terrain,
  onSelect,
  onRoutePointAdd,
  onToggleRouteMode,
  onAddSelected,
  onAnalyzeRoute,
  onClear,
}) {
  const visibleRoute =
    routePlan?.planned_route
      ?.coordinates
      ?.length > 1
      ? routePlan
          .planned_route
          .coordinates
      : routePoints.map(
          (
            point,
          ) => [
            point.latitude_deg,
            point.longitude_deg,
          ],
        )


  return (
    <div className="topographic-map-shell">
      <MapContainer
        center={[
          90,
          180,
        ]}
        zoom={0}
        minZoom={0}
        maxZoom={7}
        crs={CRS.Simple}
        maxBounds={
          MARS_BOUNDS
        }
        maxBoundsViscosity={1}
        scrollWheelZoom
        zoomControl
        worldCopyJump={false}
        style={{
          width: '100%',
          height: '100%',
          background:
            '#080d10',
        }}
      >
        <TileLayer
          url="/api/terrain/tile/{z}/{x}/{y}.png"
          tileSize={180}
          minZoom={0}
          maxZoom={7}
          noWrap
          bounds={MARS_BOUNDS}
        />


        <MapFocus
          feature={
            selectedFeature
          }
        />


        <MapClickHandler
          routeMode={
            routeMode
          }
          onRoutePointAdd={
            onRoutePointAdd
          }
        />


        {
          features.map(
            (
              feature,
            ) => {
              const position =
                marsPosition(
                  feature,
                )

              const selected =
                selectedFeature &&
                String(
                  selectedFeature.feature_name,
                ) ===
                  String(
                    feature.feature_name,
                  )

              const markerColor =
                featureColor(
                  feature.feature_type,
                )

              return (
                <CircleMarker
                  key={`${feature.feature_name}:${feature.latitude_deg}:${feature.longitude_deg}`}
                  center={
                    position
                  }
                  radius={
                    selected
                      ? 4.5
                      : 1.8
                  }
                  pathOptions={{
                    color:
                      selected
                        ? '#ffffff'
                        : markerColor,

                    weight:
                      selected
                        ? 1.8
                        : 0.6,

                    opacity:
                      selected
                        ? 1
                        : 0.65,

                    fillColor:
                      markerColor,

                    fillOpacity:
                      selected
                        ? 1
                        : 0.64,
                  }}
                  eventHandlers={{
                    click: (
                      event,
                    ) => {
                      event.originalEvent?.stopPropagation()

                      if (
                        routeMode
                      ) {
                        onRoutePointAdd(
                          {
                            latitude_deg:
                              Number(
                                feature.latitude_deg,
                              ),

                            longitude_deg:
                              Number(
                                feature.longitude_deg,
                              ) % 360,

                            label:
                              feature.feature_name,
                          },
                        )

                        return
                      }

                      onSelect(
                        feature,
                      )
                    },
                  }}
                >
                  <Tooltip
                    direction="top"
                    offset={[
                      0,
                      -3,
                    ]}
                  >
                    <strong>
                      {
                        feature.feature_name
                      }
                    </strong>

                    <br />

                    {
                      feature.feature_type
                    }
                  </Tooltip>


                  {
                    selected && (
                      <Tooltip
                        permanent
                        direction="right"
                        offset={[
                          7,
                          0,
                        ]}
                      >
                        <strong>
                          {
                            feature.feature_name
                          }
                        </strong>
                      </Tooltip>
                    )
                  }
                </CircleMarker>
              )
            },
          )
        }


        {
          visibleRoute.length >
            1 && (
            <Polyline
              positions={
                visibleRoute.map(
                  ([
                    latitude,
                    longitude,
                  ]) => [
                    90 -
                      Number(
                        latitude,
                      ),

                    Number(
                      longitude,
                    ) % 360,
                  ],
                )
              }
              pathOptions={{
                color:
                  '#75e6ff',

                weight:
                  3,

                opacity:
                  0.95,
              }}
            />
          )
        }


        {
          routePoints.map(
            (
              point,
              index,
            ) => (
              <CircleMarker
                key={`route-point:${index}:${point.latitude_deg}:${point.longitude_deg}`}
                center={[
                  90 -
                    Number(
                      point.latitude_deg,
                    ),

                  Number(
                    point.longitude_deg,
                  ) % 360,
                ]}
                radius={
                  index === 0 ||
                  index ===
                    routePoints.length -
                      1
                    ? 6
                    : 4
                }
                pathOptions={{
                  color:
                    '#ffffff',

                  weight:
                    1.5,

                  fillColor:
                    index === 0
                      ? '#62f59a'
                      : index ===
                          routePoints.length -
                            1
                        ? '#ff647c'
                        : '#75e6ff',

                  fillOpacity:
                    1,
                }}
              >
                <Tooltip
                  permanent
                  direction="top"
                  offset={[
                    0,
                    -7,
                  ]}
                >
                  <strong>
                    {
                      index === 0
                        ? 'A / START'
                        : index ===
                            routePoints.length -
                              1
                          ? 'B / DESTINATION'
                          : `P${index}`
                    }
                  </strong>

                  <br />

                  {
                    point.label ??
                    'COORDINATE'
                  }
                </Tooltip>
              </CircleMarker>
            ),
          )
        }
      </MapContainer>


      <TopographicToolbar
        routeMode={
          routeMode
        }
        routePoints={
          routePoints
        }
        selectedFeature={
          selectedFeature
        }
        onToggleRouteMode={
          onToggleRouteMode
        }
        onAddSelected={
          onAddSelected
        }
        onAnalyzeRoute={
          onAnalyzeRoute
        }
        onClear={
          onClear
        }
        loading={
          routeLoading
        }
      />


      <div className="topographic-readout">
        <span>
          SELECTED SITE
        </span>

        <strong>
          {
            selectedFeature
              ?.feature_name ??
            'MARS'
          }
        </strong>

        <span>
          ELEV{' '}
          {
            terrain?.elevation_m ==
              null
              ? '—'
              : `${Number(
                  terrain.elevation_m,
                ).toFixed(0)} m`
          }
        </span>

        <span>
          SLOPE{' '}
          {
            terrain?.slope_deg ==
              null
              ? '—'
              : `${Number(
                  terrain.slope_deg,
                ).toFixed(2)}°`
          }
        </span>
      </div>


      <div className="topographic-footer">
        <span>
          128 PP DEG NATIVE MOLA TILES ·
          HILLSHADE + ELEVATION TINT
        </span>

        <span>
          {
            features.length.toLocaleString()
          }{' '}
          USGS FEATURES
        </span>
      </div>
    </div>
  )
}
