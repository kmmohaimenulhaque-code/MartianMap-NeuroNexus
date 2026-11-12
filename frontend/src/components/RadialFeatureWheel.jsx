/*
 * RADIAL FEATURE WHEEL: a tactical HUD ring opened by a double right-click (two within 300 ms) at the
 * cursor. Eight segmented sectors around a status hub; hovering or clicking a sector expands its outer
 * sub-feature arc; choosing a sub-feature runs the matching Command Index action. Escape, a click
 * outside or a choice closes it. Shift + right-click keeps the browser's own menu.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { createPortal } from "react-dom";

import { useSol } from "../state/solStore";
import { ICON_PATHS } from "../ui/iconPaths";
import {
  GEOM,
  WHEEL,
  annulusPath,
  clampCenter,
  createDoubleRightClickDetector,
  initialWheel,
  polar,
  sectorAngles,
  subAngles,
  wheelReducer,
  wrapLabel,
} from "./wheel/wheelModel";

const C = GEOM.size / 2;

function WheelIcon({ name, x, y, size = 26 }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  const s = size / 24;
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})`} className="nn-wheel-icon" aria-hidden="true">
      <path d={d} fill="none" strokeWidth={1.6 / s + 0.4} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/* Font size (viewBox units) at which the longest line fits a chord of maxW: never larger than base. Switzer
 * caps with the wheel's letter spacing average about 0.64 em per character. */
function fitSize(lines, maxW, base) {
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return Math.min(base, Math.floor((maxW / (longest * 0.64)) * 10) / 10);
}
const chord = (r, spanDeg, pad) => 2 * r * Math.sin(((spanDeg / 2) * Math.PI) / 180) - pad;

