/*
 * SiteMap: Leaflet in a local metric frame (CRS.Simple, 1 unit = 1 m, y = north) centered on the
 * planning frame. Overlays are server-rendered PNGs of the terrain ladder; vectors use token colors.
 */

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { CRS, divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";

import { perfStore } from "../perf/perfStore";
import { cachedObjectUrl } from "../perf/tileCache";
import { marswalkApi } from "./marswalkApi";
import { sampleGrid, toLatLon, toLocal } from "./marswalkMath";
import { CLASS_TOKENS, cssVar, SOURCE_TOKENS } from "./walkabilityRamp";

const CLASS_BY_CODE = ["UNAVAILABLE", "WITHIN PLANNING LIMITS", "REVIEW REQUIRED", "EXCEEDS PLANNING LIMIT"];
const SOURCE_BY_CODE = ["NONE", "HIRISE", "CTX", "MOLA"];

/*
 * Zoomed in past the 2 m frame, re-fetch the visible area at the native 1 m HiRISE grid (sharp, not
 * upscaled). The sub-window has its own center; at <= 700 m half-width the frame offset error is negligible.
 */
function DetailOverlays({ frame, mode, overlays }) {
  const map = useMap();
  const [win, setWin] = useState(null);
  useMapEvents({
    moveend() {
      const b = map.getBounds();
      const half = Math.max(b.getEast() - b.getWest(), b.getNorth() - b.getSouth()) / 2;
      if (mode === "mola" || half > 700) return setWin(null);
      const c = b.getCenter();
      const h = Math.ceil(Math.min(700, half * 1.15) / 50) * 50;
      const x = Math.round(c.lng / 25) * 25;
      const y = Math.round(c.lat / 25) * 25;
      const [lat, lon] = toLatLon(x, y, frame);
      setWin({ x, y, h, frame: { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, halfWidth: h, res: 1 } });
    },
  });
  if (!win) return null;
  const bounds = [[win.y - win.h, win.x - win.h], [win.y + win.h, win.x + win.h]];
  const url = (layer) => marswalkApi.imageUrl(win.frame, mode, layer, Math.min(1400, 2 * win.h));
  return (
    <>
      {overlays.hillshade && <ImageOverlay url={url("hillshade")} bounds={bounds} opacity={1} />}
      {overlays.ortho && <ImageOverlay url={url("ortho")} bounds={bounds} opacity={0.92} />}
      {overlays.walkability && <ImageOverlay url={url("walkability")} bounds={bounds} opacity={0.9} className="mw-blend" />}
      {overlays.slope && <ImageOverlay url={url("slope")} bounds={bounds} opacity={0.9} className="mw-blend" />}
    </>
  );
}

const COARSE_POINTER = typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);

