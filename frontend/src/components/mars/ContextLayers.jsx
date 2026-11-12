/*
 * Context layers drawn inside the global 2D map (MarsMap, canvas renderer): rover traverses, waypoints
 * sized by IMU tilt (culled to the viewport), HiRISE DTM footprint boxes, landing sites and the
 * modeled MY34 dust optical depth. Colors come from tokens.css.
 */

import { useLayers } from "../layers/layerStore";
import { dustImage, gridImage, walkRamp } from "../layers/sharedLayerData";
import { useMemo, useState } from "react";
import { CircleMarker, ImageOverlay, Polyline, Popup, Rectangle, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { cssVar } from "../../marswalk/walkabilityRamp";

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
  useMapEvents({ moveend: () => setBounds(map.getBounds()), zoomend: () => setBounds(map.getBounds()) });
  return bounds;
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
  const bounds = useViewport();
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
      {visibility.mslTraverse && data.roverAtSol?.msl && (
        <CircleMarker
          center={[data.roverAtSol.msl.lat, lon360(data.roverAtSol.msl.lon)]}
          radius={7}
          pathOptions={{ color: colors.strong, weight: 2, fillColor: colors.msl, fillOpacity: 0.9 }}
          className="nn-rover-at-sol"
        >
          <Tooltip permanent direction="right" className="nn-rover-label">{`CURIOSITY @ SOL ${data.roverAtSol.msl.my34Sol}`}</Tooltip>
          <Popup>{`Curiosity at MY34 sol ${data.roverAtSol.msl.my34Sol} ≈ mission sol ${data.roverAtSol.msl.missionSol}; last localized waypoint: sol ${data.roverAtSol.msl.sol} (NASA MMGIS). Calendar conversion is approximate to about one sol.`}</Popup>
        </CircleMarker>
      )}
      {visibleWaypoints.map(({ rover, w, pos }) => (
        <CircleMarker key={`${rover}-${w.RMC}`} center={pos} radius={1.5 + (w.tilt ?? 0) / 6} pathOptions={{ color: colors[rover], weight: 1, fillOpacity: rover === "msl" && data.roverAtSol?.msl && w.sol > data.roverAtSol.msl.missionSol ? 0.12 : 0.5, opacity: rover === "msl" && data.roverAtSol?.msl && w.sol > data.roverAtSol.msl.missionSol ? 0.25 : 1 }}>
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
      {visibility.landingSites &&
        (data.landingSites ?? []).map((s) => (
          <CircleMarker key={s.site_id} center={[s.latitude_deg, lon360(s.longitude_deg)]} radius={6} pathOptions={{ color: colors.strong, weight: 2, fill: false }}>
            <Tooltip>{`${s.mission} · ${s.landing_date} · ${s.region}`}</Tooltip>
          </CircleMarker>
        ))}
    </>
  );
}
