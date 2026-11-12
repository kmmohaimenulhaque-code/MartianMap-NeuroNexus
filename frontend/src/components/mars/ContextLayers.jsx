/*
 * Context layers drawn inside the global 2D map (MarsMap, canvas renderer): rover traverses, waypoints
 * sized by IMU tilt (culled to the viewport), HiRISE DTM footprint boxes, landing sites and the
 * modeled MY34 dust optical depth. Colors come from tokens.css.
 *
 * Rover labels: CURIOSITY @ SOL n is Curiosity at the MY34 scenario sol; PERSEVERANCE @ SOL n is Perseverance at
 * its latest NASA MMGIS localization (it landed in MY36, so it has no MY34 position). Rover and landing-site
 * name labels are decluttered in screen space after every move or zoom: a label that would collide is left off
 * and its marker keeps a hover tooltip.
 */

import { useLayers } from "../layers/layerStore";
import { dustImage, gridImage, walkRamp } from "../layers/sharedLayerData";
import { useMemo, useState } from "react";
import { CircleMarker, ImageOverlay, Polyline, Popup, Rectangle, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { cssVar } from "../../marswalk/walkabilityRamp";
import { declutterLabels, landingSiteDetail, landingSiteLabel, roverLabelRecords } from "./useContextLayerData";

/* Tooltip offsets per side (px) so a label clears its marker; the declutter gap matches (offset + 6 px arrow). */
const TIP_OFFSET = { right: [8, 0], left: [-8, 0], top: [0, -8], bottom: [0, 8] };
const LABEL_GAP = 14;

const lon360 = (lon) => ((Number(lon) % 360) + 360) % 360;

function splitAtSeam(coords) {
  const parts = [[]];
  let prev = null;
  for (const [lon, lat] of coords) {
    const x = lon360(lon);
    if (prev != null && Math.abs(x - prev) > 180) parts.push([]);
    parts[parts.length - 1].push([lat, x]);
    prev = x;
  }
  return parts.filter((p) => p.length > 1);
}

function useViewport() {
  const map = useMap();
  const [bounds, setBounds] = useState(() => map.getBounds());
  const update = () => setBounds(map.getBounds());
  useMapEvents({ moveend: update, zoomend: update, resize: update });
  return { map, bounds };
}

/* Which side each rover / landing-site label goes on at the current view (null: hover tooltip only). */
function placeMapLabels(map, roverMarkers, landingSites) {
  try {
    const size = map.getSize();
    const items = [
      ...roverMarkers.map((r) => ({ id: `rover-${r.rover}`, lat: r.lat, lon: r.lon, text: r.label, priority: 0 })),
      ...landingSites.map((s) => ({ id: `site-${s.site_id}`, lat: s.latitude_deg, lon: lon360(s.longitude_deg), text: landingSiteLabel(s), priority: 1 })),
    ].map((it) => {
      const p = map.latLngToContainerPoint([it.lat, it.lon]);
      return { ...it, x: p.x, y: p.y, size: 12 };
    });
    return declutterLabels(items, { width: size.x, height: size.y, gap: LABEL_GAP, markerRadius: 7 });
  } catch {
    return new Map(); // map not ready (hidden or not yet centered): hover tooltips only
  }
}

export default function ContextLayers({ visibility, data, thermalObs = [] }) {
  const { opacity } = useLayers();
  const colors = useMemo(
    () => ({
      msl: cssVar("--nn-rover-msl") || "#888",
      m2020: cssVar("--nn-rover-m2020") || "#888",
      hirise: cssVar("--nn-src-hirise") || "#888",
      red: cssVar("--nn-red") || "#888",
      strong: cssVar("--nn-text-strong") || "#888",
      dust: ["--nn-surface-2", "--nn-cyan", "--nn-amber"].map((t) => cssVar(t) || "#808080"),
    }),
    [],
  );
  const { map, bounds } = useViewport();
  const dustUrl = useMemo(() => (visibility.dust ? dustImage(data.dust, colors.dust) : null), [visibility.dust, data.dust, colors.dust]);
  const gridImages = useMemo(
    () => Object.fromEntries(["slope", "roughness", "walkability"].map((id) => [id, visibility[id] ? gridImage(data.grid, id) : null])),
    [visibility.slope, visibility.roughness, visibility.walkability, data.grid], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const visibleWaypoints = useMemo(() => {
    if (!visibility.waypoints || !data.waypoints) return [];
    const out = [];
    for (const [rover, list] of Object.entries(data.waypoints)) {
      for (const w of list) {
        const pos = [w.lat, lon360(w.lon)];
        if (bounds.contains(pos)) out.push({ rover, w, pos }); // viewport culling: off-screen dots are not drawn
      }
    }
    return out;
  }, [visibility.waypoints, data.waypoints, bounds]);

  const roverMarkers = useMemo(
    () => roverLabelRecords(data.rovers).filter((r) => visibility[r.rover === "msl" ? "mslTraverse" : "m2020Traverse"]),
    [data.rovers, visibility.mslTraverse, visibility.m2020Traverse], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const landingSites = useMemo(() => (visibility.landingSites ? (data.landingSites ?? []).filter((s) => s.latitude_deg != null && s.longitude_deg != null) : []), [visibility.landingSites, data.landingSites]);
  // Screen-space label placement, recomputed after every move, zoom or resize (bounds changes on each).
  const placement = useMemo(() => placeMapLabels(map, roverMarkers, landingSites), [map, bounds, roverMarkers, landingSites]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {dustUrl && <ImageOverlay url={dustUrl} bounds={[[-90, 0], [90, 360]]} opacity={opacity.dust ?? 0.55} />}
      {["slope", "roughness", "walkability"].map((id) =>
        gridImages[id] ? <ImageOverlay key={`${id}-${gridImages[id].url.length}`} url={gridImages[id].url} bounds={gridImages[id].bounds} opacity={opacity[id] ?? 0.55} className="nn-grid-overlay" /> : null,
      )}
      {visibility.themisObs &&
        thermalObs
          .filter((o) => o.latitude_deg != null && o.longitude_deg != null)
          .map((o, i) => {
            const [r, g, b] = walkRamp(o.brightness_temperature_k, 170, 290);
            return (
              <CircleMarker key={`themis-${o.product_id ?? i}`} center={[o.latitude_deg, lon360(o.longitude_deg)]} radius={5} pathOptions={{ color: "#081014", weight: 1, fillColor: `rgb(${r}, ${g}, ${b})`, fillOpacity: 0.95 }}>
                <Tooltip>{`THEMIS ${o.product_id ?? ""} · ${o.brightness_temperature_k?.toFixed?.(1) ?? "n/a"} K (historical observation)`}</Tooltip>
              </CircleMarker>
            );
          })}
      {["msl", "m2020"].map((rover) =>
        visibility[rover === "msl" ? "mslTraverse" : "m2020Traverse"] && data.traverses?.[rover]
          ? splitAtSeam(data.traverses[rover]).map((part, i) => (
              <Polyline key={`${rover}-${i}`} positions={part} pathOptions={{ color: colors[rover], weight: 2.5, opacity: 0.95 }}>
                <Tooltip sticky>{rover === "msl" ? "Curiosity" : "Perseverance"} traverse · NASA MMGIS (operations localization)</Tooltip>
              </Polyline>
            ))
          : null,
      )}
      {roverMarkers.map((r) => {
        const dir = placement.get(`rover-${r.rover}`);
        return (
          <CircleMarker
            key={`rover-${r.rover}`}
            center={[r.lat, r.lon]}
            radius={7}
            pathOptions={{ color: colors.strong, weight: 2, fillColor: colors[r.rover], fillOpacity: 0.9 }}
            className="nn-rover-at-sol"
          >
            {dir ? (
              <Tooltip key={`perm-${dir}`} permanent direction={dir} offset={TIP_OFFSET[dir]} className="nn-rover-label">
                {r.label}
              </Tooltip>
            ) : (
              <Tooltip key="hover" className="nn-rover-label">
                {r.label}
              </Tooltip>
            )}
            <Popup>{r.detail}</Popup>
          </CircleMarker>
        );
      })}
      {visibleWaypoints.map(({ rover, w, pos }) => (
        <CircleMarker key={`${rover}-${w.RMC}`} center={pos} radius={1.5 + (w.tilt ?? 0) / 6} pathOptions={{ color: colors[rover], weight: 1, fillOpacity: rover === "msl" && data.rovers?.msl && w.sol > data.rovers.msl.missionSol ? 0.12 : 0.5, opacity: rover === "msl" && data.rovers?.msl && w.sol > data.rovers.msl.missionSol ? 0.25 : 1 }}>
          <Tooltip>{`${rover === "msl" ? "Curiosity" : "Perseverance"} sol ${w.sol} · tilt ${w.tilt?.toFixed(1) ?? "n/a"}° (IMU)`}</Tooltip>
        </CircleMarker>
      ))}
      {visibility.hiriseFootprints &&
        (data.footprints ?? []).map((p) => {
          const [x0, y0, x1, y1] = p.bbox;
          const ok = p.asset_status?.status === "OK";
          return (
            <Rectangle key={p.product_id} bounds={[[y0, lon360(x0)], [y1, lon360(x1)]]} pathOptions={{ color: ok ? colors.hirise : colors.red, weight: 1.5, fill: false, dashArray: ok ? undefined : "4 3" }}>
              <Tooltip sticky>{`${p.product_id} · ${ok ? `${p.gsd_m.toFixed(2)} m DTM` : `UNAVAILABLE (${p.asset_status?.reason})`}`}</Tooltip>
            </Rectangle>
          );
        })}
      {landingSites.map((site) => {
        const id = `site-${site.site_id}`;
        const dir = placement.get(id);
        return (
          <CircleMarker key={id} center={[site.latitude_deg, lon360(site.longitude_deg)]} radius={6} pathOptions={{ color: colors.strong, weight: 2, fill: false }}>
            {dir ? (
              <Tooltip key={`perm-${dir}`} permanent direction={dir} offset={TIP_OFFSET[dir]} className="nn-site-label">
                {landingSiteLabel(site)}
              </Tooltip>
            ) : (
              <Tooltip key="hover">{`${landingSiteLabel(site)} · ${landingSiteDetail(site)}`}</Tooltip>
            )}
            <Popup>{`${landingSiteDetail(site)}. ${site.coordinate_provenance ?? ""}`.trim()}</Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
