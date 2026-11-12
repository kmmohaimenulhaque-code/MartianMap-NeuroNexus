import {
  useEffect,
  useState,
} from 'react'

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
    Crater: '#8c6849',
    Vallis: '#347b91',
    Mons: '#a45f37',
    Fossa: '#5f896b',
    Mensa: '#8d7b3e',
    Planum: '#80639d',
    Patera: '#9f5964',
    Chaos: '#4a8795',
    Rupes: '#8e754b',
    Chasma: '#5876a1',
    Dorsum: '#876a4d',
    Terra: '#987353',
    Planitia: '#5f7d73',
  }

  return (
    colors[type]
    ??
    '#77736a'
  )
}


function contourInfo(
  zoom,
) {
  if (zoom >= 6) {
    return {
      minor: '125 m',
      index: '625 m',
    }
  }

  if (zoom >= 5) {
    return {
      minor: '200 m',
      index: '1 km',
    }
  }

  if (zoom >= 4) {
    return {
      minor: '250 m',
      index: '1.25 km',
    }
  }

  if (zoom >= 3) {
    return {
      minor: '500 m',
      index: '2.5 km',
    }
  }

  if (zoom >= 2) {
    return {
      minor: '1 km',
      index: '5 km',
    }
  }

  return {
    minor: '2 km',
    index: '10 km',
  }
}


function MapFocus({
  feature,
}) {
  const map =
    useMap()

  useEffect(
    () => {
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
    },
    [
      feature,
      map,
    ],
  )

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
          )
          %
            360
          +
          360
        )
        %
          360

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


function MapTelemetry() {
  const map =
    useMap()

  const [
    zoom,
    setZoom,
  ] = useState(
    map.getZoom(),
  )

  useEffect(
    () => {
      const update =
        () => {
          setZoom(
            map.getZoom(),
          )
        }

      map.on(
        'zoomend',
        update,
      )

      return () => {
        map.off(
          'zoomend',
          update,
        )
      }
    },
    [map],
  )

  const contour =
    contourInfo(
      zoom,
    )

  return (
    <div
      className="
        nn-topo-legend
      "
    >
      <span
        className="
          nn-topo-chip
        "
      >
        NASA MOLA ·
        {' '}
        128 PX/DEG
      </span>

      <span
        className="
          nn-topo-line
          nn-topo-line-minor
        "
      >
        <i />
        MINOR
        {' '}
        {contour.minor}
      </span>

      <span
        className="
          nn-topo-line
          nn-topo-line-index
        "
      >
        <i />
        INDEX
        {' '}
        {contour.index}
      </span>

      <span
        className="
          nn-topo-chip
        "
      >
        SVG CONTOURS
      </span>

      <span
        className="
          nn-topo-chip
        "
      >
        HILLSHADE
      </span>
    </div>
  )
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
    <div
      className="
        topographic-toolbar
      "
    >
      <div
        className="
          topographic-toolbar-copy
        "
      >
        <span>
          MOLA / 128 PX
          PER DEGREE
        </span>

        <strong>
          MARS TOPOGRAPHIC
          {' '}
          NAVIGATION
        </strong>

        <small>
          {
            routeMode
              ? 'MAP CLICK = ADD WAYPOINT'
              : 'CLICK FEATURE TO INSPECT · PLAN ROUTE TO NAVIGATE'
          }
        </small>
      </div>

      <div
        className="
          topographic-toolbar-actions
        "
      >
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
          {
            routeMode
              ? 'STOP PLANNING'
              : 'PLAN ROUTE'
          }
        </button>

        <button
          type="button"
          className="
            topo-control
          "
          onClick={
            onAddSelected
          }
          disabled={
            !selectedFeature
            ||
            routePoints.length
              >= 32
          }
        >
          ADD SELECTED
        </button>

        <button
          type="button"
          className="
            topo-control
            primary
          "
          onClick={
            onAnalyzeRoute
          }
          disabled={
            routePoints.length
              < 2
            ||
            loading
          }
        >
          {
            loading
              ? 'ANALYZING…'
              : 'ANALYZE ROUTE'
          }
        </button>

        <button
          type="button"
          className="
            topo-control
            danger
          "
          onClick={
            onClear
          }
          disabled={
            routePoints.length
              === 0
          }
        >
          CLEAR
        </button>
      </div>

      <div
        className="
          topographic-route-strip
        "
      >
        {
          routePoints.length
            === 0
            ? (
              <span>
                NO WAYPOINTS · CLICK PLAN ROUTE TO BEGIN
              </span>
            )
            : (
              routePoints.map(
                (
                  point,
                  index,
                ) => (
                  <span
                    key={
                      String(
                        point.latitude_deg,
                      )
                      +
                      ':'
                      +
                      String(
                        point.longitude_deg,
                      )
                      +
                      ':'
                      +
                      String(
                        index,
                      )
                    }
                  >
                    {
                      index ===
                        0
                        ? 'A'
                        : index ===
                            routePoints.length -
                              1
                          ? 'B'
                          : 'P' +
                            index
                    }

                    {' · '}

                    {
                      point.label
                      ??
                      'COORDINATE'
                    }
                  </span>
                ),
              )
            )
        }
      </div>
    </div>
  )
}


