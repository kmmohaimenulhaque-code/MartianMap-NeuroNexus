import { useId, useMemo, useRef, useState } from "react";

/*
 * NeonLineChart · dependency-free SVG line chart in the console's cyan glow.
 *
 * series: [{ id, label, colour, points: [[x, y], ...] }]   (y may be null → gap)
 * bands:  [{ from, to, colour, label }]   horizontal threshold bands (y units)
 * cursorX: x value of the "now" marker; onPick(x) when the user clicks the plot.
 * A visually hidden table carries the data for screen readers.
 */

const PAD = { top: 10, right: 10, bottom: 20, left: 38 };

function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${(value / 1000).toFixed(0)}k`;
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (abs >= 10) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function pathFor(points, sx, sy) {
  let d = "";
  let pen = false;
  for (const [x, y] of points) {
    if (y === null || y === undefined || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export default function NeonLineChart({
  series = [],
  bands = [],
  height = 120,
  width = 320,
  cursorX = null,
  onPick,
  xLabel = "",
  yLabel = "",
  formatX = (x) => String(x),
  formatY = (y) => String(y),
  area = true,
  yMin: yMinProp,
  ariaLabel = "Chart",
}) {
  const id = useId().replace(/:/g, "");
  const ref = useRef(null);
  const [hoverX, setHoverX] = useState(null);

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    const xs = [];
    const ys = [];
    series.forEach((s) =>
      s.points.forEach(([x, y]) => {
        xs.push(x);
        if (Number.isFinite(y)) ys.push(y);
      }),
    );
    if (!xs.length || !ys.length) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    let lo = yMinProp ?? Math.min(...ys);
    let hi = Math.max(...ys);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.08;
    return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: yMinProp ?? lo - pad, yMax: hi + pad };
  }, [series, yMinProp]);

  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const sx = (x) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const sy = (y) => PAD.top + (1 - (y - yMin) / (yMax - yMin || 1)) * innerH;
  const yTicks = niceTicks(yMin, yMax, 3);
  const xTicks = niceTicks(xMin, xMax, 4);

  function xFromEvent(event) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const x = xMin + ((px - PAD.left) / innerW) * (xMax - xMin);
    return Math.min(xMax, Math.max(xMin, x));
  }

  const hoverRows =
    hoverX === null
      ? []
      : series.map((s) => {
          let best = null;
          for (const point of s.points) if (!best || Math.abs(point[0] - hoverX) < Math.abs(best[0] - hoverX)) best = point;
          return { ...s, point: best };
        });

  if (!series.length || !series.some((s) => s.points.some(([, y]) => Number.isFinite(y)))) {
    return <div className="nn-chart-empty">NO PLOTTABLE DATA</div>;
  }

  return (
    <div className="nn-chart">
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(event) => setHoverX(xFromEvent(event))}
        onMouseLeave={() => setHoverX(null)}
        onClick={(event) => {
          const x = xFromEvent(event);
          if (x !== null) onPick?.(x);
        }}
        style={{ cursor: onPick ? "crosshair" : "default" }}
      >
        <defs>
          <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {series.map((s) => (
            <linearGradient key={s.id} id={`fill-${id}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.colour} stopOpacity="0.2" />
              <stop offset="100%" stopColor={s.colour} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {bands.map((band) => {
          const top = sy(Math.min(band.to ?? yMax, yMax));
          const bottom = sy(Math.max(band.from, yMin));
          if (bottom <= top) return null;
          return (
            <g key={band.label}>
              <rect x={PAD.left} y={top} width={innerW} height={bottom - top} fill={band.colour} opacity="0.07" />
              <line x1={PAD.left} x2={PAD.left + innerW} y1={bottom} y2={bottom} stroke={band.colour} strokeOpacity="0.35" strokeDasharray="3 3" strokeWidth="0.6" />
            </g>
          );
        })}

        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={sy(t)} y2={sy(t)} stroke="var(--nn-cyan-dim)" strokeWidth="0.4" />
            <text x={PAD.left - 4} y={sy(t) + 3} textAnchor="end" className="nn-chart-tick">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={height - 6} textAnchor="middle" className="nn-chart-tick">
            {formatX(t)}
          </text>
        ))}
        {yLabel && (
          <text x={4} y={PAD.top + 2} className="nn-chart-axis">
            {yLabel}
          </text>
        )}
        {xLabel && (
          <text x={PAD.left + innerW} y={height - 6} textAnchor="end" className="nn-chart-axis" dy="-9">
            {xLabel}
          </text>
        )}

        {series.map((s) => {
          const d = pathFor(s.points, sx, sy);
          const valid = s.points.filter(([, y]) => Number.isFinite(y));
          const areaPath =
            area && series.length === 1 && valid.length > 1
              ? `${d}L${sx(valid[valid.length - 1][0]).toFixed(1)},${sy(yMin).toFixed(1)}L${sx(valid[0][0]).toFixed(1)},${sy(yMin).toFixed(1)}Z`
              : null;
          return (
            <g key={s.id}>
              {areaPath && <path d={areaPath} fill={`url(#fill-${id}-${s.id})`} />}
              <path d={d} fill="none" stroke={s.colour} strokeWidth={s.width ?? 1.5} strokeLinejoin="round" filter={`url(#glow-${id})`} strokeDasharray={s.dashed ? "4 3" : undefined} />
            </g>
          );
        })}

        {cursorX !== null && cursorX >= xMin && cursorX <= xMax && (
          <g>
            <line x1={sx(cursorX)} x2={sx(cursorX)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--nn-cyan)" strokeOpacity="0.7" strokeWidth="0.8" />
            {series.map((s) => {
              const p = s.points.find(([x]) => x === cursorX);
              return p && Number.isFinite(p[1]) ? (
                <circle key={s.id} cx={sx(cursorX)} cy={sy(p[1])} r="3" fill={s.colour} filter={`url(#glow-${id})`} className="nn-chart-now" />
              ) : null;
            })}
          </g>
        )}

        {hoverX !== null && (
          <line x1={sx(hoverX)} x2={sx(hoverX)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--nn-text-dim)" strokeWidth="0.5" strokeDasharray="2 2" />
        )}
      </svg>

      {hoverRows.length > 0 && hoverRows[0].point && (
        <div className="nn-chart-tip">
          <span>{formatX(hoverRows[0].point[0])}</span>
          {hoverRows.map((row) => (
            <span key={row.id} style={{ color: row.colour }}>
              {row.label}: {Number.isFinite(row.point?.[1]) ? formatY(row.point[1]) : "no data"}
            </span>
          ))}
        </div>
      )}

      <table className="nn-sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {series.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td>{s.points.length} points</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
