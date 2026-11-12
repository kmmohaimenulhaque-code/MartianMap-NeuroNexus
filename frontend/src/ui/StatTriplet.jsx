/*
 * StatTriplet — the one way NeuroNexus shows statistics:
 *   LABEL | AT SITE | MIN · MEAN · MAX
 * `flag` colours a cell amber/red only from backend thresholds.
 */

import { fmt } from "./format";

export function StatTable({ columns = ["AT SITE", "MIN", "MEAN", "MAX"], rows, basis, missingReason = "no data" }) {
  return (
    <div className="nn-stat-table" role="table">
      <div className="nn-stat-row nn-stat-head" role="row">
        <span role="columnheader" />
        {columns.map((c) => (
          <span key={c} role="columnheader" className={c === "AT SITE" ? "nn-at-site" : undefined}>
            {c}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div className="nn-stat-row" role="row" key={row.label}>
          <span role="rowheader" className="nn-stat-label">
            {row.label}
            {row.unit && <small> {row.unit}</small>}
          </span>
          {row.values.map((value, index) => {
            const text = fmt(value, row.digits ?? 1);
            return (
              <span
                key={columns[index]}
                role="cell"
                className={[columns[index] === "AT SITE" ? "nn-at-site" : "", row.flags?.[index] ? `nn-flag-${row.flags[index]}` : ""].join(" ")}
                title={text === null ? missingReason : undefined}
              >
                {text ?? "n/a"}
              </span>
            );
          })}
        </div>
      ))}
      {basis && <div className="nn-stat-basis">{basis}</div>}
    </div>
  );
}

export function ProvenanceTag({ dataClass, source }) {
  return (
    <span className={`nn-prov nn-prov-${String(dataClass).toLowerCase()}`} title={source}>
      {dataClass}
    </span>
  );
}
