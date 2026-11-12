import { useEffect } from 'react'
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Polyline,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import {
  CRS,
  Transformation,
} from 'leaflet'

import 'leaflet/dist/leaflet.css'


const MARS_BOUNDS = [
  [-90, 0],
  [90, 360],
]


const MARS_CRS = {
  ...CRS.Simple,

  transformation:
    new Transformation(
      1,
      0,
      -1,
      90,
    ),

  scale(zoom) {
    return Math.pow(
      2,
      zoom,
    )
  },
}


function marsPosition(feature) {
  return [
    Number(
      feature.latitude_deg,
    ),

    (
      Number(
        feature.longitude_deg,
      ) % 360 +
      360
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


function MapResizeHandler() {
  const map = useMap()

  useEffect(() => {
    const container =
      map.getContainer()

    const resizeObserver =
      new ResizeObserver(() => {
        map.invalidateSize({
          animate: false,
        })
      })

    resizeObserver.observe(
      container,
    )

    map.invalidateSize({
      animate: false,
    })

    return () => {
      resizeObserver.disconnect()
    }
  }, [map])

  return null
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
      marsPosition(feature),
      1.6,
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


function RouteClickCapture({
  enabled,
  onSelect,
}) {
  useMapEvents({
    click(event) {
      if (!enabled) {
        return
      }

      onSelect({
        latitude_deg:
          event.latlng.lat,

        longitude_deg:
          event.latlng.lng,
      })
    },
  })

  return null
}


function RoutePointMarker({
  point,
  label,
  type,
}) {
  if (!point) {
    return null
  }

  const color =
    type === 'start'
      ? '#62f59a'
      : '#ff647c'

  return (
    <CircleMarker
      center={[
        point.latitude_deg,
        point.longitude_deg,
      ]}
      radius={7}
      pathOptions={{
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      }}
    >
      <Tooltip
        direction="top"
        offset={[0, -7]}
      >
        <strong>
          {label}
        </strong>

        <br />

        {Number(
          point.latitude_deg,
        ).toFixed(4)}
        °,

        {' '}

        {Number(
          point.longitude_deg,
        ).toFixed(4)}
        °E
      </Tooltip>
    </CircleMarker>
  )
}


export default function MarsMap({
  features = [],
  selectedFeature,
  onSelect,

  routeMode = false,
  routeStart = null,
  routeEnd = null,
  route = null,

  onMapLocationSelect =
    () => {},
}) {
  const routeCoordinates =
    route?.route
      ?.coordinates ??
    []

  return (
    <MapContainer
      center={[
        0,
        180,
      ]}
      zoom={0}
      minZoom={0}
      maxZoom={7}
      crs={MARS_CRS}
      maxBounds={
        MARS_BOUNDS
      }
      maxBoundsViscosity={1}
      scrollWheelZoom
      zoomControl
      preferCanvas
      style={{
        width: '100%',
        height: '100%',
        background:
          '#090c0f',
      }}
    >
      <MapResizeHandler />

      <ImageOverlay
        url="/mars-mola-global.jpg"
        bounds={
          MARS_BOUNDS
        }
        opacity={1}
      />

      <MapFocus
        feature={
          selectedFeature
        }
      />

      <RouteClickCapture
        enabled={
          routeMode
        }
        onSelect={
          onMapLocationSelect
        }
      />

      {routeCoordinates.length > 1 && (
        <Polyline
          positions={
            routeCoordinates
          }
          pathOptions={{
            color:
              '#75e6ff',
            weight: 4,
            opacity: 0.95,
          }}
        />
      )}

      <RoutePointMarker
        point={
          routeStart
        }
        label="ROUTE START"
        type="start"
      />

      <RoutePointMarker
        point={
          routeEnd
        }
        label="DESTINATION"
        type="end"
      />

      {features.map(
        (feature) => {
          const position =
            marsPosition(
              feature,
            )

          const selected =
            selectedFeature &&
            String(
              selectedFeature
                .feature_name,
            ) ===
              String(
                feature
                  .feature_name,
              )

          const markerColor =
            featureColor(
              feature
                .feature_type,
            )

          return (
            <CircleMarker
              key={[
                feature.feature_name,
                feature.latitude_deg,
                feature.longitude_deg,
              ].join(':')}
              center={
                position
              }
              radius={
                selected
                  ? 5
                  : 2.2
              }
              pathOptions={{
                color:
                  selected
                    ? '#75e6ff'
                    : markerColor,

                weight:
                  selected
                    ? 2
                    : 0.7,

                opacity:
                  selected
                    ? 1
                    : 0.78,

                fillColor:
                  markerColor,

                fillOpacity:
                  selected
                    ? 1
                    : 0.72,
              }}
              eventHandlers={{
                click: (
                  event,
                ) => {
                  event
                    .originalEvent
                    ?.stopPropagation()

                  if (
                    routeMode
                  ) {
                    onMapLocationSelect({
                      latitude_deg:
                        feature.latitude_deg,

                      longitude_deg:
                        feature.longitude_deg,

                      label:
                        feature.feature_name,
                    })

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
                  -4,
                ]}
              >
                <strong>
                  {
                    feature
                      .feature_name
                  }
                </strong>

                <br />

                {
                  feature
                    .feature_type
                }
              </Tooltip>
            </CircleMarker>
          )
        },
      )}
    </MapContainer>
  )
}
