/* DecisionCard: status rule, time / metabolic / consumables budget, segments and terrain sources. */

import SourceTag from "../sources/SourceTag";
import { CLASS_TOKENS, tokenColor } from "./walkabilityRamp";

const fmt = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? "n/a" : Number(v).toFixed(d));
const hm = (h) => (h == null ? "n/a" : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")} min`);

function Row({ label, value, tag, note }) {
  return (
    <div className="mw-row">
      <span className="mw-row-label">{label}</span>
      <strong>{value}</strong>
      {tag}
      {note && <small>{note}</small>}
    </div>
  );
}

export default function DecisionCard({ plan, estimate, loading, error }) {
  if (loading && !plan) return <section className="mw-card mw-skeleton" aria-busy="true">PLANNING · reading the terrain ladder…</section>;
  if (!plan && !estimate) {
    return (
      <section className="mw-card">
        <h3>DECISION</h3>
        {error ? <p className="mw-error">UNAVAILABLE · {error}</p> : <p className="mw-dim">Click the map to set a target, then PLAN.</p>}
        <p className="mw-dim">Statuses used: WITHIN PLANNING LIMITS · REVIEW REQUIRED · EXCEEDS PLANNING LIMIT. Planning limits are not safety limits.</p>
      </section>
    );
  }
  if (!plan && estimate) {
    return (
      <section className="mw-card">
        <h3>DECISION · CLIENT ESTIMATE</h3>
        <p className="mw-warn">Server planning unavailable{error ? ` (${error})` : ""}: values below are a browser estimate on the cached display grid, not a plan.</p>
        <Row label="Length" value={`${fmt(estimate.length_m, 0)} m`} tag={<SourceTag ledgerId="NEURONEXUS_CLIENT_MATH" compact />} />
        <Row label="Out / back" value={`${hm(estimate.outbound_h)} / ${hm(estimate.return_h)}`} tag={<SourceTag ledgerId="NEURONEXUS_PACE_MODEL" compact />} />
        <Row label="Walk-back margin" value={hm(estimate.margin_h)} tag={<SourceTag ledgerId="NEURONEXUS_PNR_MODEL" compact />} />
      </section>
    );
  }
  const s = plan.summary;
  const b = plan.budget;
  const status = plan.status.value;
  return (
    <section className="mw-card" aria-live="polite">
      <h3>DECISION {loading && <small className="mw-dim">· updating…</small>}</h3>
      <div className="mw-status" style={{ borderColor: tokenColor(CLASS_TOKENS[status]), color: tokenColor(CLASS_TOKENS[status]) }}>
        <span className={status === "EXCEEDS PLANNING LIMIT" ? "mw-hatch-chip" : undefined}>{status}</span>
        <SourceTag ledgerId="NEURONEXUS_MARSWALK_PARAMETERS" compact />
      </div>
      {plan.status.reasons.length > 0 && (
        <ul className="mw-reasons">
          {plan.status.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <details className="mw-rule">
        <summary>Status rule</summary>
        <p>{plan.status.rule_text}</p>
      </details>
      <Row label="Length" value={`${fmt(s.length_m.value, 0)} m`} tag={<SourceTag ledgerId="NEURONEXUS_MARSWALK_PLANNER" compact />} note={`straight line ${fmt(plan.method?.straight_line_m, 0)} m`} />
      <Row label="Gain / loss" value={`+${fmt(s.elevation_gain_m.value, 0)} / −${fmt(s.elevation_loss_m.value, 0)} m`} tag={<SourceTag ledgerId="NEURONEXUS_TERRAIN_LADDER" compact />} />
      <Row label="Max slope" value={`${fmt(s.max_slope_3m_deg.value)}° @3 m · ${fmt(s.max_slope_1m_deg.value)}° @1 m`} tag={<SourceTag ledgerId="NEURONEXUS_SLOPE_MULTI_BASELINE" compact />} />
      <Row label="Outbound / return" value={`${hm(b.outbound_h)} / ${hm(b.return_h)}`} tag={<SourceTag ledgerId="NEURONEXUS_PACE_MODEL" compact />} note={`${b.pace_model} pace`} />
      <Row
        label="Walk-back margin"
        value={hm(b.margin_h)}
        tag={<SourceTag ledgerId="NEURONEXUS_PNR_MODEL" compact />}
        note={`usable ${hm(b.usable_h)} of ${b.eva_h} h EVA, reserve ${hm(b.reserve_h)}`}
      />
      <Row
        label="Turnaround (PNR)"
        value={plan.turnaround.reached_target ? "target within budget" : `${fmt(plan.turnaround.distance_m, 0)} m along track`}
        tag={<SourceTag ledgerId="NEURONEXUS_PNR_MODEL" compact />}
      />
      <Row
        label="Metabolic (round trip)"
        value={`${fmt(b.metabolic_kcal_est, 0)} kcal (${fmt(b.round_trip.metabolic_kcal_est.low, 0)}–${fmt(b.round_trip.metabolic_kcal_est.high, 0)})`}
        tag={<SourceTag ledgerId="NEURONEXUS_METABOLIC_PROXY" evidence="MODELED" compact />}
      />
      <Row
        label="O₂ / cooling water"
        value={`${fmt(b.o2_kg_est, 3)} kg · ${fmt(b.water_l_est, 2)} L`}
        tag={<SourceTag ledgerId="NEURONEXUS_METABOLIC_PROXY" evidence="MODELED" compact />}
        note={b.label}
      />
      <div className="mw-row">
        <span className="mw-row-label">Segments</span>
        <span className="mw-seg-counts">
          {Object.entries(s.segments_by_class).map(([cls, v]) => (
            <span key={cls} style={{ color: tokenColor(CLASS_TOKENS[cls]) }}>
              {cls.split(" ")[0]} {v.count}× · {fmt(v.length_m, 0)} m
            </span>
          ))}
        </span>
      </div>
      <div className="mw-row">
        <span className="mw-row-label">Terrain source</span>
        <span className="mw-seg-counts">
          {Object.entries(s.length_by_source_pct).map(([src, pct]) => (
            <span key={src}>
              {src} {fmt(pct, 1)}% <SourceTag ledgerId={{ HIRISE: "HIRISE_STAC_DTM", CTX: "CTX_STAC_DTM", MOLA: "MOLA_MEGDR" }[src] ?? "NEURONEXUS_TERRAIN_LADDER"} compact />
            </span>
          ))}
        </span>
      </div>
      {plan.warnings.length > 0 && <p className="mw-warn">{plan.warnings.join(" · ")}</p>}
      {estimate && <p className="mw-dim">Browser estimate during edit: {fmt(estimate.length_m, 0)} m, margin {hm(estimate.margin_h)} (server result replaces it).</p>}
    </section>
  );
}
