import { useEffect, useMemo, useState } from 'react'
import {
  fetchTerrainWindow,
} from '../../services/marsEnvironmentApi'


const VIEWBOX_WIDTH = 1000
const VIEWBOX_HEIGHT = 760

const MAP_LEFT = 55
const MAP_TOP = 90

const MAP_WIDTH = 890
const MAP_HEIGHT = 520


function clamp(
  value,
  min,
  max,
) {
  return Math.min(
    max,
    Math.max(min, value),
  )
}


function normalize(
  value,
  min,
  max,
) {
  if (max === min) {
    return 0.5
  }

  return clamp(
    (value - min) /
      (max - min),
    0,
    1,
  )
}


function elevationColor(
  elevation,
  minElevation,
  maxElevation,
) {
  const t = normalize(
    elevation,
    minElevation,
    maxElevation,
  )

  const low = {
    r: 47,
    g: 75,
    b: 83,
  }

  const high = {
    r: 225,
    g: 177,
    b: 109,
  }

  const r = Math.round(
    low.r +
      (high.r - low.r) *
        t,
  )

  const g = Math.round(
    low.g +
      (high.g - low.g) *
        t,
  )

  const b = Math.round(
    low.b +
      (high.b - low.b) *
        t,
  )

  return `rgb(${r},${g},${b})`
}


function slopeStroke(
  slope,
) {
  if (slope >= 25) {
    return '#ff647c'
  }

  if (slope >= 15) {
    return '#ffb45c'
  }

  if (slope >= 8) {
    return '#e8d56b'
  }

  return '#72d9c3'
}


function mapX(
  longitude,
  minLongitude,
  maxLongitude,
) {
  if (
    maxLongitude ===
    minLongitude
  ) {
    return (
      MAP_LEFT +
      MAP_WIDTH / 2
    )
  }

  return (
    MAP_LEFT +
    (
      (longitude -
        minLongitude) /
      (
        maxLongitude -
        minLongitude
      )
    ) *
      MAP_WIDTH
  )
}


function mapY(
  latitude,
  minLatitude,
  maxLatitude,
) {
  if (
    maxLatitude ===
    minLatitude
  ) {
    return (
      MAP_TOP +
      MAP_HEIGHT / 2
    )
  }

  return (
    MAP_TOP +
    (
      1 -
      (
        (latitude -
          minLatitude) /
        (
          maxLatitude -
          minLatitude
        )
      )
    ) *
      MAP_HEIGHT
  )
}


function nearbyFeatureDistance(
  feature,
  center,
) {
  const latDistance =
    Math.abs(
      Number(
        feature.latitude_deg,
      ) -
        Number(
          center.latitude_deg,
        ),
    )

  const lonDistance =
    Math.abs(
      Number(
        feature.longitude_deg,
      ) -
        Number(
          center.longitude_deg,
        ),
    )

  return (
    latDistance +
    lonDistance
  )
}


