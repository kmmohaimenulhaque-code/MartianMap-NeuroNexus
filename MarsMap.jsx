import { useEffect } from 'react'
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import { CRS, Transformation } from 'leaflet'
import 'leaflet/dist/leaflet.css'

const MARS_BOUNDS = [
  [-90, 0],
  [90, 360],
]

/*
 * Mars coordinate system:
 *
 * Latitude:
 *   +90° north
 *   ↓
 *    0°
 *   ↓
 *   -90° south
 *
 * Longitude:
 *   0° → 360° east
 *
 * Zoom relationship:
 *
 *   z=0 → 1 px/degree
 *   z=1 → 2 px/degree
 *   ...
 *   z=7 → 128 px/degree
 *
 * z=7 therefore matches the native MOLA 128 ppd grid.
 */
const MARS_CRS = {
  ...CRS.Simple,

  transformation: new Transformation(
    1,
    0,
    -1,
    90,
  ),

  scale(zoom) {
    return Math.pow(2, zoom)
  },
}

const MOLA_TILE_URL =
  '/terrain/tile/{z}/{x}/{y}.png'

function marsPosition(feature) {
  return [
    Number(feature.latitude_deg),
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
      center={[0, 180]}
      zoom={0}
      minZoom={0}
      maxZoom={7}
      crs={MARS_CRS}
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
      {/*
       * EXISTING GLOBAL OVERVIEW
       *
       * Kept intact as the low-resolution Mars overview.
       * Its opacity is reduced so it does not overpower the
       * live MOLA terrain layer when both are visible.
       */}
      <ImageOverlay
        url="/mars-mola-global.jpg"
        bounds={MARS_BOUNDS}
        opacity={0.35}
      />

      {/*
       * LIVE NASA MOLA MEGDR 128 ppd TERRAIN
       *
       * This is the real server-rendered terrain layer.
       * At z=7 it reaches native MOLA resolution.
       */}
      <TileLayer
        url={MOLA_TILE_URL}
        tileSize={180}
        minZoom={0}
        maxZoom={7}
        opacity={1}
        bounds={MARS_BOUNDS}
        noWrap
        updateWhenZooming
        keepBuffer={2}
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
          featureColor(
            feature.feature_type,
          )

        return (
          <CircleMarker
            key={[
              feature.feature_name,
              feature.latitude_deg,
              feature.longitude_deg,
            ].join(':')}
            center={position}
            radius={
              selected
                ? 5
                : 2.2
            }
            pathOptions={{
              color: selected
                ? '#75e6ff'
                : markerColor,
              weight: selected
                ? 2
                : 0.7,
              opacity: selected
                ? 1
                : 0.78,
              fillColor: markerColor,
              fillOpacity: selected
                ? 1
                : 0.72,
            }}
            eventHandlers={{
              click: () =>
                onSelect(feature),
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
