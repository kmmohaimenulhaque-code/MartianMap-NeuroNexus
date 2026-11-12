import { useEffect, useRef, useState } from "react";
import Icon from "../../ui/Icon";
import { mobileUi, useMobileUi } from "./mobileStore";

const openWheel = () => window.dispatchEvent(new CustomEvent("nn:open-wheel", { detail: { x: window.innerWidth / 2, y: window.innerHeight / 2 } }));

/*
 * Bottom tactical dock (< 1200 px only; hidden on the desktop cockpit by CSS). INTEL, ROUTE / EVA and MISSION open
 * the matching panel as a bottom sheet (phones) or side drawer (tablets); MAP closes them; WHEEL opens the
 * Radial Feature Wheel centered on screen. Also renders the sheet backdrop and the floating WHEEL chip.
 */
export default function MobileDock({ appMode }) {
  const { sheet } = useMobileUi();
  const marswalk = appMode === "marswalk";

  useEffect(() => mobileUi.setSheet(null), [appMode]);

  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (event) => event.key === "Escape" && mobileUi.setSheet(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const tabs = [
    { id: null, label: "MAP", icon: "globe", hint: "Full-screen map" },
    { id: "intel", label: marswalk ? "PROFILE" : "INTEL", icon: "info", hint: marswalk ? "Elevation and slope profile" : "Site, rover photos, THEMIS, conditions" },
    { id: "route", label: marswalk ? "EVA" : "ROUTE", icon: "route", hint: marswalk ? "EVA setup" : "Route console and AI route design" },
    { id: "mission", label: "MISSION", icon: "validate", hint: marswalk ? "Decision, ground truth, validation" : "Dust, morphology, gases, mission" },
  ];

  return (
    <>
      {sheet && <button type="button" className="nn-sheet-backdrop" aria-label="Close panel" onClick={() => mobileUi.setSheet(null)} />}
      <button type="button" className="nn-wheel-chip" onClick={openWheel} aria-label="Open the Radial Feature Wheel">
        <Icon name="views" size={14} /> WHEEL
      </button>
      <nav className="nn-dock" aria-label="Tactical navigation">
        {tabs.map((tab) => {
          const active = tab.id === sheet;
          return (
            <button
              key={tab.label}
              type="button"
              className={active ? "is-active" : undefined}
              aria-pressed={active}
              title={tab.hint}
              data-dock={tab.id ?? "map"}
              onClick={() => (tab.id ? mobileUi.toggleSheet(tab.id) : mobileUi.setSheet(null))}
            >
              <Icon name={tab.icon} size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
        <button type="button" data-dock="wheel" title="Radial Feature Wheel (also: long-press or two-finger tap on the map)" onClick={openWheel}>
          <Icon name="views" size={18} />
          <span>WHEEL</span>
        </button>
      </nav>
    </>
  );
}

/*
 * Header shown at the top of a panel while it is a sheet or drawer (hidden on desktop by CSS): drag pill,
 * title and [CLOSE X]. Dragging the pill down by more than 70 px closes the sheet.
 */
export function SheetHead({ title, children }) {
  const drag = useRef(null);
  return (
    <div
      className="nn-sheet-head"
      onPointerDown={(event) => {
        if (event.target.closest("button")) return;
        drag.current = event.clientY;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (drag.current != null && event.clientY - drag.current > 70) mobileUi.setSheet(null);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <span className="nn-sheet-pill" aria-hidden="true" />
      <strong>{title}</strong>
      {children}
      <button type="button" className="nn-sheet-close" onClick={() => mobileUi.setSheet(null)} aria-label={`Close ${title}`}>
        CLOSE <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/* [2D | USGS | 3D] map switch on phones (< 768 px): one full-height map at a time. */
export function MapViewToggle({ is3dOpen = false, onSet3d }) {
  const { mapView } = useMobileUi();
  const current = is3dOpen ? "3d" : mapView;
  return (
    <div className="nn-mapview-toggle" role="radiogroup" aria-label="Map view">
      {[
        ["2d", "2D"],
        ["usgs", "USGS"],
        ["3d", "3D"],
      ].map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={current === id}
          className={current === id ? "is-active" : undefined}
          onClick={() => {
            if (id === "3d") return onSet3d?.(true);
            mobileUi.setMapView(id);
            if (is3dOpen) onSet3d?.(false);
            return undefined;
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* SOL pill for the phone header: tap to open the full sol scrubber in a floating popover. */
export function SolPill({ sol, seasonLs, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => !ref.current?.contains(event.target) && setOpen(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div className="nn-solpill" ref={ref}>
      <button type="button" className="nn-solpill-btn" aria-expanded={open} aria-label={`Active sol ${sol ?? ""}; open the sol scrubber`} onClick={() => setOpen((v) => !v)}>
        SOL {sol ?? "n/a"}
      </button>
      {open && (
        <div className="nn-solpill-pop" role="dialog" aria-label="Active sol">
          {children}
          {seasonLs != null && <small>MY34 scenario · Ls {seasonLs.toFixed(0)}°</small>}
        </div>
      )}
    </div>
  );
}
