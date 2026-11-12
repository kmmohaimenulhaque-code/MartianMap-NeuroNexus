/*
 * Context layers drawn inside the global 2D map (MarsMap, canvas renderer): rover traverses, waypoints
 * sized by IMU tilt (culled to the viewport), HiRISE DTM footprint boxes, landing sites and the
 * modeled MY34 dust optical depth. Colors come from tokens.css.
 */

import { useMemo, useState } from "react";
import { CircleMarker, ImageOverlay, Polyline, Popup, Rectangle, Tooltip, useMap, useMapEvents } from "react-leaflet";

import { cssVar, rampColor } from "../../marswalk/walkabilityRamp";

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

function dustImage(dust, stops) {
  if (typeof document === "undefined" || !dust?.tau?.length) return null;
  const rows = dust.tau.length;
  const cols = dust.tau[0].length;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v = dust.tau[r][c];
      if (v == null) continue;
      ctx.fillStyle = rampColor((Math.log1p(v) / Math.log1p(2)) * 100, stops);
      ctx.fillRect(c, rows - 1 - r, 1, 1); // data row 0 is the southernmost latitude
    }
  }
  return canvas.toDataURL("image/png");
}

function useViewport() {
  const map = useMap();
  const [bounds, setBounds] = useState(() => map.getBounds());
  useMapEvents({ moveend: () => setBounds(map.getBounds()), zoomend: () => setBounds(map.getBounds()) });
  return bounds;
}

export default function ContextLayers({ visibility, data }) {
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
      {dustUrl && <ImageOverlay url={dustUrl} bounds={[[-90, 0], [90, 360]]} opacity={0.55} />}
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
