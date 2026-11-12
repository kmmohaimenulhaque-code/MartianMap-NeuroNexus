/* MAP LEGEND: keys for the active layers only, each with its source tag. */

import SourceTag from "../sources/SourceTag";
import { activeLayers, LEGEND } from "./layers/layerCatalog";

function Swatch({ kind, token }) {
  const color = token ? `var(${token})` : undefined;
  if (kind === "line") return <i className="nn-sw nn-sw--line" style={{ background: color }} />;
  if (kind === "outline") return <i className="nn-sw nn-sw--outline" style={{ borderColor: color }} />;
  if (kind === "outline-dashed") return <i className="nn-sw nn-sw--outline nn-sw--dashed" style={{ borderColor: color }} />;
  if (kind === "ring") return <i className="nn-sw nn-sw--ring" style={{ borderColor: color }} />;
  if (kind === "dot-scale") {
    return (
      <span className="nn-sw-scale">
        {[4, 7, 10].map((s) => (
          <i key={s} className="nn-sw nn-sw--dot" style={{ background: color, width: s, height: s }} />
        ))}
      </span>
    );
  }
  if (kind === "ramp-mola") return <i className="nn-sw nn-sw--ramp nn-sw--ramp-mola" />;
  if (kind === "ramp-dust") return <i className="nn-sw nn-sw--ramp nn-sw--ramp-dust" />;
  return <i className="nn-sw nn-sw--dot" style={{ background: color }} />;
}

/* Button (docked=false) or the legend body docked in the map's bottom-left corner (docked). */
export default function DynamicMapLegend({ visibility, open, onToggle, docked = false }) {
  const layers = activeLayers(visibility);
  if (!docked) {
    return (
      <div className="nn-legend">
        <button type="button" className="mission-action" aria-expanded={open} onClick={onToggle}>
          MAP LEGEND {open ? "▴" : "▾"}
        </button>
      </div>
    );
  }
  return (
    <div className="nn-legend-dock">
      {open && (
        <div className="nn-legend-body" aria-label="Legend for active layers">
          {layers.length === 0 && <span className="nn-dim">No active layers.</span>}
          {layers.map((layer) => (
            <div key={layer.id} className="nn-legend-group">
              {(LEGEND[layer.id] ?? []).map((item) => (
                <div key={item.label} className="nn-legend-item">
                  <Swatch kind={item.swatch} token={item.token} />
                  <span>{item.label}</span>
                </div>
              ))}
              <SourceTag ledgerId={layer.ledgerId} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
