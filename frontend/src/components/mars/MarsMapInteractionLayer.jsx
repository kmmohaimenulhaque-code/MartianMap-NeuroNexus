import React, {
  useEffect,
  useState,
} from "react";

import {
  CircleMarker,
  Popup,
  useMapEvents,
} from "react-leaflet";

const PLACES_KEY =
  "neuronexus-user-places-v1";

const SAFE_HAVENS_KEY =
  "neuronexus-safe-havens-v1";

function load(key) {
  try {
    const raw =
      localStorage.getItem(key);

    return raw
      ? JSON.parse(raw)
      : [];
  } catch {
    return [];
  }
}

function normalizeLongitude(lng) {
  let value = Number(lng) % 360;

  if (value < 0) {
    value += 360;
  }

  return value;
}

function normalizePoint(point) {
  return {
    lat: Number(point.lat),
    lng: normalizeLongitude(
      Number(point.lng)
    ),
  };
}

export default function MarsMapInteractionLayer({
  routeMode = false,
  onRoutePoint,
  onCoordinateSelect,
  onPlacesChange,
  onSafeHavensChange,
}) {
  const [places, setPlaces] =
    useState(() => load(PLACES_KEY));

  const [safeHavens, setSafeHavens] =
    useState(() =>
      load(SAFE_HAVENS_KEY)
    );

  const [pending, setPending] =
    useState(null);

  const [placeName, setPlaceName] =
    useState("");

  const [safeHavenName, setSafeHavenName] =
    useState("");

  useEffect(() => {
    localStorage.setItem(
      PLACES_KEY,
      JSON.stringify(places)
    );

    onPlacesChange?.(places);
  }, [places, onPlacesChange]);

  useEffect(() => {
    localStorage.setItem(
      SAFE_HAVENS_KEY,
      JSON.stringify(safeHavens)
    );

    onSafeHavensChange?.(
      safeHavens
    );
  }, [
    safeHavens,
    onSafeHavensChange,
  ]);

  useMapEvents({
    click(event) {
      const point =
        normalizePoint({
          lat: event.latlng.lat,
          lng: event.latlng.lng,
        });

      onCoordinateSelect?.(point);

      if (routeMode) {
        onRoutePoint?.(event.latlng);
        return;
      }

      setPending(point);
      setPlaceName("");
      setSafeHavenName("");
    },
  });

  function createPlace() {
    const name =
      placeName.trim();

    if (!pending || !name) {
      return;
    }

    const next = [
      ...places,
      {
        id: `place-${Date.now()}`,
        name,
        lat: pending.lat,
        lng: pending.lng,
        type: "USER_PLACE",
        createdAt:
          new Date().toISOString(),
      },
    ];

    setPlaces(next);
    setPending(null);
    setPlaceName("");
  }

  function createSafeHaven() {
    if (!pending) {
      return;
    }

    const name =
      safeHavenName.trim() ||
      `SAFE HAVEN ${
        safeHavens.length + 1
      }`;

    const next = [
      ...safeHavens,
      {
        id: `safe-${Date.now()}`,
        name,
        lat: pending.lat,
        lng: pending.lng,
        type: "SAFE_HAVEN",
        createdAt:
          new Date().toISOString(),
      },
    ];

    setSafeHavens(next);
    setPending(null);
    setSafeHavenName("");
  }

  return (
    <>
      {places.map((place) => (
        <CircleMarker
          key={place.id}
          center={[
            place.lat,
            place.lng,
          ]}
          radius={6}
          pathOptions={{
            color: "#75e6ff",
            fillColor: "#75e6ff",
            fillOpacity: 0.95,
            weight: 2,
          }}
          eventHandlers={{
            click(event) {
              event.originalEvent?.stopPropagation?.();

              onCoordinateSelect?.({
                lat: place.lat,
                lng: place.lng,
              });
            },
          }}
        >
          <Popup>
            <strong>
              {place.name}
            </strong>

            <br />

            USER CREATED PLACE

            <br />

            {place.lat.toFixed(5)},
            {" "}
            {place.lng.toFixed(5)}
          </Popup>
        </CircleMarker>
      ))}

      {safeHavens.map((haven) => (
        <CircleMarker
          key={haven.id}
          center={[
            haven.lat,
            haven.lng,
          ]}
          radius={7}
          pathOptions={{
            color: "#b4ffcf",
            fillColor: "#b4ffcf",
            fillOpacity: 0.9,
            weight: 2,
          }}
          eventHandlers={{
            click(event) {
              event.originalEvent?.stopPropagation?.();

              onCoordinateSelect?.({
                lat: haven.lat,
                lng: haven.lng,
              });
            },
          }}
        >
          <Popup>
            <strong>
              {haven.name}
            </strong>

            <br />

            SAFE HAVEN

            <br />

            {haven.lat.toFixed(5)},
            {" "}
            {haven.lng.toFixed(5)}
          </Popup>
        </CircleMarker>
      ))}

      {pending && (
        <Popup
          position={[
            pending.lat,
            pending.lng,
          ]}
          eventHandlers={{
            remove() {
              setPending(null);
            },
          }}
        >
          <div className="nn-map-create-popup">
            <strong>
              LOCATION SELECTED
            </strong>

            <span>
              {pending.lat.toFixed(5)}
              {" "} / {" "}
              {pending.lng.toFixed(5)}
            </span>

            <label>
              USER PLACE
              <input
                type="text"
                value={placeName}
                maxLength={48}
                placeholder="Name this place"
                onChange={(event) =>
                  setPlaceName(
                    event.target.value
                  )
                }
              />
            </label>

            <button
              type="button"
              disabled={!placeName.trim()}
              onClick={createPlace}
            >
              SAVE PLACE
            </button>

            <label>
              SAFE HAVEN
              <input
                type="text"
                value={safeHavenName}
                maxLength={48}
                placeholder="Optional name"
                onChange={(event) =>
                  setSafeHavenName(
                    event.target.value
                  )
                }
              />
            </label>

            <button
              type="button"
              onClick={createSafeHaven}
            >
              ADD SAFE HAVEN
            </button>
          </div>
        </Popup>
      )}
    </>
  );
}
