/* TERRAIN LADDER chip + source mode: HiRISE 1 m -> CTX 20 m -> MOLA 463 m. */

import SourceTag from "../sources/SourceTag";

const MODES = [
  ["ladder", "LADDER", "HiRISE → CTX → MOLA"],
  ["ctx_mola", "CTX + MOLA", "no HiRISE"],
  ["mola", "MOLA ONLY", "463 m"],
];

function ladderLabel(products) {
  const top = products?.[0];
  if (!top) return "no terrain loaded";
  const gsd = top.family === "MOLA" ? "463 m" : `${Number(top.gsd_m ?? 0).toFixed(1)} m`;
  const name = top.family === "HIRISE" ? "HiRISE" : top.family;
  return `${name} ${gsd} · ${String(top.product_id).slice(0, 26)}${String(top.product_id).length > 26 ? "…" : ""}`;
}

export default function TerrainLadder({ mode, onMode, products, fractions }) {
  const ledger = { HIRISE: "HIRISE_STAC_DTM", CTX: "CTX_STAC_DTM", MOLA: "MOLA_MEGDR" }[products?.[0]?.family] ?? "NEURONEXUS_TERRAIN_LADDER";
  return (
    <div className="mw-ladder">
      <div className="mw-ladder-chip">
        <span>TERRAIN LADDER</span>
        <strong>{ladderLabel(products)}</strong>
        <SourceTag ledgerId={ledger} compact />
      </div>
      {fractions && (
        <div className="mw-ladder-fractions">
          {Object.entries(fractions)
            .filter(([, f]) => f > 0)
            .map(([k, f]) => (
              <span key={k} className={`mw-src mw-src--${k.toLowerCase()}`}>
                {k} {(f * 100).toFixed(0)}%
              </span>
            ))}
        </div>
      )}
      <div className="mw-mode" role="radiogroup" aria-label="Terrain source mode">
        {MODES.map(([key, label, hint]) => (
          <button key={key} type="button" role="radio" aria-checked={mode === key} className={mode === key ? "active" : undefined} onClick={() => onMode(key)} title={hint}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
