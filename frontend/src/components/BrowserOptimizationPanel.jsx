/* Browser Optimization: presets, individual toggles and live telemetry (🍔 menu + top-bar pill). */

import { useState } from "react";

import SourceTag from "../sources/SourceTag";
import { PRESETS, TOGGLES, autoReason, deviceMemoryGb, perfStore } from "../perf/perfStore";
import { tileCache } from "../perf/tileCache";
import { usePerfSettings, useTelemetry } from "../perf/usePerf";

const mb = (v) => (v == null ? "n/a" : `${v.toFixed(1)} MB`);

export function TelemetryPill({ onOpen }) {
  const t = useTelemetry(true);
  const { state } = usePerfSettings();
  return (
    <button type="button" className="perf-pill" onClick={onOpen} title="Browser Optimization telemetry">
      ⚡ {t.fps ? `${Math.round(t.fps)} FPS` : "– FPS"} · {t.heap.estimated ? "≈" : ""}
      {Math.round(t.heap.mb)} MB · {state.preset === "AUTO" ? "AUTO" : PRESETS[state.preset].label.split(" ")[0]}
    </button>
  );
}

export default function BrowserOptimizationPanel() {
  const { state, toggles } = usePerfSettings();
  const t = useTelemetry(true);
  const [purged, setPurged] = useState("");
  const memory = deviceMemoryGb();
  return (
    <div className="perf-panel">
      <div className="perf-presets" role="radiogroup" aria-label="Optimization preset">
        {[
          ["AUTO", "AUTO / ADAPTIVE"],
          ["LOW_RAM", PRESETS.LOW_RAM.label],
          ["MAX_FIDELITY", PRESETS.MAX_FIDELITY.label],
        ].map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={state.preset === key} className={state.preset === key ? "active" : undefined} onClick={() => perfStore.setPreset(key)}>
            {label}
          </button>
        ))}
      </div>
      {state.preset === "AUTO" && <p className="perf-note">AUTO: {autoReason(state)}</p>}
      <ul className="perf-toggles">
        {Object.entries(TOGGLES).map(([key, label]) => (
          <li key={key}>
            <label>
              <input type="checkbox" checked={Boolean(toggles[key])} onChange={(e) => perfStore.setToggle(key, e.target.checked)} />
              {label}
            </label>
          </li>
        ))}
      </ul>
      <dl className="perf-telemetry">
        <dt>UI frame rate</dt>
        <dd>{t.fps ? `${t.fps.toFixed(0)} FPS` : "measuring…"}</dd>
        <dt>{t.heap.label}</dt>
        <dd>
          {mb(t.heap.mb)}
          {t.heap.limitMb ? ` of ${mb(t.heap.limitMb)}` : ""}
          {t.heap.estimated ? " (estimate: performance.memory is Chromium-only)" : ""}
        </dd>
        <dt>Device memory</dt>
        <dd>{memory != null ? `${memory} GB (navigator.deviceMemory)` : "not exposed by this browser"}</dd>
        <dt>Worker</dt>
        <dd>
          {t.worker.status}
          {t.worker.latencyMs != null ? ` · last job ${t.worker.latencyMs.toFixed(1)} ms` : ""}
        </dd>
        <dt>IndexedDB tile cache</dt>
        <dd>{t.cache ? `${mb(t.cache.bytes / 2 ** 20)} in ${t.cache.entries} entries (cap ${mb(t.cache.capBytes / 2 ** 20)})${t.cache.unavailable ? " · unavailable" : ""}` : "…"}</dd>
      </dl>
      <button
        type="button"
        className="nn-tag-link"
        onClick={() =>
          tileCache()
            .purge()
            .then(() => setPurged("Local cache purged."))
        }
      >
        Purge Local Cache
      </button>
      {purged && <span className="perf-note"> {purged}</span>}
      <p className="perf-note">
        No setting changes a computed number: the worker runs the same formulas as the backend (parity-tested). <SourceTag ledgerId="NEURONEXUS_CLIENT_MATH" compact />
      </p>
    </div>
  );
}