function pinIcon(kind, label) {
  return divIcon({ className: `mw-pin mw-pin--${kind}`, html: `<span>${label}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
}

function ClickAndCursor({ frame, onClick, onCursor }) {
  useMapEvents({
    click(event) {
      const [lat, lon] = toLatLon(event.latlng.lng, event.latlng.lat, frame);
      onCursor?.({ x: event.latlng.lng, y: event.latlng.lat }); // touch has no hover: a tap fills the readout too
      onClick?.({ lat, lon, x: event.latlng.lng, y: event.latlng.lat });
    },
    mousemove(event) {
      onCursor?.({ x: event.latlng.lng, y: event.latlng.lat });
    },
    mouseout() {
      onCursor?.(null);
    },
  });
  return null;
}

function ScaleBar() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const pxPerM = 2 ** zoom;
  const target = 120 / pxPerM;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((m) => m >= target * 0.6) ?? 5000;
  return (
    <div className="mw-scale" aria-label={`Scale bar ${nice} meters`}>
      <span style={{ width: `${nice * pxPerM}px` }} />
      {nice >= 1000 ? `${nice / 1000} km` : `${nice} m`}
      <b className="mw-north" aria-label="North is up">N ↑</b>
    </div>
  );
}

/* Overlay PNGs go through the IndexedDB tile cache and are pre-decoded with createImageBitmap. */
function CachedOverlay({ url, bounds, opacity, className }) {
  const enabled = perfStore.enabled("tileCache");
  const [state, setState] = useState({ url: null, src: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let objectUrl = null;
    let cancelled = false;
    cachedObjectUrl(url)
      .then((src) => {
        if (cancelled) {
          if (src.startsWith("blob:")) URL.revokeObjectURL(src);
          return;
        }
        objectUrl = src;
        setState({ url, src });
      })
      .catch(() => !cancelled && setState({ url, src: url }));
    return () => {
      cancelled = true;
      if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [url, enabled]);
  const src = enabled ? (state.url === url ? state.src : null) : url;
  return src ? <ImageOverlay url={src} bounds={bounds} opacity={opacity} className={className} /> : null;
}

function FitFrame({ extent }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds([[-extent, -extent], [extent, extent]], { animate: false });
  }, [map, extent]);
  return null;
}

export default function SiteMap({ frame, mode, overlays, plan, estimate, editPts, onMapClick, onDragPoint, hoverIndex, rovers, grids, groundTruth, roverSolLimit = null }) {
  const [cursor, setCursor] = useState(null);
  const extent = frame.halfWidth;
  const colors = useMemo(() => {
    const out = {};
    for (const [k, token] of Object.entries(CLASS_TOKENS)) out[k] = cssVar(token) || "#888";
    for (const [k, token] of Object.entries(SOURCE_TOKENS)) out[`src_${k}`] = cssVar(token) || "#888";
    out.msl = cssVar("--nn-rover-msl") || "#888";
    out.m2020 = cssVar("--nn-rover-m2020") || "#888";
    out.cyan = cssVar("--nn-cyan") || "#888";
    return out;
  }, []);

  const routeRuns = useMemo(() => {
    const p = plan?.profile;
    if (!p?.lat?.length) return [];
    const runs = [];
    let current = null;
    for (let i = 0; i < p.lat.length; i += 1) {
      if (p.lat[i] == null) continue;
      const pt = toLocal(p.lat[i], p.lon[i], frame).reverse();
      const cls = CLASS_BY_CODE[p.class[i]] ?? "UNAVAILABLE";
      if (!current || current.cls !== cls) {
        if (current) current.pts.push(pt);
        current = { cls, pts: current ? [current.pts[current.pts.length - 1], pt] : [pt] };
        runs.push(current);
      } else {
        current.pts.push(pt);
      }
    }
    return runs;
  }, [plan, frame]);

  const hoverPt = useMemo(() => {
    const p = plan?.profile;
    if (hoverIndex == null || !p?.lat?.[hoverIndex]) return null;
    return toLocal(p.lat[hoverIndex], p.lon[hoverIndex], frame).reverse();
  }, [plan, hoverIndex, frame]);

  const readout = useMemo(() => {
    if (!cursor) return null;
    const [lat, lon] = toLatLon(cursor.x, cursor.y, frame);
    const elev = grids?.elevation ? sampleGrid(grids.elevation, cursor.x, cursor.y) : NaN;
    const slope = grids?.slope_3m ? sampleGrid(grids.slope_3m, cursor.x, cursor.y, true) : NaN;
    const src = grids?.source ? SOURCE_BY_CODE[sampleGrid(grids.source, cursor.x, cursor.y, true)] ?? "NONE" : "NONE";
    return { lat, lon, elev, slope, src };
  }, [cursor, grids, frame]);

  const gsd = { HIRISE: "1.0 m", CTX: "20 m", MOLA: "463 m", NONE: "n/a" };
  const layerUrl = (layer) => marswalkApi.imageUrl(frame, mode, layer, Math.min(2048, Math.round((2 * frame.halfWidth) / frame.res)));
  const bounds = [[-extent, -extent], [extent, extent]];
  const editLine = editPts?.length > 1 ? editPts.map((p) => toLocal(p.lat, p.lon, frame).reverse()) : null;

  return (
    <div className="mw-sitemap">
      <MapContainer crs={CRS.Simple} minZoom={-4} maxZoom={3} zoomSnap={0.25} preferCanvas attributionControl={false} className="mw-leaflet" bounds={bounds}>
        <FitFrame extent={extent} />
        {overlays.hillshade && <CachedOverlay url={layerUrl("hillshade")} bounds={bounds} opacity={1} />}
        {overlays.ortho && <CachedOverlay url={layerUrl("ortho")} bounds={bounds} opacity={0.92} />}
        {overlays.walkability && <CachedOverlay url={layerUrl("walkability")} bounds={bounds} opacity={0.9} className="mw-blend" />}
        {overlays.slope && <CachedOverlay url={layerUrl("slope")} bounds={bounds} opacity={0.9} className="mw-blend" />}
        {overlays.source && <CachedOverlay url={layerUrl("source")} bounds={bounds} opacity={0.55} />}
        <DetailOverlays frame={frame} mode={mode} overlays={overlays} />
        <Pane name="rovers" style={{ zIndex: 420 }}>
          {groundTruth &&
            rovers.map((rover) =>
              rover.traverse ? (
                <Polyline key={`t-${rover.id}`} positions={rover.traverse.map(([lon, lat]) => toLocal(lat, lon, frame).reverse())} pathOptions={{ color: colors[rover.id], weight: 2, opacity: 0.9 }}>
                  <Tooltip sticky>{rover.name} traverse · NASA MMGIS</Tooltip>
                </Polyline>
              ) : null,
            )}
          {groundTruth &&
            rovers.flatMap((rover) =>
              (rover.waypoints ?? []).map((w) => {
                const [x, y] = toLocal(w.lat, w.lon, frame);
                if (Math.abs(x) > extent || Math.abs(y) > extent) return null;
                return (
                  <CircleMarker
                    key={`w-${rover.id}-${w.RMC}`}
                    center={[y, x]}
                    radius={2 + (w.tilt ?? 0) / 5}
                    pathOptions={{ color: colors[rover.id], weight: 1, fillOpacity: roverSolLimit != null && w.sol > roverSolLimit ? 0.12 : 0.55, opacity: roverSolLimit != null && w.sol > roverSolLimit ? 0.3 : 1 }}
                  >
                    <Tooltip>{`${rover.name} sol ${w.sol} · tilt ${w.tilt?.toFixed(1) ?? "n/a"}° (rover IMU)${roverSolLimit != null && w.sol > roverSolLimit ? " · after the active sol" : ""}`}</Tooltip>
                  </CircleMarker>
                );
              }),
            )}
        </Pane>
        <Pane name="route" style={{ zIndex: 450 }}>
          {routeRuns.map((run, i) => (
            <Polyline
              key={`r-${i}`}
              positions={run.pts}
              pathOptions={{ color: colors[run.cls], weight: 4, opacity: 0.95, dashArray: run.cls === "EXCEEDS PLANNING LIMIT" ? "6 5" : undefined }}
            />
          ))}
          {editLine && <Polyline positions={editLine} pathOptions={{ color: colors.cyan, weight: 2, dashArray: "4 4", opacity: 0.9 }} />}
          {estimate?.pts && <Polyline positions={estimate.pts.map(([x, y]) => [y, x])} pathOptions={{ color: colors.cyan, weight: 1, opacity: 0.6 }} />}
          {plan?.turnaround && !plan.turnaround.reached_target && (
            <CircleMarker center={toLocal(plan.turnaround.lat, plan.turnaround.lon, frame).reverse()} radius={7} pathOptions={{ color: colors["EXCEEDS PLANNING LIMIT"], weight: 3, fillOpacity: 0.2 }}>
              <Tooltip permanent direction="top">PNR · turn back here</Tooltip>
            </CircleMarker>
          )}
          {hoverPt && <CircleMarker center={hoverPt} radius={5} pathOptions={{ color: colors.cyan, weight: 2, fillOpacity: 0.8 }} />}
          {(editPts ?? []).map((p, i) => (
            <Marker
              key={`p-${i}`}
              position={toLocal(p.lat, p.lon, frame).reverse()}
              icon={pinIcon(i === 0 ? "base" : "target", i === 0 ? "B" : String(i))}
              draggable={i > 0}
              keyboard
              title={i === 0 ? p.label ?? "Base" : `Point ${i}`}
              eventHandlers={{
                dragend: (event) => {
                  const ll = event.target.getLatLng();
                  const [lat, lon] = toLatLon(ll.lng, ll.lat, frame);
                  onDragPoint?.(i, { lat, lon });
                },
              }}
            />
          ))}
        </Pane>
        <ClickAndCursor frame={frame} onClick={onMapClick} onCursor={setCursor} />
        <ScaleBar />
      </MapContainer>
      <div className="mw-readout" aria-live="polite">
        {readout
          ? `${readout.lat.toFixed(5)}°, ${readout.lon.toFixed(5)}°E · ${Number.isFinite(readout.elev) ? `${readout.elev.toFixed(1)} m` : "elev n/a"} (${readout.src}, ${gsd[readout.src]}) · slope@3 m ${Number.isFinite(readout.slope) ? `${readout.slope.toFixed(1)}°` : "n/a"}`
          : COARSE_POINTER
            ? "Tap the map to set the target · lat, lon · elevation · slope@3 m"
            : "Move over the map for lat, lon · elevation (source, gsd) · slope@3 m · click to set the target"}
      </div>
    </div>
  );
}
