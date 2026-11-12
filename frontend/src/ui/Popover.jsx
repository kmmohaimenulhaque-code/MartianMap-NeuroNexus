/* HUD popover card for long explanations, methodology notes and full product ids (click, hover or focus). */

import { useEffect, useId, useRef, useState } from "react";

import FloatingCard from "./FloatingCard";
import Icon from "./Icon";

export default function Popover({ label = "INFO", title, children, align = "left", className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const cardRef = useRef(null);
  const closeTimer = useRef(0);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const inside = (t) => ref.current?.contains(t) || cardRef.current?.contains(t);
    const onDown = (e) => !inside(e.target) && setOpen(false);
    // Capture phase: Esc closes only this card, not the drawer or sheet it was opened from.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  // The card lives on <body>, so hover leaves the trigger on the way to it: close after a short grace period.
  const openedAt = useRef(0);
  // Hover opens and closes only for a mouse; touch and pen use tap (click) and tap-outside.
  const hoverIn = (event) => {
    if (event?.pointerType && event.pointerType !== "mouse") return;
    clearTimeout(closeTimer.current);
    if (!open) openedAt.current = Date.now();
    setOpen(true);
  };
  // A tap fires mouseenter and then click: a click right after a hover-open keeps the card open.
  const onClick = () => (Date.now() - openedAt.current < 500 ? setOpen(true) : setOpen((v) => !v));
  const hoverOut = (event) => {
    if (event?.pointerType && event.pointerType !== "mouse") return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  return (
    <span className={`nn-pop-wrap ${className}`.trim()} ref={ref} onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
      <button type="button" className="nn-pop-trigger" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onClick}>
        <Icon name="info" size={13} /> {label}
      </button>
      {open && (
        <FloatingCard
          ref={cardRef}
          anchorRef={ref}
          align={align}
          className={`nn-pop-card nn-pop-card--${align}`}
          role="dialog"
          id={id}
          aria-label={title}
          onPointerEnter={hoverIn}
          onPointerLeave={hoverOut}
        >
          {title && <strong className="nn-pop-title">{title}</strong>}
          <span className="nn-pop-body">{children}</span>
        </FloatingCard>
      )}
    </span>
  );
}