export default function MarsTacticalMap({
  feature,
  nearbyFeatures = [],
  route = null,
  widthKm = 40,
  heightKm = 40,
}) {
  const [
    terrain,
    setTerrain,
  ] = useState(null)

  const [
    loading,
    setLoading,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState('')


  useEffect(() => {
    if (!feature) {
      setTerrain(null)
      return
    }

    const controller =
      new AbortController()

    async function loadTerrain() {
      try {
        setLoading(true)
        setError('')

        const data =
          await fetchTerrainWindow(
            feature.latitude_deg,
            feature.longitude_deg,
            widthKm,
            heightKm,
          )

        if (
          controller.signal
            .aborted
        ) {
          return
        }

        setTerrain(data)
      } catch (err) {
        if (
          !controller.signal
            .aborted
        ) {
          setError(
            err.message,
          )
        }
      } finally {
        if (
          !controller.signal
            .aborted
        ) {
          setLoading(false)
        }
      }
    }

    loadTerrain()

    return () =>
      controller.abort()
  }, [
    feature,
    widthKm,
    heightKm,
  ])


  const nearby =
    useMemo(() => {
      if (!feature) {
        return []
      }

      return nearbyFeatures
        .slice()
        .sort(
          (a, b) =>
            nearbyFeatureDistance(
              a,
              feature,
            ) -
            nearbyFeatureDistance(
              b,
              feature,
            ),
        )
        .slice(0, 14)
    }, [
      nearbyFeatures,
      feature,
    ])


  if (!feature) {
    return (
      <div className="tactical-map-empty">
        SELECT A MARS SITE
      </div>
    )
  }


  if (loading) {
    return (
      <div className="tactical-map-empty">
        LOADING MOLA 128 PP DEG TERRAIN...
      </div>
    )
  }


  if (error) {
    return (
      <div className="tactical-map-empty">
        TERRAIN ERROR: {error}
      </div>
    )
  }


  if (!terrain) {
    return (
      <div className="tactical-map-empty">
        NO TERRAIN DATA
      </div>
    )
  }


  const latitudes =
    terrain.latitudes_deg

  const longitudes =
    terrain.longitudes_deg

  const elevations =
    terrain.elevations_m

  const slopes =
    terrain.slope_deg

  const roughness =
    terrain.roughness_m


  const minLatitude =
    Math.min(...latitudes)

  const maxLatitude =
    Math.max(...latitudes)

  const minLongitude =
    Math.min(...longitudes)

  const maxLongitude =
    Math.max(...longitudes)


  const summary =
    terrain.summary ?? {}


  const rows =
    terrain.rows

  const cols =
    terrain.cols


  const cellWidth =
    MAP_WIDTH / cols

  const cellHeight =
    MAP_HEIGHT / rows


  const centerRow =
    Math.floor(rows / 2)

  const centerCol =
    Math.floor(cols / 2)


  const centerElevation =
    elevations[
      centerRow
    ][
      centerCol
    ]


  return (
    <div className="tactical-map">
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        role="img"
        aria-label={`MOLA tactical terrain map for ${feature.feature_name}`}
      >
        <rect
          x="0"
          y="0"
          width={VIEWBOX_WIDTH}
          height={VIEWBOX_HEIGHT}
          fill="#070b0e"
        />

        <text
          x="55"
          y="35"
          fill="#75e6ff"
          fontSize="15"
          fontFamily="monospace"
          letterSpacing="2.5"
        >
          MOLA / 128 PX PER DEGREE
        </text>

        <text
          x="55"
          y="58"
          fill="#71858f"
          fontSize="10"
          fontFamily="monospace"
        >
          LOCAL VECTOR TERRAIN ANALYSIS
        </text>


        <rect
          x={MAP_LEFT}
          y={MAP_TOP}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          fill="#0b1115"
          stroke="#24343c"
          strokeWidth="1"
        />


        {elevations.map(
          (row, rowIndex) =>
            row.map(
              (
                elevation,
                colIndex,
              ) => {
                const slope =
                  slopes[
                    rowIndex
                  ][
                    colIndex
                  ]

                const lat =
                  latitudes[
                    rowIndex
                  ]

                const lon =
                  longitudes[
                    colIndex
                  ]

                const x =
                  MAP_LEFT +
                  colIndex *
                    cellWidth

                const y =
                  MAP_TOP +
                  rowIndex *
                    cellHeight

                return (
                  <rect
                    key={[
                      rowIndex,
                      colIndex,
                    ].join('-')}
                    x={x}
                    y={y}
                    width={
                      cellWidth +
                      0.35
                    }
                    height={
                      cellHeight +
                      0.35
                    }
                    fill={elevationColor(
                      elevation,
                      Number(
                        summary.elevation_min_m ??
                          elevation,
                      ),
                      Number(
                        summary.elevation_max_m ??
                          elevation,
                      ),
                    )}
                    stroke={slopeStroke(
                      slope,
                    )}
                    strokeWidth={
                      slope >= 15
                        ? 0.8
                        : 0.25
                    }
                    opacity={
                      0.92
                    }
                    data-lat={lat}
                    data-lon={lon}
                  />
                )
              },
            ),
        )}


        {nearby.map(
          (place) => {
            const latitude =
              Number(
                place.latitude_deg,
              )

            const longitude =
              Number(
                place.longitude_deg,
              )

            if (
              latitude <
                minLatitude ||
              latitude >
                maxLatitude ||
              longitude <
                minLongitude ||
              longitude >
                maxLongitude
            ) {
              return null
            }

            const x =
              mapX(
                longitude,
                minLongitude,
                maxLongitude,
              )

            const y =
              mapY(
                latitude,
                minLatitude,
                maxLatitude,
              )

            return (
              <g
                key={[
                  place.feature_name,
                  place.latitude_deg,
                  place.longitude_deg,
                ].join(':')}
              >
                <circle
                  cx={x}
                  cy={y}
                  r="4"
                  fill="#ffffff"
                  stroke="#75e6ff"
                  strokeWidth="1.5"
                />

                <line
                  x1={x}
                  y1={y}
                  x2={x + 14}
                  y2={y - 14}
                  stroke="#75e6ff"
                  strokeWidth="0.8"
                />

                <text
                  x={x + 19}
                  y={y - 17}
                  fill="#ffffff"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {
                    place.feature_name
                  }
                </text>

                <text
                  x={x + 19}
                  y={y - 5}
                  fill="#71858f"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  {
                    place.feature_type
                  }
                </text>
              </g>
            )
          },
        )}


        {route?.route?.coordinates?.length >
          1 && (
          <polyline
            points={
              route.route.coordinates
                .map(
                  ([
                    latitude,
                    longitude,
                  ]) =>
                    `${mapX(
                      longitude,
                      minLongitude,
                      maxLongitude,
                    )},${mapY(
                      latitude,
                      minLatitude,
                      maxLatitude,
                    )}`,
                )
                .join(' ')
            }
            fill="none"
            stroke="#75e6ff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}


        <circle
          cx={mapX(
            feature.longitude_deg,
            minLongitude,
            maxLongitude,
          )}
          cy={mapY(
            feature.latitude_deg,
            minLatitude,
            maxLatitude,
          )}
          r="7"
          fill="#75e6ff"
          stroke="#ffffff"
          strokeWidth="1.5"
        />

        <line
          x1={mapX(
            feature.longitude_deg,
            minLongitude,
            maxLongitude,
          )}
          y1={mapY(
            feature.latitude_deg,
            minLatitude,
            maxLatitude,
          )}
          x2="690"
          y2="120"
          stroke="#75e6ff"
          strokeWidth="1"
        />

        <text
          x="705"
          y="116"
          fill="#ffffff"
          fontSize="15"
          fontFamily="monospace"
        >
          {feature.feature_name}
        </text>

        <text
          x="705"
          y="137"
          fill="#75e6ff"
          fontSize="10"
          fontFamily="monospace"
        >
          CENTER ELEV {Number(
            centerElevation,
          ).toFixed(0)} m
        </text>

        <text
          x="705"
          y="154"
          fill="#ffb45c"
          fontSize="10"
          fontFamily="monospace"
        >
          MAX SLOPE {Number(
            summary.slope_max_deg ??
              0,
          ).toFixed(1)}°
        </text>

        <text
          x="705"
          y="171"
          fill="#78d7c0"
          fontSize="10"
          fontFamily="monospace"
        >
          MAX ROUGHNESS {Number(
            summary.roughness_max_m ??
              0,
          ).toFixed(1)} m
        </text>


        <rect
          x="55"
          y="640"
          width="890"
          height="80"
          fill="#0c1419"
          stroke="#24343c"
        />

        <text
          x="72"
          y="662"
          fill="#71858f"
          fontSize="9"
          fontFamily="monospace"
        >
          ELEVATION
        </text>

        <text
          x="72"
          y="680"
          fill="#ffffff"
          fontSize="11"
          fontFamily="monospace"
        >
          {Number(
            summary.elevation_min_m ??
              0,
          ).toFixed(0)}
          {' → '}
          {Number(
            summary.elevation_max_m ??
              0,
          ).toFixed(0)}
          {' m'}
        </text>


        <text
          x="265"
          y="662"
          fill="#71858f"
          fontSize="9"
          fontFamily="monospace"
        >
          MEAN SLOPE
        </text>

        <text
          x="265"
          y="680"
          fill="#e8d56b"
          fontSize="11"
          fontFamily="monospace"
        >
          {Number(
            summary.slope_mean_deg ??
              0,
          ).toFixed(2)}
          °
        </text>


        <text
          x="430"
          y="662"
          fill="#71858f"
          fontSize="9"
          fontFamily="monospace"
        >
          ROUGHNESS
        </text>

        <text
          x="430"
          y="680"
          fill="#78d7c0"
          fontSize="11"
          fontFamily="monospace"
        >
          {Number(
            summary.roughness_mean_m ??
              0,
          ).toFixed(2)}
          {' m'}
        </text>


        <text
          x="600"
          y="662"
          fill="#71858f"
          fontSize="9"
          fontFamily="monospace"
        >
          SLOPE KEY
        </text>

        <line
          x1="600"
          y1="680"
          x2="625"
          y2="680"
          stroke="#72d9c3"
          strokeWidth="4"
        />

        <text
          x="632"
          y="684"
          fill="#71858f"
          fontSize="8"
          fontFamily="monospace"
        >
          &lt;8°
        </text>

        <line
          x1="685"
          y1="680"
          x2="710"
          y2="680"
          stroke="#e8d56b"
          strokeWidth="4"
        />

        <text
          x="717"
          y="684"
          fill="#71858f"
          fontSize="8"
          fontFamily="monospace"
        >
          8–15°
        </text>

        <line
          x1="775"
          y1="680"
          x2="800"
          y2="680"
          stroke="#ffb45c"
          strokeWidth="4"
        />

        <text
          x="807"
          y="684"
          fill="#71858f"
          fontSize="8"
          fontFamily="monospace"
        >
          15–25°
        </text>

        <line
          x1="860"
          y1="680"
          x2="885"
          y2="680"
          stroke="#ff647c"
          strokeWidth="4"
        />

        <text
          x="892"
          y="684"
          fill="#71858f"
          fontSize="8"
          fontFamily="monospace"
        >
          25°+
        </text>


        <text
          x="55"
          y="742"
          fill="#52646d"
          fontSize="8"
          fontFamily="monospace"
        >
          SOURCE: NASA MOLA MEGDR L3 / MOLA 128 PIXELS PER DEGREE
        </text>
      </svg>
    </div>
  )
}