export function WheelSvg({ state, dispatch, onAction, availability, solLabel, compact = false }) {
  const lh = compact ? 19 : 14; // label line height in viewBox units (phones draw the wheel smaller, so text is set larger)
  // Labels are sized to fit their sector (no word ever runs past its slice); phones start a little larger.
  const mainBase = compact ? 15 : 12;
  const subBase = compact ? 14 : 12;
  // One size per ring (the size at which its longest label fits), so every sector reads the same.
  const mainFit = Math.min(...WHEEL.map((sec) => fitSize(sec.label, chord(GEOM.inner + 30, 360 / WHEEL.length - GEOM.sectorGapDeg, 12), mainBase)));
  const mainSize = () => mainFit;
  const active = state.active != null ? WHEEL[state.active] : null;
  const subItem = active && state.sub != null ? active.items[state.sub] : null;
  const subVerdict = subItem ? (availability?.(subItem.id) ?? true) : true;
  const choose = (sector, item) => {
    const id = WHEEL[sector].items[item].id;
    const verdict = availability?.(id) ?? true;
    if (verdict !== true) {
      dispatch({ type: "hoverSub", index: item });
      return;
    }
    dispatch({ type: "select", sector, item });
    onAction?.(id);
  };
  return (
    <svg className={`nn-wheel-svg${compact ? " is-compact" : ""}`} width={GEOM.size} height={GEOM.size} viewBox={`0 0 ${GEOM.size} ${GEOM.size}`} role="menu" aria-label="Radial feature wheel">
      <defs>
        <radialGradient id="nn-wheel-slate" gradientUnits="userSpaceOnUse" cx={C} cy={C} r={GEOM.outer}>
          <stop offset="0.5" stopColor="#0d181e" />
          <stop offset="1" stopColor="#091115" />
        </radialGradient>
        <linearGradient id="nn-wheel-active" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(1, 255, 255, 0.35)" />
          <stop offset="1" stopColor="rgba(9, 17, 21, 0.92)" />
        </linearGradient>
        <radialGradient id="nn-wheel-glow" gradientUnits="userSpaceOnUse" cx={C} cy={C} r={GEOM.subOuter}>
          <stop offset="0.3" stopColor="rgba(26, 143, 168, 0)" />
          <stop offset="0.62" stopColor="rgba(26, 143, 168, 0.85)" />
          <stop offset="0.66" stopColor="rgba(1, 255, 255, 0.55)" />
          <stop offset="1" stopColor="rgba(26, 143, 168, 0.75)" />
        </radialGradient>
        <linearGradient id="nn-wheel-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9cfd6" />
          <stop offset="0.45" stopColor="#6f858d" />
          <stop offset="1" stopColor="#29414b" />
        </linearGradient>
        {/* Grain as a texture fill, painted only inside each sector path (a filter on the path would render its
            rectangular filter region as a faint box on iOS). */}
        <filter id="nn-wheel-noise" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.55  0 0 0 0 0.6  0 0 0 0.09 0" />
        </filter>
        <pattern id="nn-wheel-grain" patternUnits="userSpaceOnUse" width={GEOM.size} height={GEOM.size}>
          <rect width={GEOM.size} height={GEOM.size} filter="url(#nn-wheel-noise)" />
        </pattern>
      </defs>

      {/* Backplate: the dark gaps between sectors read as machined seams. */}
      <path d={annulusPath(GEOM.inner - 4, GEOM.outer + 4, -179.99, 179.99)} className="nn-wheel-backplate" />
      <circle cx={C} cy={C} r={GEOM.outer + 4} className="nn-wheel-rim" />
      <circle cx={C} cy={C} r={GEOM.outer + 6} className="nn-wheel-rim-hi" />
      {Array.from({ length: 40 }, (_, i) => {
        const [x0, y0] = polar(GEOM.outer + 6, i * 9);
        const [x1, y1] = polar(GEOM.outer + (i % 5 === 0 ? 13 : 9), i * 9);
        return <line key={`t${i}`} x1={x0} y1={y0} x2={x1} y2={y1} className="nn-wheel-tick" />;
      })}

      {WHEEL.map((sector, i) => {
        const { a0, a1, mid } = sectorAngles(i);
        const on = state.active === i;
        const [ix, iy] = polar((GEOM.inner + GEOM.outer) / 2 + 2, mid);
        return (
          <g
            key={sector.id}
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={on}
            tabIndex={-1}
            className={`nn-wheel-sector${on ? " is-active" : ""}`}
            onMouseEnter={() => dispatch({ type: "hover", index: i })}
            onClick={() => dispatch({ type: "hover", index: i })}
          >
            <path d={annulusPath(GEOM.inner, GEOM.outer, a0, a1)} fill="url(#nn-wheel-slate)" className="nn-wheel-face" />
            <path d={annulusPath(GEOM.inner, GEOM.outer, a0, a1)} fill="url(#nn-wheel-grain)" pointerEvents="none" />
            {on && <path d={annulusPath(GEOM.inner, GEOM.outer, a0, a1)} fill="url(#nn-wheel-active)" className="nn-wheel-face-on" />}
            {on && <path d={annulusPath(GEOM.inner, GEOM.outer, a0, a1)} fill="url(#nn-wheel-glow)" className="nn-wheel-face-glow" />}
            {[a0 + 2.2, a1 - 2.2].map((a) => {
              const [rx, ry] = polar(GEOM.outer - 9, a);
              return <circle key={a} cx={rx} cy={ry} r={2.1} className="nn-wheel-rivet" />;
            })}
            <WheelIcon name={sector.icon} x={ix} y={iy - 14} />
            <text x={ix} y={iy + 14} textAnchor="middle" className="nn-wheel-label" style={{ fontSize: mainSize(sector.label) }}>
              {sector.label.map((line, k) => (
                <tspan key={line} x={ix} dy={k === 0 ? 0 : lh * (mainSize(sector.label) / mainBase)}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}

      {/* Metal separators between sectors, as in a weapon wheel. */}
      {WHEEL.map((_, i) => {
        const a = (i + 0.5) * (360 / WHEEL.length);
        const [x0, y0] = polar(GEOM.inner - 3, a);
        const [x1, y1] = polar(GEOM.outer + 3, a);
        return <line key={`s${i}`} x1={x0} y1={y0} x2={x1} y2={y1} stroke="url(#nn-wheel-metal)" className="nn-wheel-sep" />;
      })}

      {active && (
        <g className="nn-wheel-sub" key={`sub-${state.active}`} role="menu" aria-label={`${active.label.join(" ")} features`}>
          {active.items.map((item, j) => {
            const { a0, a1, mid } = subAngles(state.active, active.items.length, j);
            const on = state.sub === j;
            const verdict = availability?.(item.id) ?? true;
            const lines = wrapLabel(item.label, compact ? 11 : 13);
            const size = Math.min(...active.items.map((it) => fitSize(wrapLabel(it.label, compact ? 11 : 13), chord((GEOM.subInner + GEOM.subOuter) / 2, a1 - a0, 14), subBase)));
            const slh = lh * (size / subBase);
            const [tx, ty] = polar((GEOM.subInner + GEOM.subOuter) / 2, mid);
            return (
              <g
                key={item.id}
                role="menuitem"
                aria-disabled={verdict !== true}
                data-action={item.id}
                className={`nn-wheel-subitem${on ? " is-active" : ""}${verdict !== true ? " is-disabled" : ""}`}
                onMouseEnter={() => dispatch({ type: "hoverSub", index: j })}
                onClick={() => choose(state.active, j)}
              >
                <title>{verdict === true ? item.label : `${item.label}: ${verdict}`}</title>
                <path d={annulusPath(GEOM.subInner, GEOM.subOuter, a0, a1)} className="nn-wheel-subface" />
                <path d={annulusPath(GEOM.subInner, GEOM.subOuter, a0, a1)} fill="url(#nn-wheel-grain)" pointerEvents="none" />
                {on && <path d={annulusPath(GEOM.subInner, GEOM.subOuter, a0, a1)} fill="url(#nn-wheel-active)" className="nn-wheel-face-on" />}
                <text x={tx} y={ty - ((lines.length - 1) * slh) / 2 + 4} textAnchor="middle" className="nn-wheel-sublabel" style={{ fontSize: size }}>
                  {lines.map((line, k) => (
                    <tspan key={`${line}-${k}`} x={tx} dy={k === 0 ? 0 : slh}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* Status hub */}
      <circle cx={C} cy={C} r={GEOM.inner - 8} className="nn-wheel-hub" />
      <circle cx={C} cy={C} r={GEOM.inner - 15} className="nn-wheel-hub-ring" />
      <text x={C} y={C - 22} textAnchor="middle" className="nn-wheel-hub-kicker">
        {active ? "FEATURE GROUP" : "NEURONEXUS HUD"}
      </text>
      <text x={C} y={C} textAnchor="middle" className="nn-wheel-hub-title">
        {active ? active.label.join(" ") : "SELECT"}
      </text>
      <text x={C} y={C + 18} textAnchor="middle" className="nn-wheel-hub-sub">
        {subItem ? subItem.label : solLabel || ""}
      </text>
      <text x={C} y={C + 36} textAnchor="middle" className={`nn-wheel-hub-hint${subVerdict !== true ? " is-blocked" : ""}`}>
        {wrapLabel(subVerdict === true ? (subItem ? "CLICK OR ENTER TO RUN" : "ESC TO CLOSE") : String(subVerdict).toUpperCase(), 22)
          .slice(0, 2)
          .map((line, k) => (
            <tspan key={`${line}-${k}`} x={C} dy={k === 0 ? 0 : lh}>
              {line}
            </tspan>
          ))}
      </text>
    </svg>
  );
}

export default function RadialFeatureWheel({ onAction, availability }) {
  const [state, dispatch] = useReducer(wheelReducer, initialWheel);
  const { label: solLabel } = useSol();
  const rootRef = useRef(null);

  const openAt = useCallback((x, y) => {
    const { x: cx, y: cy } = clampCenter(x, y, window.innerWidth, window.innerHeight);
    dispatch({ type: "open", x: cx, y: cy });
  }, []);

  useEffect(() => {
    const isDouble = createDoubleRightClickDetector(300);
    const onContext = (event) => {
      if (event.shiftKey || event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      if (event.pointerType === "touch" || event.sourceCapabilities?.firesTouchEvents) return; // touch uses the long-press above
      if (isDouble(event.timeStamp)) openAt(event.clientX, event.clientY);
    };
    const onOpen = (event) => openAt(event.detail?.x ?? window.innerWidth / 2, event.detail?.y ?? window.innerHeight / 2);
    // Touch: a 500 ms stationary single-finger hold, or a quick two-finger tap, on a map opens the wheel.
    const onMap = (target) => target?.closest?.(".leaflet-container, .esri-view, .mw-center, .map-panel-body") && !target.closest("button, a, input, select, textarea, .leaflet-control, .leaflet-popup");
    let hold = null;
    let pair = null;
    const cancelHold = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };
    const onTouchStart = (event) => {
      if (!onMap(event.target)) return;
      if (event.touches.length === 1) {
        const t = event.touches[0];
        hold = { x: t.clientX, y: t.clientY, timer: setTimeout(() => {
          hold = null;
          openAt(t.clientX, t.clientY);
        }, 500) };
      } else if (event.touches.length === 2) {
        cancelHold();
        const [a, b] = event.touches;
        pair = { t: event.timeStamp, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, moved: false };
      }
    };
    const onTouchMove = (event) => {
      const t = event.touches[0];
      if (hold && t && Math.hypot(t.clientX - hold.x, t.clientY - hold.y) > 10) cancelHold();
      if (pair && event.touches.length === 2) {
        const [a, b] = event.touches;
        if (Math.hypot((a.clientX + b.clientX) / 2 - pair.x, (a.clientY + b.clientY) / 2 - pair.y) > 12) pair.moved = true;
      }
    };
    const onTouchEnd = (event) => {
      cancelHold();
      if (pair && event.touches.length === 0) {
        if (!pair.moved && event.timeStamp - pair.t < 350) openAt(pair.x, pair.y);
        pair = null;
      }
    };
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("nn:open-wheel", onOpen);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", cancelHold);
    return () => {
      cancelHold();
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", cancelHold);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("nn:open-wheel", onOpen);
    };
  }, [openAt]);

  useEffect(() => {
    if (!state.open) return undefined;
    rootRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && dispatch({ type: "close" });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open]);

  if (!state.open) return null;
  const compact = window.matchMedia?.("(max-width: 767px)").matches ?? false;

  const onKeyDown = (event) => {
    const sector = state.active != null ? WHEEL[state.active] : null;
    if (event.key === "Escape") dispatch({ type: "close" });
    else if (event.key === "ArrowRight") dispatch({ type: "rotate", step: 1 });
    else if (event.key === "ArrowLeft") dispatch({ type: "rotate", step: -1 });
    else if (sector && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const k = sector.items.length;
      const step = event.key === "ArrowDown" ? 1 : -1;
      dispatch({ type: "hoverSub", index: ((((state.sub ?? -step) + step) % k) + k) % k });
    } else if (event.key === "Enter" && sector && state.sub != null) {
      const id = sector.items[state.sub].id;
      if ((availability?.(id) ?? true) === true) {
        dispatch({ type: "select" });
        onAction?.(id);
      }
    } else return;
    event.preventDefault();
  };

  return createPortal(
    <div
      className="nn-wheel-overlay"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.target === event.currentTarget && dispatch({ type: "close" })}
      data-testid="radial-wheel"
    >
      <div className="nn-wheel" style={{ left: state.x - GEOM.size / 2, top: state.y - GEOM.size / 2 }} onMouseDown={(e) => e.stopPropagation()}>
        <WheelSvg state={state} dispatch={dispatch} onAction={onAction} availability={availability} solLabel={solLabel} compact={compact} />
      </div>
    </div>,
    document.body,
  );
}
