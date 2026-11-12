/*
 * The USGS SIM 3292 geologic layers of a route snapshot (units, contacts, structures), drawn as vectors in the
 * USGS web map's own renderer colors over a white ground, the way the USGS geologic map app shows them.
 * No raster basemap: vectors stay sharp at any extent. Shared by the snapshot dialog and the comparison workspace.
 */
import { useId } from "react";

export default function UsgsGeologyLayers({ geology, width, height, k }) {
  const line = (key, path, color, w, dash) => (
    <polyline key={key} points={path.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeOpacity="0.85" strokeWidth={w * k}
      strokeDasharray={dash ? `${5 * k} ${3 * k}` : undefined} />
  );
  const clip = useId();
  return (
    /* Clipped to the frame: a letterboxed svg would otherwise show units past the frame edge. */
    <g clipPath={`url(#${CSS.escape(clip)})`}>
      <clipPath id={clip}>
        <rect x="0" y="0" width={width} height={height} />
      </clipPath>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
      {(geology?.polygons ?? []).map((polygon, index) => (
        /* One path per unit with even-odd fill, so inner rings stay holes. */
        <path key={index} d={polygon.rings_px.map((ring) => `M${ring.map((p) => p.join(",")).join("L")}Z`).join("")}
          fillRule="evenodd" fill={polygon.color} fillOpacity="0.6" stroke={polygon.color} strokeWidth={0.5 * k} />
      ))}
      {(geology?.contacts ?? []).flatMap((c, i) => c.paths_px.map((path, j) => line(`c-${i}-${j}`, path, c.color ?? "#000000", 1.2, c.dash)))}
      {(geology?.structures ?? []).flatMap((s, i) => s.paths_px.map((path, j) => line(`s-${i}-${j}`, path, s.color ?? "#000000", 1.6, false)))}
    </g>
  );
}
