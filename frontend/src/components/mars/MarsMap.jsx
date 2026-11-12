import { featureColor } from "../layers/sharedLayerData";
import { useEffect, useMemo, useState } from "react";

import { CircleMarker, ImageOverlay, MapContainer, Marker, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { CRS, divIcon, Transformation } from "leaflet";

import "leaflet/dist/leaflet.css";
import "./mapMarkers.css";

import { perfStore } from "../../perf/perfStore";

const MARS_BOUNDS = [
  [-90, 0],
  [90, 360],
];

const MARS_CRS = {
  ...CRS.Simple,

  transformation: new Transformation(1, 0, -1, 90),

  scale(zoom) {
    return Math.pow(2, zoom);
  },
};

const COMPARISON_COLOURS = ["#01ffff", "#4ea8de", "#8cf0b1", "#3fbcd4"];

function normaliseLongitude(longitude) {
  return ((Number(longitude) % 360) + 360) % 360;
}

function marsPosition(feature) {
  return [Number(feature.latitude_deg ?? feature.lat), normaliseLongitude(feature.longitude_deg ?? feature.longitude ?? feature.lon ?? feature.lng)];
}

function pointPosition(point) {
  return [Number(point.latitude_deg ?? point.lat), normaliseLongitude(point.longitude_deg ?? point.longitude ?? point.lon ?? point.lng)];
}

function validPosition(position) {
  return Array.isArray(position) && position.length === 2 && Number.isFinite(position[0]) && Number.isFinite(position[1]);
}

function routeCoordinates(route) {
  const planned = route?.plan?.planned_route?.coordinates ?? route?.plan?.route?.coordinates;

  if (Array.isArray(planned) && planned.length > 1) {
    return planned;
  }

  const points = route?.points ?? [];

  return points.map((point) => [Number(point.latitude_deg), normaliseLongitude(point.longitude_deg)]);
}

/* Maps in the middle of a fly-to (MapFocus); MapResizeHandler waits for the flight to end. */
const FLYING = new WeakSet();
// The last coordinate picked by clicking this map: its own picks do not move its camera.
const OWN_PICK = new WeakMap();
const pickKey = (lat, lon) => `${Number(lat).toFixed(4)},${(((Number(lon) % 360) + 360) % 360).toFixed(4)}`;

/*
 * Zoom used when a selection made elsewhere is centered. With Leaflet's default integer zoomSnap the old 1.6
 * request snapped to 2; the maps now zoom in quarter steps, so ask for 2 to keep the same framing (at 2 the
 * whole planet is 720 px tall, which fills a phone map without letterboxing).
 */
const FOCUS_ZOOM = 2;

/* Smooth wheel / trackpad zoom: quarter-level snap, half a level per standard wheel notch, pinch unchanged. */
const SMOOTH_ZOOM = { zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 140, wheelDebounceTime: 40 };

/*
 * A map whose container has no layout box: the 2D map behind the phone USGS / 3D view, a collapsed panel.
 * Leaflet's animated moves divide by the view size there and throw "Invalid LatLng (NaN, NaN)", and fitBounds
 * picks the maximum zoom. Camera moves asked for while hidden are kept here and applied by MapResizeHandler
 * once the map has a size again, so a selection made on another view is centered when the 2D map comes back.
 */
const PENDING_VIEW = new WeakMap();

function isHidden(map) {
  const el = map.getContainer();
  return !el || !el.clientWidth || !el.clientHeight;
}

// Leaflet caches the view size; a show / hide in the same frame can leave it stale for an animated move.
function refreshSize(map) {
  const el = map.getContainer();
  const size = map.getSize();
  if (size.x !== el.clientWidth || size.y !== el.clientHeight) map.invalidateSize({ animate: false });
}

/* Runs a camera move now when the map is visible, or once it is shown again. Returns true when it ran now. */
function whenVisible(map, apply) {
  if (isHidden(map)) {
    PENDING_VIEW.set(map, apply);
    return false;
  }
  PENDING_VIEW.delete(map);
  refreshSize(map);
  apply();
  return true;
}

function applyPendingView(map) {
  const pending = PENDING_VIEW.get(map);
  if (!pending || isHidden(map)) return;
  PENDING_VIEW.delete(map);
  pending();
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    // A resize during a fly-to would fire moveend, and the max-bounds check would pan and cancel the flight
    // halfway (the map then stayed zoomed out). While flying, apply the resize once the flight ends.
    let pending = false;
    // Re-lay out, then apply a camera move that waited for the map to be shown (PENDING_VIEW).
    const relayout = () => {
      map.invalidateSize({ animate: false });
      applyPendingView(map);
    };
    const resizeObserver = new ResizeObserver(() => {
      if (FLYING.has(map)) {
        if (!pending) {
          pending = true;
          map.once("zoomend", () => {
            pending = false;
            relayout();
          });
        }
        return;
      }
      relayout();
    });

    resizeObserver.observe(container);

    relayout();

    return () => {
      resizeObserver.disconnect();
    };
  }, [map]);

  return null;
}

