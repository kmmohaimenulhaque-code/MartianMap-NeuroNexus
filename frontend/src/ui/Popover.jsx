/* HUD popover card for long explanations, methodology notes and full product ids (click, hover or focus). */

import { useEffect, useId, useRef, useState } from "react";

import Icon from "./Icon";

export default function Popover({ label = "INFO", title, children, align = "left", className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className={`nn-pop-wrap ${className}`.trim()} ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="nn-pop-trigger" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((v) => !v)}>
        <Icon name="info" size={13} /> {label}
      </button>
      {open && (
        <span className={`nn-pop-card nn-pop-card--${align}`} role="dialog" id={id} aria-label={title}>
          {title && <strong className="nn-pop-title">{title}</strong>}
          <span className="nn-pop-body">{children}</span>
        </span>
      )}
    </span>
  );
}