function TopographicStyles() {
  return (
    <style>
      {`
        .neuronexus-topographic-v3 {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          background: #ece9df !important;
          border: 1px solid #c9c1b2;
        }

        .neuronexus-topographic-v3
        .leaflet-container {
          width: 100%;
          height: 100%;
          background: #ece9df !important;
          color: #293638;
        }

        .neuronexus-topographic-v3
        .leaflet-control-zoom {
          border: 1px solid #bdb4a5 !important;
          box-shadow:
            0 5px 15px
            rgba(65, 59, 50, 0.16);
        }

        .neuronexus-topographic-v3
        .leaflet-control-zoom a {
          width: 30px;
          height: 30px;
          line-height: 30px;
          color: #344346 !important;
          background: #fbfaf5 !important;
          border-bottom-color: #d5cdbf !important;
        }

        .neuronexus-topographic-v3
        .leaflet-control-zoom a:hover {
          background: #f1eee5 !important;
        }

        .neuronexus-topographic-v3
        .leaflet-tile {
          image-rendering: auto;
        }

        /*
         * This is the actual transparent vector contour
         * layer returned by /terrain/contours/...svg.
         */
        .neuronexus-topographic-v3
        .nn-svg-contour-layer {
          pointer-events: none;
          opacity: 0.98;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar {
          position: absolute;
          z-index: 1200;
          top: 10px;
          left: 10px;
          right: 10px;

          display: grid;

          grid-template-columns:
            minmax(180px, 1fr)
            auto;

          gap: 8px;

          padding: 8px;

          border:
            1px solid
            #c6bdad;

          background:
            rgba(
              248,
              246,
              239,
              0.96
            );

          color: #253235;

          box-shadow:
            0 10px 26px
            rgba(
              62,
              56,
              48,
              0.17
            );

          backdrop-filter:
            blur(8px);
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-copy {
          min-width: 0;

          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-copy span {
          color: #587477;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-copy strong {
          color: #273739;
          font-family: monospace;
          font-size: 11px;
          letter-spacing: 0.09em;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-copy small {
          color: #777269;
          font-family: monospace;
          font-size: 8px;
          letter-spacing: 0.06em;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 5px;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-actions
        button {
          min-height: 31px;
          padding: 0 9px;

          border:
            1px solid
            #b9b0a2;

          background:
            #fbfaf6;

          color:
            #4e5e62;

          font-family:
            monospace;

          font-size:
            8px;

          letter-spacing:
            0.08em;

          cursor:
            pointer;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-actions
        button:hover {
          border-color:
            #147889;

          color:
            #174f57;

          background:
            #f2f7f5;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-actions
        button.active,
        .neuronexus-topographic-v3
        .topographic-toolbar-actions
        button.primary {
          border-color:
            #147889;

          color:
            #116274;

          background:
            #e2eeeb;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-actions
        button.danger {
          border-color:
            #b67b82;

          color:
            #9a4956;

          background:
            #fbf4f4;
        }

        .neuronexus-topographic-v3
        .topographic-toolbar-actions
        button:disabled {
          opacity:
            0.4;

          cursor:
            not-allowed;
        }

        .neuronexus-topographic-v3
        .topographic-route-strip {
          grid-column:
            1 / -1;

          display:
            flex;

          flex-wrap:
            wrap;

          gap:
            5px 9px;

          padding:
            6px 7px;

          border:
            1px solid
            #d4ccbd;

          background:
            #f5f2ea;

          color:
            #666b67;

          font-family:
            monospace;

          font-size:
            8px;

          letter-spacing:
            0.08em;
        }

        .neuronexus-topographic-v3
        .topographic-route-strip
        span + span::before {
          content:
            '→';

          margin-right:
            9px;

          color:
            #a19482;
        }

        .neuronexus-topographic-v3
        .nn-topo-legend {
          position:
            absolute;

          z-index:
            1200;

          left:
            10px;

          right:
            10px;

          bottom:
            47px;

          display:
            flex;

          flex-wrap:
            wrap;

          align-items:
            center;

          gap:
            7px 13px;

          padding:
            7px 9px;

          border:
            1px solid
            #c8c0b1;

          background:
            rgba(
              250,
              248,
              242,
              0.94
            );

          color:
            #5c625f;

          font-family:
            monospace;

          font-size:
            7px;

          letter-spacing:
            0.08em;

          box-shadow:
            0 6px 16px
            rgba(
              62,
              56,
              48,
              0.11
            );

          pointer-events:
            none;
        }

        .neuronexus-topographic-v3
        .nn-topo-chip,
        .neuronexus-topographic-v3
        .nn-topo-line {
          display:
            inline-flex;

          align-items:
            center;

          gap:
            5px;
        }

        .neuronexus-topographic-v3
        .nn-topo-line i {
          display:
            inline-block;

          width:
            18px;

          height:
            0;

          border-top:
            1px solid
            #a88767;
        }

        .neuronexus-topographic-v3
        .nn-topo-line-index i {
          border-top:
            2px solid
            #76563c;
        }

        .neuronexus-topographic-v3
        .topographic-north {
          position:
            absolute;

          z-index:
            1200;

          top:
            122px;

          left:
            10px;

          width:
            35px;

          min-height:
            44px;

          display:
            flex;

          flex-direction:
            column;

          justify-content:
            center;

          align-items:
            center;

          gap:
            1px;

          border:
            1px solid
            #c7beaf;

          background:
            rgba(
              250,
              248,
              241,
              0.95
            );

          color:
            #44565a;

          box-shadow:
            0 7px 18px
            rgba(
              62,
              56,
              48,
              0.12
            );

          pointer-events:
            none;

          font-family:
            monospace;
        }

        .neuronexus-topographic-v3
        .topographic-north strong {
          font-size:
            11px;
        }

        .neuronexus-topographic-v3
        .topographic-north span {
          font-size:
            12px;

          line-height:
            1;
        }

        .neuronexus-topographic-v3
        .nn-topo-scale {
          position:
            absolute;

          z-index:
            1200;

          left:
            10px;

          bottom:
            91px;

          display:
            flex;

          flex-direction:
            column;

          align-items:
            flex-start;

          gap:
            2px;

          padding:
            5px 7px;

          border:
            1px solid
            #c8c0b1;

          background:
            rgba(
              250,
              248,
              242,
              0.94
            );

          color:
            #5b625f;

          box-shadow:
            0 5px 14px
            rgba(
              62,
              56,
              48,
              0.1
            );

          pointer-events:
            none;

          font-family:
            monospace;
        }

        .neuronexus-topographic-v3
        .nn-topo-scale-line {
          height:
            8px;

          display:
            flex;

          align-items:
            flex-end;

          justify-content:
            space-between;

          border-bottom:
            2px solid
            #6e6a60;
        }

        .neuronexus-topographic-v3
        .nn-topo-scale-line span {
          width:
            1px;

          height:
            7px;

          background:
            #6e6a60;
        }

        .neuronexus-topographic-v3
        .nn-topo-scale strong {
          font-size:
            8px;
        }

        .neuronexus-topographic-v3
        .nn-topo-scale small {
          font-size:
            6px;

          color:
            #847e72;
        }

        .neuronexus-topographic-v3
        .topographic-readout {
          position:
            absolute;

          z-index:
            1200;

          top:
            122px;

          right:
            10px;

          display:
            grid;

          grid-template-columns:
            auto auto;

          gap:
            3px 8px;

          padding:
            7px 8px;

          border:
            1px solid
            #c8bfb0;

          background:
            rgba(
              251,
              249,
              244,
              0.95
            );

          color:
            #2c3a3d;

          box-shadow:
            0 8px 20px
            rgba(
              62,
              56,
              48,
              0.13
            );

          pointer-events:
            none;

          font-family:
            monospace;
        }

        .neuronexus-topographic-v3
        .topographic-readout span {
          color:
            #777267;

          font-size:
            7px;
        }

        .neuronexus-topographic-v3
        .topographic-readout strong {
          grid-column:
            1 / -1;

          max-width:
            220px;

          overflow:
            hidden;

          text-overflow:
            ellipsis;

          white-space:
            nowrap;

          color:
            #263538;

          font-size:
            9px;
        }

        .neuronexus-topographic-v3
        .topographic-footer {
          position:
            absolute;

          z-index:
            1200;

          left:
            10px;

          right:
            10px;

          bottom:
            10px;

          display:
            flex;

          justify-content:
            space-between;

          gap:
            8px;

          padding:
            6px 8px;

          border:
            1px solid
            #c8c0b1;

          background:
            rgba(
              250,
              248,
              242,
              0.94
            );

          color:
            #676d69;

          font-family:
            monospace;

          font-size:
            7px;

          letter-spacing:
            0.08em;

          box-shadow:
            0 6px 16px
            rgba(
              62,
              56,
              48,
              0.09
            );

          pointer-events:
            none;
        }

        .neuronexus-topographic-v3
        .leaflet-tooltip {
          border:
            1px solid
            #cbbfae;

          background:
            #fbfaf5;

          color:
            #273639;

          box-shadow:
            0 5px 14px
            rgba(
              62,
              56,
              48,
              0.16
            );

          font-size:
            10px;
        }

        .neuronexus-topographic-v3
        .leaflet-tooltip strong {
          color:
            #24363a;
        }

        @media (
          max-width: 900px
        ) {
          .neuronexus-topographic-v3
          .topographic-toolbar {
            grid-template-columns:
              1fr;
          }

          .neuronexus-topographic-v3
          .topographic-toolbar-actions {
            justify-content:
              flex-start;
          }

          .neuronexus-topographic-v3
          .nn-topo-legend {
            bottom:
              50px;
          }
        }
      `}
    </style>
  )
}