function MapFocus({ selectedFeature, selectedLocation }) {
  const map = useMap();

  useEffect(() => {
    // The App's selectedLocation is the one selection every map follows; the feature is only a fallback.
    const source = selectedLocation ?? selectedFeature;

    if (!source) {
      return;
    }

    const position = pointPosition(source);

    if (!validPosition(position)) {
      return;
    }

    // A point picked on this map keeps this map's camera; a point picked elsewhere (ArcGIS, 3D, search) is
    // centered. Never zoom out to show it.
    if (OWN_PICK.get(map) === pickKey(position[0], position[1])) return;
    const zoomFor = () => Math.max(map.getZoom(), FOCUS_ZOOM);
    const jump = () => map.setView(position, zoomFor(), { animate: false });
    // A hidden map (phone USGS / 3D view, collapsed panel) has zero size: an animated fly-to divides by zero
    // and throws "Invalid LatLng (NaN, NaN)". Jump without animation now, and center again once it is shown.
    if (isHidden(map)) {
      jump();
      PENDING_VIEW.set(map, jump);
      return;
    }
    PENDING_VIEW.delete(map);
    refreshSize(map);
    FLYING.add(map);
    map.once("zoomend", () => FLYING.delete(map));
    try {
      map.flyTo(position, zoomFor(), { duration: 0.8 });
    } catch {
      FLYING.delete(map);
      jump();
    }
  }, [selectedFeature, selectedLocation, map]);

  // Current center ("lat,lon" in degrees, east 0-360) and zoom for the device tests.
  useEffect(() => {
    const mark = () => {
      const c = map.getCenter();
      const el = map.getContainer();
      el.dataset.center = `${c.lat.toFixed(4)},${(((c.lng % 360) + 360) % 360).toFixed(4)}`;
      el.dataset.zoom = String(map.getZoom());
    };
    mark();
    map.on("moveend", mark);
    return () => map.off("moveend", mark);
  }, [map]);

  return null;
}

function MapClickCapture({ enabled, interactive, onRoutePoint, onCoordinateSelect, setDraftLocation }) {
  const map = useMapEvents({
    click(event) {
      if (!interactive || !enabled) {
        return;
      }

      const point = {
        lat: event.latlng.lat,

        lng: normaliseLongitude(event.latlng.lng),
      };

      setDraftLocation?.(point);

      if (onCoordinateSelect) {
        OWN_PICK.set(map, pickKey(point.lat, point.lng));
        onCoordinateSelect(point);
      }

      if (onRoutePoint) {
        onRoutePoint({
          latitude_deg: point.lat,

          longitude_deg: point.lng,
        });
      }
    },
  });

  return null;
}

function RoutePointMarker({ point, label, color }) {
  if (!point) {
    return null;
  }

  const position = pointPosition(point);

  if (!validPosition(position)) {
    return null;
  }

  return (
    <CircleMarker
      center={position}
      radius={7}
      pathOptions={{
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      }}
    >
      <Tooltip direction="top" offset={[0, -7]}>
        <strong>{label}</strong>
        <br />
        {Number(point.latitude_deg ?? point.lat).toFixed(4)}
        °, {normaliseLongitude(point.longitude_deg ?? point.lng).toFixed(4)}
        °E
      </Tooltip>
    </CircleMarker>
  );
}

