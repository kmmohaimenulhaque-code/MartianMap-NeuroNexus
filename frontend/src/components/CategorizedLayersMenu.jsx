/*
 * LAYERS: one shared menu for the three maps (2D, ArcGIS, 3D). Every row toggles the same shared layer
 * (components/layers/layerStore.js), shows which maps can draw it (2D · ARCGIS · 3D, the current map
 * highlighted), an opacity slider for overlays, any load status and its source tag.
 */

import Icon from "../ui/Icon";
import { useEffect, useRef, useState } from "react";

import SourceTag from "../sources/SourceTag";
import { LAYER_CATEGORIES, MAPS } from "./layers/layerCatalog";
import { layerStore, useLayers } from "./layers/layerStore";

export default function CategorizedLayersMenu({ map = "2d", onLink, status = {}, compact = false, align = "right" }) {
  const { visibility, opacity } = useLayers();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => ref.current && !ref.current.contains(event.target) && setOpen(false);
    const onKey = (event) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const activeCount = LAYER_CATEGORIES.flatMap((c) => c.layers).filter((l) => l.kind === "map" && l.maps.includes(map) && visibility[l.id]).length;
  return (
    <div className={`nn-layers nn-layers--${map}`} ref={ref}>
      <button
        type="button"
        className={`mission-action${compact ? " nn-icon-btn" : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Map layers, ${activeCount} on this map`}
        data-testid={`layers-${map}`}
        onClick={() => setOpen((v) => !v)}
      >
        {compact ? <Icon name="layers" size={18} /> : <>LAYERS ({activeCount}) ▾</>}
      </button>
      {open && (
        <div className={`nn-layers-menu nn-layers-menu--${align}`} role="menu" aria-label={`Layers shared by the 2D, ArcGIS and 3D maps (this map: ${MAPS[map]})`}>
          <p className="nn-layers-note">Shared by the 2D, ARCGIS and 3D maps: a layer turned on here is on everywhere it can be drawn.</p>
          {LAYER_CATEGORIES.map((category) => (
            <details key={category.id} open>
              <summary>{category.label}</summary>
              {category.layers.map((layer) =>
                layer.kind === "map" ? (
                  <div key={layer.id} className={`nn-layer-row${layer.maps.includes(map) ? "" : " is-elsewhere"}`} data-layer={layer.id}>
                    <label className="nn-layer-main">
                      <input type="checkbox" checked={Boolean(visibility[layer.id])} onChange={() => layerStore.toggle(layer.id)} />
                      <span>{layer.label}</span>
                    </label>
                    <span className="nn-layer-maps" aria-label={`Drawn on ${layer.maps.map((m) => MAPS[m]).join(", ")}`}>
                      {Object.entries(MAPS).map(([id, label]) => (
                        <i key={id} className={`${layer.maps.includes(id) ? "is-on" : ""}${id === map ? " is-here" : ""}`}>
                          {label}
                        </i>
                      ))}
                    </span>
                    {layer.opacity != null && visibility[layer.id] && (
                      <label className="nn-layer-opacity">
                        <span>OPACITY {Math.round((opacity[layer.id] ?? layer.opacity) * 100)}%</span>
                        <input
                          type="range"
                          min={5}
                          max={100}
                          step={5}
                          value={Math.round((opacity[layer.id] ?? layer.opacity) * 100)}
                          aria-label={`${layer.label} opacity`}
                          onChange={(event) => layerStore.setOpacity(layer.id, Number(event.target.value) / 100)}
                        />
                      </label>
                    )}
                    {status[layer.id] && <small className="nn-layer-status">{status[layer.id]}</small>}
                    <SourceTag ledgerId={layer.ledgerId} compact />
                  </div>
                ) : (
                  <div key={layer.id} className="nn-layer-row nn-layer-link">
                    <button type="button" className="nn-layer-linkbtn" onClick={() => onLink?.(layer.action)}>
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
