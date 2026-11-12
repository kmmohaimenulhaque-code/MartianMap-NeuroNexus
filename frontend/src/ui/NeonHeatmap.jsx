import { useEffect, useRef } from "react";

/*
 * NeonHeatmap · a lat/lon grid drawn on <canvas> with a dark→cyan→white ramp
 * and an SVG crosshair. grid[row][col] with row 0 = southernmost latitude.
 */

const STOPS = [
  [0, [6, 14, 19]],
  [0.12, [16, 70, 88]],
  [0.4, [1, 255, 255]],
  [0.75, [255, 196, 107]],
  [1, [255, 100, 124]],
];

function rampColour(t) {
  const v = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i += 1) {
    if (v <= STOPS[i][0]) {
      const [p0, c0] = STOPS[i - 1];
      const [p1, c1] = STOPS[i];
      const f = (v - p0) / (p1 - p0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export default function NeonHeatmap({ grid, lat, lon, scaleMax, marker, onPick, height = 120, ariaLabel = "Global map" }) {
  const canvasRef = useRef(null);
  const rows = grid?.length ?? 0;
  const cols = grid?.[0]?.length ?? 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rows || !cols) return;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const value = grid[r][c];
        // Canvas row 0 is the top (north), the data's row 0 is south.
        const offset = ((rows - 1 - r) * cols + c) * 4;
        const [R, G, B] = Number.isFinite(value) ? rampColour(Math.log1p(value) / Math.log1p(scaleMax)) : [40, 40, 40];
        image.data[offset] = R;
        image.data[offset + 1] = G;
        image.data[offset + 2] = B;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [grid, rows, cols, scaleMax]);

  if (!rows || !cols) return <div className="nn-chart-empty">MAP UNAVAILABLE</div>;

  const markerX = marker ? (((marker.longitude_deg % 360) + 360) % 360) / 360 : null;
  const markerY = marker ? (90 - marker.latitude_deg) / 180 : null;

  return (
    <div className="nn-heatmap" style={{ height }} aria-label={ariaLabel} role="img">
      <canvas
        ref={canvasRef}
        width={cols}
        height={rows}
        onClick={(event) => {
          if (!onPick) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const fx = (event.clientX - rect.left) / rect.width;
          const fy = (event.clientY - rect.top) / rect.height;
          onPick({ latitude_deg: 90 - fy * 180, longitude_deg: fx * 360 });
        }}
        style={{ cursor: onPick ? "crosshair" : "default" }}
      />
      {marker && (
        <svg className="nn-heatmap-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1={markerX * 100} x2={markerX * 100} y1="0" y2="100" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2="100" y1={markerY * 100} y2={markerY * 100} stroke="#fff" strokeOpacity="0.55" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {lat && lon && <span className="nn-heatmap-axis">90°S–90°N · 0–360°E</span>}
    </div>
  );
}