function TopographicScale() {
  const map =
    useMap()

  const [
    zoom,
    setZoom,
  ] = useState(
    map.getZoom(),
  )

  useEffect(
    () => {
      const update =
        () => {
          setZoom(
            map.getZoom(),
          )
        }

      map.on(
        'zoomend',
        update,
      )

      return () => {
        map.off(
          'zoomend',
          update,
        )
      }
    },
    [map],
  )

  const center =
    map.getCenter()

  const latitudeRad =
    Number(
      center.lat,
    )
    *
    Math.PI
    /
    180.0

  const kmPerDegree =
    3396.0
    *
    Math.PI
    /
    180.0
    *
    Math.max(
      0.08,
      Math.cos(
        latitudeRad,
      ),
    )

  const pxPerDegree =
    2 ** zoom

  const targetCandidates = [
    10000,
    5000,
    2000,
    1000,
    500,
    200,
    100,
    50,
    20,
    10,
  ]

  let selectedKm =
    1000

  let widthPx =
    selectedKm
    /
    kmPerDegree
    *
    pxPerDegree

  for (
    const candidate
    of targetCandidates
  ) {
    const candidateWidth =
      candidate
      /
      kmPerDegree
      *
      pxPerDegree

    if (
      candidateWidth >= 55
      &&
      candidateWidth <= 145
    ) {
      selectedKm =
        candidate

      widthPx =
        candidateWidth

      break
    }
  }

  const label =
    selectedKm >= 1000
      ? `${selectedKm / 1000}k km`
      : `${selectedKm} km`

  return (
    <div
      className="
        nn-topo-scale
      "
    >
      <div
        className="
          nn-topo-scale-line
        "
        style={{
          width:
            `${Math.max(
              45,
              Math.min(
                145,
                widthPx,
              ),
            )}px`,
        }}
      >
        <span />
        <span />
      </div>

      <strong>
        {label}
      </strong>

      <small>
        APPROX. SURFACE SCALE
      </small>
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
    routePlan
      ?.planned_route
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

  const routePositions =
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

  return (
    <div
      className="
        topographic-map-shell
        neuronexus-topographic-v3
      "
    >
      <TopographicStyles />

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
        maxBoundsViscosity={
          1
        }
        scrollWheelZoom
        zoomControl
        worldCopyJump={
          false
        }
        style={{
          width:
            '100%',
          height:
            '100%',
          background:
            '#ece9df',
        }}
      >
        {/* ============================================================ */}
        {/* REAL MOLA PALE RELIEF                                        */}
        {/* ============================================================ */}

        <TileLayer
          url="/api/terrain/tile/{z}/{x}/{y}.png"
          tileSize={180}
          minZoom={0}
          maxZoom={7}
          noWrap
          bounds={
            MARS_BOUNDS
          }
          updateWhenZooming
          keepBuffer={2}
          opacity={1}
          zIndex={100}
        />

        {/* ============================================================ */}
        {/* REAL MOLA SVG CONTOUR OVERLAY                                */}
        {/* ============================================================ */}

        <TileLayer
          url="/api/terrain/contours/{z}/{x}/{y}.svg"
          tileSize={180}
          minZoom={0}
          maxZoom={7}
          noWrap
          bounds={
            MARS_BOUNDS
          }
          updateWhenZooming
          keepBuffer={2}
          opacity={1}
          zIndex={300}
          className="
            nn-svg-contour-layer
          "
        />

        {/* ============================================================ */}
        {/* MAP INTERACTION                                              */}
        {/* ============================================================ */}

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

        <MapTelemetry />

        <TopographicScale />

        {/* ============================================================ */}
        {/* REAL 2052 USGS FEATURES                                     */}
        {/* ============================================================ */}

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
                selectedFeature
                &&
                String(
                  selectedFeature
                    .feature_name,
                )
                ===
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
                  key={
                    feature
                      .feature_name
                    +
                    ':'
                    +
                    String(
                      feature
                        .latitude_deg,
                    )
                    +
                    ':'
                    +
                    String(
                      feature
                        .longitude_deg,
                    )
                  }
                  center={
                    position
                  }
                  radius={
                    selected
                      ? 5
                      : 1.8
                  }
                  pathOptions={{
                    color:
                      selected
                        ? '#174f57'
                        : markerColor,

                    weight:
                      selected
                        ? 2
                        : 0.8,

                    opacity:
                      selected
                        ? 1
                        : 0.72,

                    fillColor:
                      markerColor,

                    fillOpacity:
                      selected
                        ? 1
                        : 0.62,
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
                        onRoutePointAdd({
                          latitude_deg:
                            Number(
                              feature
                                .latitude_deg,
                            ),

                          longitude_deg:
                            Number(
                              feature
                                .longitude_deg,
                            )
                            %
                            360,

                          label:
                            feature
                              .feature_name,
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
                      -3,
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

                  {
                    selected
                    && (
                      <Tooltip
                        permanent
                        direction="right"
                        offset={[
                          8,
                          0,
                        ]}
                      >
                        <strong>
                          {
                            feature
                              .feature_name
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

        {/* ============================================================ */}
        {/* ROUTE                                                        */}
        {/* ============================================================ */}

        {
          routePositions.length
            > 1
            && (
              <>
                <Polyline
                  positions={
                    routePositions
                  }
                  pathOptions={{
                    color:
                      '#fffdf6',

                    weight:
                      8,

                    opacity:
                      0.96,
                  }}
                />

                <Polyline
                  positions={
                    routePositions
                  }
                  pathOptions={{
                    color:
                      '#08798a',

                    weight:
                      3,

                    opacity:
                      1,
                  }}
                />
              </>
            )
        }

        {/* ============================================================ */}
        {/* ROUTE WAYPOINTS                                              */}
        {/* ============================================================ */}

        {
          routePoints.map(
            (
              point,
              index,
            ) => (
              <CircleMarker
                key={
                  'route-point:'
                  +
                  String(
                    index,
                  )
                  +
                  ':'
                  +
                  String(
                    point
                      .latitude_deg,
                  )
                  +
                  ':'
                  +
                  String(
                    point
                      .longitude_deg,
                  )
                }
                center={[
                  90 -
                    Number(
                      point
                        .latitude_deg,
                    ),

                  Number(
                    point
                      .longitude_deg,
                  )
                  % 360,
                ]}
                radius={
                  index === 0
                  ||
                  index ===
                    routePoints.length -
                      1
                    ? 6.5
                    : 4.5
                }
                pathOptions={{
                  color:
                    '#ffffff',

                  weight:
                    2,

                  fillColor:
                    index === 0
                      ? '#2d8b59'
                      : index ===
                          routePoints.length -
                            1
                        ? '#c84d60'
                        : '#0b8293',

                  fillOpacity:
                    1,
                }}
              >
                <Tooltip
                  permanent
                  direction="top"
                  offset={[
                    0,
                    -8,
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
                          : 'P' +
                            index
                    }
                  </strong>

                  <br />

                  {
                    point.label
                    ??
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

      <div
        className="
          topographic-north
        "
      >
        <strong>
          N
        </strong>

        <span>
          ↑
        </span>
      </div>

      <div
        className="
          topographic-readout
        "
      >
        <span>
          SELECTED SITE
        </span>

        <strong>
          {
            selectedFeature
              ?.feature_name
            ??
            'MARS'
          }
        </strong>

        <span>
          ELEV
        </span>

        <span>
          {
            terrain
              ?.elevation_m
              ==
              null
              ? '—'
              : String(
                  Number(
                    terrain
                      .elevation_m,
                  ).toFixed(
                    0,
                  ),
                )
                +
                ' m'
          }
        </span>

        <span>
          SLOPE
        </span>

        <span>
          {
            terrain
              ?.slope_deg
              ==
              null
              ? '—'
              : String(
                  Number(
                    terrain
                      .slope_deg,
                  ).toFixed(
                    2,
                  ),
                )
                +
                '°'
          }
        </span>
      </div>

      <div
        className="
          topographic-footer
        "
      >
        <span>
          NASA MOLA MEGDR ·
          SVG CONTOURS ·
          INDEX LINES ·
          HILLSHADE
        </span>

        <span>
          {
            features.length
              .toLocaleString()
          }
          {' '}
          USGS FEATURES
        </span>
      </div>
    </div>
  )
}
