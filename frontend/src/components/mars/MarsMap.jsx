import { useEffect, useState } from "react";

import { CircleMarker, ImageOverlay, MapContainer, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { CRS, Transformation } from "leaflet";

import "leaflet/dist/leaflet.css";

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

const COMPARISON_COLOURS = ["#75e6ff", "#ff9f68", "#8cf0b1", "#c99bff"];

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

function featureColor(featureType = "") {
  const type = String(featureType).split(",")[0].trim();

  const colors = {
    Crater: "#d9c2a5",
    Vallis: "#72d9ff",
    Mons: "#ff9f68",
    Fossa: "#9fe3a8",
    Mensa: "#e7d06f",
    Planum: "#c99bff",
    Patera: "#ff718d",
    Chaos: "#75e6ff",
    Rupes: "#ffbf69",
    Chasma: "#80aaff",
    Dorsum: "#c5a27b",
    Terra: "#f0c6a0",
    Planitia: "#9cc2b5",
  };

  return colors[type] ?? "#d5d9dc";
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({
        animate: false,
      });
    });

    resizeObserver.observe(container);

    map.invalidateSize({
      animate: false,
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [map]);

  return null;
}

function MapFocus({ selectedFeature, selectedLocation }) {
  const map = useMap();

  useEffect(() => {
    const source = selectedFeature ?? selectedLocation;

    if (!source) {
      return;
    }

    const position = pointPosition(source);

    if (!validPosition(position)) {
      return;
    }

    map.flyTo(position, 1.6, {
      duration: 0.8,
    });
  }, [selectedFeature, selectedLocation, map]);

  return null;
}

function MapClickCapture({ enabled, interactive, onRoutePoint, onCoordinateSelect, setDraftLocation }) {
  useMapEvents({
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

        const color = isStart ? "#62f59a" : isEnd ? "#ff647c" : "#75e6ff";

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
              color: "#75e6ff",
              fillColor: "#75e6ff",
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
      setName("");
      setHavenName("");
    }
  }, [draftLocation]);

  if (!draftLocation) {
    return null;
  }

  const latitude = Number(draftLocation.lat ?? draftLocation.latitude_deg);

  const longitude = normaliseLongitude(draftLocation.lng ?? draftLocation.longitude_deg);

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
    <Popup
      position={[latitude, longitude]}
      closeOnClick={false}
      eventHandlers={{
        remove: () => setDraftLocation?.(null),
      }}
    >
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

        border: "1px solid rgba(117,230,255,0.2)",

        background: "rgba(6,12,16,0.88)",

        backdropFilter: "blur(12px)",

        WebkitBackdropFilter: "blur(12px)",

        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          marginBottom: "7px",

          color: "#75e6ff",

          fontFamily: "monospace",

          fontSize: "8px",

          letterSpacing: "0.12em",
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

                fontFamily: "monospace",

                fontSize: "9px",
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
                  overflow: "hidden",

                  textOverflow: "ellipsis",

                  whiteSpace: "nowrap",
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
              color: candidate.colour ?? "#75e6ff",
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
                fillColor: index === 0 ? "#62f59a" : index === candidate.coordinates.length - 1 ? "#ff647c" : (candidate.colour ?? "#75e6ff"),
                fillOpacity: 1,
              }}
            />
          )),
        )}
    </>
  );
}

export default function MarsMap({
  features = [],

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

        <ImageOverlay url="/mars-mola-global.jpg" bounds={MARS_BOUNDS} opacity={1} />

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
              color: "#75e6ff",

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

        {features.map((feature, featureIndex) => {
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
                color: selected ? "#75e6ff" : markerColor,

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

            border: "1px solid rgba(117,230,255,0.23)",

            background: "rgba(7,13,17,0.88)",

            color: "#75e6ff",

            fontFamily: "monospace",

            fontSize: "8px",

            letterSpacing: "0.09em",

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
