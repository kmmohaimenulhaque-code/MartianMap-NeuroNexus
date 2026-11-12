/*
 * PARAMETER SENSITIVITY: the planned route (its own polyline, no re-search) re-evaluated with each planning slider
 * set to its low and then its high bound, all other settings unchanged. Bars show the change in walk-back margin
 * against the same route at the current settings; a status chip appears where the status changes. It shows
 * which planning choices drive the result; it is not an uncertainty estimate.
 */
import { useEffect, useRef, useState } from "react";

import SourceTag from "../sources/SourceTag";
import { routePolyline } from "./decision";
import { marswalkApi } from "./marswalkApi";
import { CLASS_TOKENS, tokenColor } from "./walkabilityRamp";

const SHORT = { "WITHIN PLANNING LIMITS": "WITHIN", "REVIEW REQUIRED": "REVIEW", "EXCEEDS PLANNING LIMIT": "EXCEEDS" };

async function pool(tasks, size) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next;
      next += 1;
      results[i] = await tasks[i]().catch((error) => ({ error: error.message }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return results;
}

const fmtMin = (h) => (h == null || !Number.isFinite(h) ? "n/a" : `${h >= 0 ? "+" : "−"}${Math.abs(Math.round(h * 60))} min`);

export default function Sensitivity({ plan, evaHours, mode, overrides, config, sliders, runSignal = 0 }) {
  const [state, setState] = useState({ key: "", rows: null, base: null, loading: false, error: "" });
  const lastSignal = useRef(runSignal);
  const key = plan?.plan_id ? `${plan.plan_id}|${evaHours}|${mode}|${JSON.stringify(overrides)}` : "";

  const run = async () => {
    const polyline = routePolyline(plan);
    if (!config || polyline.length < 2) return;
    setState({ key, rows: null, base: null, loading: true, error: "" });
    const evaluate = (ov) => () => marswalkApi.evaluate({ polyline, eva_hours: evaHours, terrain_mode: mode, overrides: ov });
    try {
      const base = await evaluate({ ...overrides })();
      const params = sliders.filter(([k]) => config.bounds?.[k]);
      const tasks = params.flatMap(([k]) => config.bounds[k].map((bound) => evaluate({ ...overrides, [k]: bound })));
      const results = await pool(tasks, 3);
      const rows = params.map(([k, label], i) => {
        const unit = config.parameters?.[k]?.unit ?? "";
        const current = overrides[k] ?? config.parameters?.[k]?.value;
        const ends = config.bounds[k].map((bound, j) => {
          const r = results[i * 2 + j];
          return r?.error
            ? { bound, error: r.error }
            : { bound, margin: r?.budget?.margin_h, status: r?.status?.value, delta: r?.budget?.margin_h != null && base?.budget?.margin_h != null ? r.budget.margin_h - base.budget.margin_h : null };
        });
        return { key: k, label, unit, current, ends };
      });
      setState({ key, rows, base, loading: false, error: "" });
    } catch (error) {
      setState({ key, rows: null, base: null, loading: false, error: error.message });
    }
  };

  // The wheel / Command Index "SENSITIVITY" action bumps runSignal.
  useEffect(() => {
    if (runSignal !== lastSignal.current) {
      lastSignal.current = runSignal;
      run();
    }
  });

  if (!plan?.plan_id) return null;
  const current = state.key === key ? state : { rows: null, base: null, loading: false, error: "" };
  const maxAbs = Math.max(0.25, ...(current.rows ?? []).flatMap((r) => r.ends.map((e) => Math.abs(e.delta ?? 0))));
  const baseStatus = current.base?.status?.value;

  return (
    <section className="mw-card mw-sensitivity" id="mw-sensitivity" data-testid="sensitivity">
      <h3>
        PARAMETER SENSITIVITY
        <SourceTag ledgerId="NEURONEXUS_MARSWALK_PARAMETERS" compact />
      </h3>
      {!current.rows && !current.loading && (
        <>
          <p className="mw-dim">Re-evaluates this route with each planning slider at its low and high bound (all else unchanged) and shows how the walk-back margin and status change.</p>
          <button type="button" className="mw-sens-run" onClick={run} disabled={!config}>
            RUN SENSITIVITY ({sliders.length * 2 + 1} evaluations)
          </button>
        </>
      )}
      {current.loading && <p className="mw-skeleton">Evaluating the route at {sliders.length * 2} slider bounds…</p>}
      {current.error && <p className="mw-error">UNAVAILABLE · {current.error}</p>}
      {current.rows && (
        <>
          <p className="mw-dim">
            Same route at current settings: margin {fmtMin(current.base?.budget?.margin_h)} · {SHORT[baseStatus] ?? baseStatus ?? "n/a"}. Bars: change in margin at each bound.
          </p>
          <div className="mw-sens-rows">
            {current.rows.map((row) => (
              <div className="mw-sens-row" key={row.key}>
                <span className="mw-sens-label">
                  {row.label} <small>(now {row.current} {row.unit})</small>
                </span>
                {row.ends.map((end, j) => {
                  const width = end.delta == null ? 0 : (Math.min(1, Math.abs(end.delta) / maxAbs) * 50).toFixed(1);
                  return (
                    <div className="mw-sens-end" key={j}>
                      <small className="mw-sens-bound">{j === 0 ? "LOW" : "HIGH"} {end.bound} {row.unit}</small>
                      <div className="mw-sens-track" aria-label={`${row.label} at ${end.bound} ${row.unit}: margin change ${fmtMin(end.delta)}`}>
                        <i className={end.delta < 0 ? "is-neg" : "is-pos"} style={{ width: `${width}%`, [end.delta < 0 ? "right" : "left"]: "50%" }} />
                      </div>
                      <small className="mw-sens-delta" title={end.error || undefined}>{end.error ? "not valid" : fmtMin(end.delta)}</small>
                      {end.error && <small className="mw-sens-why">{end.error}</small>}
                      {end.status && end.status !== baseStatus && (
                        <b className="mw-sens-status" style={{ color: tokenColor(CLASS_TOKENS[end.status]) }}>
                          {SHORT[end.status] ?? end.status}
                        </b>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <button type="button" className="mw-sens-run" onClick={run}>
            RE-RUN
          </button>
        </>
      )}
    </section>
  );
}
