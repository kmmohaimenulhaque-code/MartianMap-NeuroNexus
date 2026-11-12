/* LAYERS ▾: collapsible categories of map layers; every row carries its 🏷️ source tag. */

import { useEffect, useRef, useState } from "react";

import SourceTag from "../sources/SourceTag";
import { LAYER_CATEGORIES } from "./layers/layerCatalog";

export default function CategorizedLayersMenu({ visibility, onToggle, onLink, status = {} }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => ref.current && !ref.current.contains(event.target) && setOpen(false);
    const onKey = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const activeCount = Object.values(visibility).filter(Boolean).length;
  return (
    <div className="nn-layers" ref={ref}>
      <button type="button" className="mission-action" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        LAYERS ({activeCount}) ▾
      </button>
      {open && (
        <div className="nn-layers-menu" role="menu" aria-label="Map layers by category">
          {LAYER_CATEGORIES.map((category) => (
            <details key={category.id} open>
              <summary>{category.label}</summary>
              {category.layers.map((layer) =>
                layer.kind === "map" ? (
                  <label key={layer.id} className="nn-layer-row">
                    <input type="checkbox" checked={Boolean(visibility[layer.id])} onChange={() => onToggle(layer.id)} />
                    <span>{layer.label}</span>
                    {status[layer.id] && <small className="nn-layer-status">{status[layer.id]}</small>}
                    <SourceTag ledgerId={layer.ledgerId} compact />
                  </label>
                ) : (
                  <div key={layer.id} className="nn-layer-row nn-layer-link">
                    <button type="button" className="mw-link" onClick={() => onLink(layer.action)}>
                      {layer.label} →
                    </button>
                    <SourceTag ledgerId={layer.ledgerId} compact />
                  </div>
                ),
              )}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
