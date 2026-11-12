/* VALIDATION scorecard: headline numbers read only from validation/reports/latest.json. */

import { useEffect, useState } from "react";

import SourceTag from "../sources/SourceTag";
import { marswalkApi } from "./marswalkApi";

const ci = (m) => (m?.ci95 ? ` [${m.ci95[0].toFixed(2)}, ${m.ci95[1].toFixed(2)}]` : "");

export default function ValidationPanel({ site }) {
  const [state, setState] = useState({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    marswalkApi
      .validation({ signal: controller.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => error.name !== "AbortError" && setState({ status: "error", error: error.message }));
    return () => controller.abort();
  }, []);
  if (state.status === "loading") return <section className="mw-card mw-skeleton">VALIDATION · loading…</section>;
  if (state.status === "error") {
    return (
      <section className="mw-card">
        <h3>VALIDATION</h3>
        <p className="mw-error">UNAVAILABLE · {state.error}</p>
      </section>
    );
  }
  const report = state.data;
  const s = report.sites?.[site];
  if (!s) return <section className="mw-card"><h3>VALIDATION</h3><p className="mw-dim">No report for {site}.</p></section>;
  const headline = s.headline ?? [];
  return (
    <section className="mw-card">
      <h3>
        VALIDATION · {site.toUpperCase()} <SourceTag ledgerId="NEURONEXUS_VALIDATION_SUITE" detail={`run ${report.run_id}`} compact />
      </h3>
      {headline.map((h) => (
        <div className="mw-row" key={h.id}>
          <span className="mw-row-label">{h.id} {h.label}</span>
          <strong>
            {h.value}
            {ci(h)}
          </strong>
          <small>n = {h.n?.toLocaleString?.() ?? h.n} · {h.meaning}</small>
        </div>
      ))}
      <small className="mw-dim">{report.caveats?.[0]}</small>
    </section>
  );
}