function RouteWaypoints({ routePoints }) {
  if (!Array.isArray(routePoints) || !routePoints.length) {
    return null;
  }

  return (
    <>
      {routePoints.map((point, index) => {
        const isStart = index === 0;

        const isEnd = index === routePoints.length - 1;

        const color = isStart ? "#62f59a" : isEnd ? "#ff647c" : "#01ffff";

        return (
          <RoutePointMarker
            key={`${point.latitude_deg}:${point.longitude_deg}:${index}`}
            point={point}
            label={isStart ? "ROUTE START" : isEnd ? "DESTINATION" : `WAYPOINT P${index}`}
            color={color}
          />
        );
      })}
    </>
  );
}

function CustomPlacesLayer({ places, safeHavens, routeMode, interactive, onRoutePoint, onUserPlaceSelect, onSafeHavenSelect }) {
  const savedPlaces = Array.isArray(places) ? places : [];

  const havens = Array.isArray(safeHavens) ? safeHavens : [];

  return (
    <>
      {savedPlaces.map((place) => {
        const lat = Number(place.latitude_deg ?? place.lat);

        const lng = normaliseLongitude(place.longitude_deg ?? place.lng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }

        return (
          <CircleMarker
            key={place.id}
            center={[lat, lng]}
            radius={6}
            pathOptions={{
              color: "var(--nn-cyan)",
              fillColor: "#01ffff",
              fillOpacity: 0.95,
              weight: 2,
            }}
            eventHandlers={{
              click: (event) => {
                event.originalEvent?.stopPropagation?.();

                if (!interactive) {
                  return;
                }

                if (routeMode) {
                  onRoutePoint?.({
                    latitude_deg: lat,

                    longitude_deg: lng,

                    label: place.name,
                  });

                  return;
                }

                onUserPlaceSelect?.(place);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <strong>{place.name}</strong>
              <br />
              USER CREATED PLACE
            </Tooltip>
          </CircleMarker>
        );
      })}

      {havens.map((haven) => {
        const lat = Number(haven.latitude_deg ?? haven.lat);

        const lng = normaliseLongitude(haven.longitude_deg ?? haven.lng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }

        return (
          <CircleMarker
            key={haven.id}
            center={[lat, lng]}
            radius={7}
            pathOptions={{
              color: "#9dffbe",
              fillColor: "#9dffbe",
              fillOpacity: 0.92,
              weight: 2,
            }}
            eventHandlers={{
              click: (event) => {
                event.originalEvent?.stopPropagation?.();

                if (!interactive) {
                  return;
                }

                if (routeMode) {
                  onRoutePoint?.({
                    latitude_deg: lat,

                    longitude_deg: lng,

                    label: haven.name,
                  });

                  return;
                }

                onSafeHavenSelect?.(haven);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <strong>{haven.name}</strong>
              <br />
              SAFE HAVEN
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

function CoordinateCreator({ draftLocation, setDraftLocation, onCreateUserPlace, onCreateSafeHaven }) {
  const [name, setName] = useState("");

  const [havenName, setHavenName] = useState("");

  useEffect(() => {
    if (!draftLocation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears derived UI state when its input empties; no cascade
      setName("");
      setHavenName("");
    }
  }, [draftLocation]);

  const latitude = Number(draftLocation?.lat ?? draftLocation?.latitude_deg);

  const longitude = normaliseLongitude(draftLocation?.lng ?? draftLocation?.longitude_deg);

  // Stable props: a new array/object each render made Leaflet re-place and auto-pan the popup, which moved the
  // map, re-rendered the map layers and re-opened the popup: the visible shaking loop.
  const position = useMemo(() => [latitude, longitude], [latitude, longitude]);
  const popupHandlers = useMemo(() => ({ remove: () => setDraftLocation?.(null) }), [setDraftLocation]);

  if (!draftLocation) {
    return null;
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  function createPlace() {
    const trimmed = name.trim();

    if (!trimmed) {
      return;
    }

    onCreateUserPlace?.({
      latitude_deg: latitude,

      longitude_deg: longitude,

      lat: latitude,

      lng: longitude,

      name: trimmed,
    });

    setDraftLocation?.(null);
  }

  function createSafeHaven() {
    const trimmed = havenName.trim();

    onCreateSafeHaven?.({
      latitude_deg: latitude,

      longitude_deg: longitude,

      lat: latitude,

      lng: longitude,

      name: trimmed,
    });

    setDraftLocation?.(null);
  }

  return (
    <Popup position={position} closeOnClick={false} autoPan={false} eventHandlers={popupHandlers}>
      <div className="nn-map-create-popup">
        <strong>LOCATION SELECTED</strong>

        <span>
          {latitude.toFixed(5)}
          {" / "}
          {longitude.toFixed(5)}
        </span>

        <label>
          USER PLACE
          <input type="text" maxLength={48} value={name} placeholder="Name this place" onChange={(event) => setName(event.target.value)} />
        </label>

        <button type="button" disabled={!name.trim()} onClick={createPlace}>
          SAVE PLACE
        </button>

        <label>
          SAFE HAVEN
          <input type="text" maxLength={48} value={havenName} placeholder="Optional name" onChange={(event) => setHavenName(event.target.value)} />
        </label>

        <button type="button" onClick={createSafeHaven}>
          ADD SAFE HAVEN
        </button>
      </div>
    </Popup>
  );
}

/* Frame every compared route once the comparison map has its real size. */
function FitComparisonRoutes({ routes }) {
  const map = useMap();
  const key = (routes ?? []).map((route) => route.id ?? route.name).join("|");

  useEffect(() => {
    const points = (routes ?? []).flatMap((route) => routeCoordinates(route));
    if (points.length < 2) return undefined;
    // whenVisible re-lays out first, and waits for a size when the comparison map is hidden (zero size).
    const timer = window.setTimeout(() => {
      whenVisible(map, () => map.fitBounds(points, { padding: [40, 40], maxZoom: 9 }));
    }, 80);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return null;
}

function ComparisonRoutesLayer({ routes }) {
  if (!Array.isArray(routes) || !routes.length) {
    return null;
  }

  return (
    <>
      {routes.map((route, routeIndex) => {
        const colour = route.colour ?? COMPARISON_COLOURS[routeIndex % COMPARISON_COLOURS.length];

        const coordinates = routeCoordinates(route);

        if (coordinates.length < 2) {
          return null;
        }

        return (
          <Polyline
            key={route.id ?? `comparison-${routeIndex}`}
            positions={coordinates}
            pathOptions={{
              color: colour,

              weight: 5,

              opacity: 0.92,

              lineCap: "round",

              lineJoin: "round",
            }}
          >
            <Tooltip sticky>
              <strong>{route.name ?? `ROUTE ${routeIndex + 1}`}</strong>
              <br />
              {coordinates.length} plotted points
            </Tooltip>
          </Polyline>
        );
      })}

      {routes.map((route, routeIndex) => {
        const colour = route.colour ?? COMPARISON_COLOURS[routeIndex % COMPARISON_COLOURS.length];

        const points = route.points ?? [];

        return (
          <RouteWaypoints
            key={`${route.id ?? routeIndex}-markers`}
            routePoints={points.map((point) => ({
              ...point,

              comparisonColour: colour,
            }))}
          />
        );
      })}
    </>
  );
}

function ComparisonLegend({ routes }) {
  if (!Array.isArray(routes) || !routes.length) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",

        zIndex: 1200,

        top: "10px",

        left: "10px",

        minWidth: "190px",

        padding: "9px 10px",

        border: "1px solid rgba(1,255,255,0.2)",

        background: "rgba(6,12,16,0.88)",

        backdropFilter: "blur(12px)",

        WebkitBackdropFilter: "blur(12px)",

        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          marginBottom: "7px",

          color: "var(--nn-cyan)",

          fontFamily: "var(--nn-font)",

          fontSize: "12px",

          letterSpacing: "0.06em",
        }}
      >
        ROUTE COMPARISON
      </div>

      <div
        style={{
          display: "grid",

          gap: "6px",
        }}
      >
        {routes.map((route, index) => {
          const colour = route.colour ?? COMPARISON_COLOURS[index % COMPARISON_COLOURS.length];

          return (
            <div
              key={route.id ?? index}
              style={{
                display: "flex",

                alignItems: "center",

                gap: "7px",

                minWidth: 0,

                color: "#b4c5ca",

                fontFamily: "var(--nn-font)",

                fontSize: "12px",
              }}
            >
              <span
                style={{
                  flex: "0 0 auto",

                  width: "18px",

                  height: "3px",

                  background: colour,

                  boxShadow: `0 0 8px ${colour}`,
                }}
              />

              <span
                style={{
                  whiteSpace: "normal",

                  overflowWrap: "anywhere",
                }}
              >
                {route.name ?? `ROUTE ${index + 1}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/*
 * AI ROUTE CANDIDATES
 *
 * Every generated candidate stays visible at once. The selected candidate is
 * drawn thicker and above the others so it is unmistakable, and each polyline
 * uses the same colour as its card in the AI Route Design workspace.
 */
function CandidateRoutesLayer({ candidates = [], selectedId = null, onSelect }) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }

  const ordered = [...candidates].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));

  return (
    <>
      {ordered.map((candidate) => {
        /* Long traverses carry the full terrain-aware path separately from the
           <=32 editor waypoints; draw the full path when it is present. */
        const positions = (candidate.path_coordinates ?? candidate.coordinates ?? []).map((point) => [
          Number(point.latitude_deg),
          normaliseLongitude(point.longitude_deg),
        ]);

        if (positions.length < 2) {
          return null;
        }

        const selected = candidate.id === selectedId;

        return (
          <Polyline
            key={candidate.id}
            positions={positions}
            pathOptions={{
              color: candidate.colour ?? "#01ffff",
              weight: selected ? 5 : 2.4,
              opacity: selected ? 1 : 0.55,
              dashArray: selected ? undefined : "6 5",
              lineCap: "round",
              lineJoin: "round",
            }}
            eventHandlers={{
              click: (event) => {
                event.originalEvent?.stopPropagation?.();
                onSelect?.(candidate.id);
              },
            }}
          >
            <Tooltip sticky>
              <strong>{candidate.name}</strong>
              <br />
              {candidate.metrics?.distance_km == null ? "UNAVAILABLE" : `${Number(candidate.metrics.distance_km).toFixed(2)} km`}
              {" · "}
              {candidate.metrics?.estimated_eva_hours == null ? "UNAVAILABLE" : `${Number(candidate.metrics.estimated_eva_hours).toFixed(2)} h EVA`}
              <br />
              {candidate.pareto_label ?? ""}
            </Tooltip>
          </Polyline>
        );
      })}

      {ordered
        .filter((candidate) => candidate.id === selectedId)
        .map((candidate) =>
          (candidate.coordinates ?? []).map((point, index) => (
            <CircleMarker
              key={`${candidate.id}-${index}`}
              center={[Number(point.latitude_deg), normaliseLongitude(point.longitude_deg)]}
              radius={index === 0 || index === candidate.coordinates.length - 1 ? 5 : 3}
              pathOptions={{
                color: "#04080b",
                weight: 1,
                fillColor: index === 0 ? "#62f59a" : index === candidate.coordinates.length - 1 ? "#ff647c" : (candidate.colour ?? "#01ffff"),
                fillOpacity: 1,
              }}
            />
          )),
        )}
    </>
  );
}

/*
 * Active selection marker: a cyan ring with a center dot and a soft glow at the App's selectedLocation (named
 * feature or bare coordinate). A divIcon in the marker pane, so it is drawn above the canvas feature dots and
 * routes at every zoom; non-interactive, so clicks and taps reach the map and the features below it.
 */
const SELECTION_ICON = divIcon({
  className: "nn-select-marker",
  html:
    '<span class="nn-select-marker__body" data-testid="map-selection-marker" aria-hidden="true">' +
    '<span class="nn-select-marker__pulse"></span><span class="nn-select-marker__ring"></span><span class="nn-select-marker__dot"></span>' +
    "</span>",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function SelectionMarker({ selectedLocation, selectedFeature }) {
  const source = selectedLocation ?? selectedFeature;
  const position = source ? pointPosition(source) : null;
  const ok = validPosition(position);
  const lat = ok ? position[0] : null;
  const lon = ok ? position[1] : null;
  const at = useMemo(() => [lat, lon], [lat, lon]);

  if (!ok) {
    return null;
  }

  return <Marker position={at} icon={SELECTION_ICON} interactive={false} keyboard={false} zIndexOffset={1000} />;
}

/* Reports the visible bounds so canvas markers outside the view are not drawn (Browser Optimization). */
function ViewportTracker({ onBounds }) {
  const map = useMap();
  useMapEvents({ moveend: () => onBounds(map.getBounds().pad(0.2)), zoomend: () => onBounds(map.getBounds().pad(0.2)) });
  return null;
}

export default function MarsMap({
  features = [],
  showBasemap = true,
  showFeatures = true,
  children = null,

  selectedFeature = null,

  selectedLocation = null,

  customPlaces = [],

  savedPlaces = [],

  safeHavens = [],

  onSelect,

  onUserPlaceSelect,

  onSafeHavenSelect,

  onCreateUserPlace,

  onCreateSafeHaven,

  routeMode = false,

  routePoints = [],

  routeStart = null,

  routeEnd = null,

  routePlan = null,

  route = null,

  onMapLocationSelect,

  onMapCoordinateSelect,

  comparisonRoutes = [],

  comparisonMode = false,

  candidateRoutes = [],

  selectedCandidateId = null,

  onSelectCandidate,

  interactive = true,
}) {
  const [draftLocation, setDraftLocation] = useState(null);
  const [viewBounds, setViewBounds] = useState(null);
  const culling = perfStore.enabled("canvasCulling");
  // Selected feature always stays drawn; others only inside the (padded) viewport when culling is on.
  const indexed = features.map((f, i) => [f, i]); // keep each feature's own index so keys stay stable
  const culledFeatures =
    culling && viewBounds ? indexed.filter(([f]) => f === selectedFeature || viewBounds.contains(marsPosition(f))) : indexed;

  const places = customPlaces.length ? customPlaces : savedPlaces;

  const plannedRouteCoordinates =
    routePlan?.planned_route?.coordinates ?? routePlan?.route?.coordinates ?? route?.planned_route?.coordinates ?? route?.route?.coordinates ?? [];

  const liveRouteCoordinates = routePoints.map((point) => [Number(point.latitude_deg), normaliseLongitude(point.longitude_deg)]);

  const hasPlannedRoute = Array.isArray(plannedRouteCoordinates) && plannedRouteCoordinates.length > 1;

  const routeToDisplay = hasPlannedRoute ? plannedRouteCoordinates : liveRouteCoordinates;

  function handleCoordinateSelect(point) {
    setDraftLocation(point);

    /*
     * Preferred API for exact-coordinate science.
     */
    if (onMapCoordinateSelect) {
      onMapCoordinateSelect(point);

      return;
    }

    /*
     * Backwards-compatible API:
     * App can make the route/coordinate decision itself.
     */
    if (onMapLocationSelect) {
      onMapLocationSelect({
        latitude_deg: point.lat,

        longitude_deg: point.lng,
      });
    }
  }

  function handleRoutePoint(point) {
    setDraftLocation(null);

    onMapLocationSelect?.({
      latitude_deg: point.latitude_deg,

      longitude_deg: point.longitude_deg,

      label: point.label ?? null,
    });
  }

  const effectiveStart = routeStart ?? routePoints[0] ?? null;

  const effectiveEnd = routeEnd ?? (routePoints.length ? routePoints[routePoints.length - 1] : null);

  const effectiveInteractive = Boolean(interactive);

  return (
    <div
      style={{
        position: "relative",

        width: "100%",

        height: "100%",
      }}
    >
      <MapContainer
        center={[0, 180]}
        zoom={0}
        minZoom={0}
        maxZoom={7}
        crs={MARS_CRS}
        maxBounds={MARS_BOUNDS}
        maxBoundsViscosity={1}
        zoomSnap={SMOOTH_ZOOM.zoomSnap}
        zoomDelta={SMOOTH_ZOOM.zoomDelta}
        wheelPxPerZoomLevel={SMOOTH_ZOOM.wheelPxPerZoomLevel}
        wheelDebounceTime={SMOOTH_ZOOM.wheelDebounceTime}
        scrollWheelZoom={effectiveInteractive}
        zoomControl={effectiveInteractive}
        doubleClickZoom={effectiveInteractive}
        dragging={effectiveInteractive}
        touchZoom={effectiveInteractive}
        boxZoom={effectiveInteractive}
        keyboard={effectiveInteractive}
        preferCanvas
        style={{
          width: "100%",

          height: "100%",

          background: "#090c0f",
        }}
      >
        <MapResizeHandler />

        {showBasemap && <ImageOverlay url="/mars-mola-global.jpg" bounds={MARS_BOUNDS} opacity={1} />}

        {children}

        <MapFocus selectedFeature={selectedFeature} selectedLocation={selectedLocation} />

        {!comparisonMode && (
          <MapClickCapture
            enabled={true}
            interactive={effectiveInteractive}
            onRoutePoint={routeMode ? handleRoutePoint : null}
            onCoordinateSelect={routeMode ? null : handleCoordinateSelect}
            setDraftLocation={setDraftLocation}
          />
        )}

        {!comparisonMode && routeToDisplay.length > 1 && (
          <Polyline
            positions={routeToDisplay}
            pathOptions={{
              color: "var(--nn-cyan)",

              weight: 4,

              opacity: 0.95,

              lineCap: "round",

              lineJoin: "round",
            }}
          />
        )}

        {!comparisonMode && <CandidateRoutesLayer candidates={candidateRoutes} selectedId={selectedCandidateId} onSelect={onSelectCandidate} />}

        {!comparisonMode && <RouteWaypoints routePoints={routePoints} />}

        {!comparisonMode && effectiveStart && routePoints.length === 0 && (
          <RoutePointMarker point={effectiveStart} label="ROUTE START" color="#62f59a" />
        )}

        {!comparisonMode && effectiveEnd && routePoints.length === 0 && <RoutePointMarker point={effectiveEnd} label="DESTINATION" color="#ff647c" />}

        {comparisonMode && <ComparisonRoutesLayer routes={comparisonRoutes} />}

        {comparisonMode && <FitComparisonRoutes routes={comparisonRoutes} />}

        {effectiveInteractive && !comparisonMode && (
          <CustomPlacesLayer
            places={places}
            safeHavens={safeHavens}
            routeMode={routeMode}
            interactive={effectiveInteractive}
            onRoutePoint={handleRoutePoint}
            onUserPlaceSelect={onUserPlaceSelect}
            onSafeHavenSelect={onSafeHavenSelect}
          />
        )}

        <ViewportTracker onBounds={setViewBounds} />

        {showFeatures && culledFeatures.map(([feature, featureIndex]) => {
          const position = marsPosition(feature);

          if (!validPosition(position)) {
            return null;
          }

          const featureName = String(feature.feature_name ?? "");

          const selected = Boolean(selectedFeature && String(selectedFeature.feature_name ?? "") === featureName);

          const markerColor = featureColor(feature.feature_type);

          return (
            <CircleMarker
              /* The gazetteer can contain two entries with the same name and
                 coordinate, so the index disambiguates without altering data. */
              key={[feature.feature_name, feature.latitude_deg, feature.longitude_deg, featureIndex].join(":")}
              center={position}
              radius={selected ? 5 : 2.2}
              pathOptions={{
                color: selected ? "#01ffff" : markerColor,

                weight: selected ? 2 : 0.7,

                opacity: selected ? 1 : 0.78,

                fillColor: markerColor,

                fillOpacity: selected ? 1 : 0.72,
              }}
              eventHandlers={{
                click: (event) => {
                  event.originalEvent?.stopPropagation?.();

                  if (!effectiveInteractive || comparisonMode) {
                    return;
                  }

                  setDraftLocation(null);

                  if (routeMode) {
                    handleRoutePoint({
                      latitude_deg: feature.latitude_deg,

                      longitude_deg: feature.longitude_deg,

                      label: feature.feature_name,
                    });

                    return;
                  }

                  onSelect?.(feature);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                <strong>{feature.feature_name}</strong>

                <br />

                {feature.feature_type}
              </Tooltip>
            </CircleMarker>
          );
        })}

        {!comparisonMode && <SelectionMarker selectedLocation={selectedLocation} selectedFeature={selectedFeature} />}

        {!comparisonMode && effectiveInteractive && !routeMode && (
          <CoordinateCreator
            draftLocation={draftLocation}
            setDraftLocation={setDraftLocation}
            onCreateUserPlace={onCreateUserPlace}
            onCreateSafeHaven={onCreateSafeHaven}
          />
        )}
      </MapContainer>

      {comparisonMode && <ComparisonLegend routes={comparisonRoutes} />}

      {!comparisonMode && routeMode && (
        <div
          style={{
            position: "absolute",

            zIndex: 1200,

            top: "10px",

            right: "10px",

            padding: "7px 9px",

            border: "1px solid rgba(1,255,255,0.23)",

            background: "rgba(7,13,17,0.88)",

            color: "var(--nn-cyan)",

            fontFamily: "var(--nn-font)",

            fontSize: "12px",

            letterSpacing: "0.06em",

            pointerEvents: "none",
          }}
        >
          ROUTE PLANNING ACTIVE
          <br />
          CLICK MAP TO ADD WAYPOINT
        </div>
      )}
    </div>
  );
}
