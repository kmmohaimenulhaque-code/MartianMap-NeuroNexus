import { useEffect } from 'react'
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import { CRS } from 'leaflet'
import 'leaflet/dist/leaflet.css'

const MARS_BOUNDS = [
  [0, 0],
  [180, 360],
]

function marsPosition(feature) {
  return [
    90 - Number(feature.latitude_deg),
    Number(feature.longitude_deg) % 360,
  ]
}

function featureColor(featureType = '') {
  const type = featureType
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

  return colors[type] ?? '#d5d9dc'
}

function MapFocus({ feature }) {
  const map = useMap()

  useEffect(() => {
    if (!feature) return

    map.flyTo(
      marsPosition(feature),
      1.6,
      {
        duration: 0.8,
      },
    )
  }, [feature, map])

  return null
}

export default function MarsMap({
  features,
  selectedFeature,
  onSelect,
}) {
  return (
    <MapContainer
      center={[90, 180]}
      zoom={0}
      minZoom={-1}
      maxZoom={5}
      crs={CRS.Simple}
      maxBounds={MARS_BOUNDS}
      maxBoundsViscosity={1}
      scrollWheelZoom
      zoomControl
      style={{
        width: '100%',
        height: '100%',
        background: '#090c0f',
      }}
    >
      <ImageOverlay
        url="/mars-mola-global.jpg"
        bounds={MARS_BOUNDS}
        opacity={0.92}
      />

      <MapFocus feature={selectedFeature} />

      {features.map((feature) => {
        const position = marsPosition(feature)

        const selected =
          selectedFeature &&
          String(
            selectedFeature.feature_name,
          ) ===
            String(feature.feature_name)

        const markerColor =
          featureColor(feature.feature_type)

        return (
          <CircleMarker
            key={[
              feature.feature_name,
              feature.latitude_deg,
              feature.longitude_deg,
            ].join(':')}
            center={position}
            radius={selected ? 5 : 2.2}
            pathOptions={{
              color: selected
                ? '#75e6ff'
                : markerColor,
              weight: selected ? 2 : 0.7,
              opacity: selected ? 1 : 0.78,
              fillColor: markerColor,
              fillOpacity: selected ? 1 : 0.72,
            }}
            eventHandlers={{
              click: () => onSelect(feature),
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -4]}
            >
              <strong>
                {feature.feature_name}
              </strong>
              <br />
              {feature.feature_type}
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
