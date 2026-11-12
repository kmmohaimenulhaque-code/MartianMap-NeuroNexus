/*
 * RADIAL FEATURE WHEEL: a tactical HUD ring opened by a double right-click (two within 300 ms) at the
 * cursor. Eight segmented sectors around a status hub; hovering or clicking a sector expands its outer
 * sub-feature arc; choosing a sub-feature runs the matching Command Index action. Escape, a click
 * outside or a choice closes it. Shift + right-click keeps the browser's own menu.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";

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

export function WheelSvg({ state, dispatch, onAction, availability, solLabel }) {
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
    <svg className="nn-wheel-svg" width={GEOM.size} height={GEOM.size} viewBox={`0 0 ${GEOM.size} ${GEOM.size}`} role="menu" aria-label="Radial feature wheel">
      <defs>
        <radialGradient id="nn-wheel-slate" gradientUnits="userSpaceOnUse" cx={C} cy={C} r={GEOM.outer}>
          <stop offset="0.5" stopColor="#0d181e" />
          <stop offset="1" stopColor="#091115" />
        </radialGradient>
        <linearGradient id="nn-wheel-active" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(117, 230, 255, 0.35)" />
          <stop offset="1" stopColor="rgba(9, 17, 21, 0.92)" />
        </linearGradient>
        <radialGradient id="nn-wheel-glow" gradientUnits="userSpaceOnUse" cx={C} cy={C} r={GEOM.subOuter}>
          <stop offset="0.3" stopColor="rgba(26, 143, 168, 0)" />
          <stop offset="0.62" stopColor="rgba(26, 143, 168, 0.85)" />
          <stop offset="0.66" stopColor="rgba(117, 230, 255, 0.55)" />
          <stop offset="1" stopColor="rgba(26, 143, 168, 0.75)" />
        </radialGradient>
        <linearGradient id="nn-wheel-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9cfd6" />
          <stop offset="0.45" stopColor="#6f858d" />
          <stop offset="1" stopColor="#29414b" />
        </linearGradient>
        <filter id="nn-wheel-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.55  0 0 0 0 0.6  0 0 0 0.09 0" result="grain" />
          <feComposite in="grain" in2="SourceGraphic" operator="in" result="grainIn" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="grainIn" />
          </feMerge>
        </filter>
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
            <path d={annulusPath(GEOM.inner, GEOM.outer, a0, a1)} fill="url(#nn-wheel-slate)" filter="url(#nn-wheel-grain)" className="nn-wheel-face" />
            {on && <path d={annulusPath(GEOM.inner, GEOM.outer, a0, a1)} fill="url(#nn-wheel-active)" className="nn-wheel-face-on" />}
            {on && <path d={annulusPath(GEOM.inner, GEOM.outer, a0, a1)} fill="url(#nn-wheel-glow)" className="nn-wheel-face-glow" />}
            {[a0 + 2.2, a1 - 2.2].map((a) => {
              const [rx, ry] = polar(GEOM.outer - 9, a);
              return <circle key={a} cx={rx} cy={ry} r={2.1} className="nn-wheel-rivet" />;
            })}
            <WheelIcon name={sector.icon} x={ix} y={iy - 14} />
            <text x={ix} y={iy + 14} textAnchor="middle" className="nn-wheel-label">
              {sector.label.map((line, k) => (
                <tspan key={line} x={ix} dy={k === 0 ? 0 : 14}>
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
            const lines = wrapLabel(`[${item.label}]`, 13);
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
                <path d={annulusPath(GEOM.subInner, GEOM.subOuter, a0, a1)} className="nn-wheel-subface" filter="url(#nn-wheel-grain)" />
                {on && <path d={annulusPath(GEOM.subInner, GEOM.subOuter, a0, a1)} fill="url(#nn-wheel-active)" className="nn-wheel-face-on" />}
                <text x={tx} y={ty - ((lines.length - 1) * 14) / 2 + 4} textAnchor="middle" className="nn-wheel-sublabel">
                  {lines.map((line, k) => (
                    <tspan key={`${line}-${k}`} x={tx} dy={k === 0 ? 0 : 14}>
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
            <tspan key={`${line}-${k}`} x={C} dy={k === 0 ? 0 : 14}>
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
      if (isDouble(event.timeStamp)) openAt(event.clientX, event.clientY);
    };
    const onOpen = (event) => openAt(event.detail?.x ?? window.innerWidth / 2, event.detail?.y ?? window.innerHeight / 2);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("nn:open-wheel", onOpen);
    return () => {
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("nn:open-wheel", onOpen);
    };
  }, [openAt]);

  useEffect(() => {
    if (!state.open) return undefined;
    rootRef.current?.focus();
    return undefined;
  }, [state.open]);

  if (!state.open) return null;

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

  return (
    <div
      className="nn-wheel-overlay"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.target === event.currentTarget && dispatch({ type: "close" })}
      data-testid="radial-wheel"
    >
      <div className="nn-wheel" style={{ left: state.x - GEOM.size / 2, top: state.y - GEOM.size / 2 }} onMouseDown={(e) => e.stopPropagation()}>
        <WheelSvg state={state} dispatch={dispatch} onAction={onAction} availability={availability} solLabel={solLabel} />
      </div>
    </div>
  );
}
