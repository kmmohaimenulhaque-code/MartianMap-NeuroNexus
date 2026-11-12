/* Browser Optimization: opt-in low-RAM mode (OFF by default), presets, toggles and live telemetry. */

import { detectWebGLMode } from "./mars3d/arcgisLoader";
import { useState } from "react";

import SourceTag from "../sources/SourceTag";
import { PRESETS, TOGGLES, autoReason, deviceMemoryGb, isOptimizationOn, perfStore } from "../perf/perfStore";
import { tileCache } from "../perf/tileCache";
import { usePerfSettings, useTelemetry } from "../perf/usePerf";

const mb = (v) => (v == null ? "n/a" : `${v.toFixed(1)} MB`);

export function TelemetryPill({ onOpen }) {
  const t = useTelemetry(true);
  const { state } = usePerfSettings();
  return (
    <button type="button" className="perf-pill" onClick={onOpen} title="Browser Optimization telemetry">
      [PERF] {t.fps ? `${Math.round(t.fps)} FPS` : "– FPS"} · {t.heap.estimated ? "≈" : ""}
      {Math.round(t.heap.mb)} MB · {isOptimizationOn(state) ? "OPTIMIZED" : "FULL FIDELITY"}
    </button>
  );
}

export default function BrowserOptimizationPanel() {
  const { state, toggles } = usePerfSettings();
  const t = useTelemetry(true);
  const [purged, setPurged] = useState("");
  const memory = deviceMemoryGb();
  const [webgl] = useState(() => detectWebGLMode());
  return (
    <div className="perf-panel">
      <button
        type="button"
        className={`perf-master${isOptimizationOn(state) ? " is-on" : ""}`}
        aria-pressed={isOptimizationOn(state)}
        onClick={() => perfStore.toggle()}
      >
        <span>[BROWSER OPTIMIZATION]</span>
        <strong>{isOptimizationOn(state) ? "ON · LOW-RAM MODE" : "OFF · MAX FIDELITY"}</strong>
      </button>
      <p className="perf-note">
        Off by default. Turn it on for 4 GB RAM or low-end devices: worker math, IndexedDB tile cache, WebGL suspension when the
        globe is hidden and marker culling. Every computed number stays identical.
      </p>
      <p className="perf-note" data-testid="webgl-status">
        3D RENDERING ·{" "}
        {webgl === "hardware"
          ? "HARDWARE WEBGL"
          : webgl === "software"
            ? "SOFTWARE WEBGL (no hardware acceleration: the 3D globe works, more slowly)"
            : "NO WEBGL (the 3D view shows a 2D canvas globe instead)"}
      </p>
      <div className="perf-presets" role="radiogroup" aria-label="Optimization preset">
        {[
          ["MAX_FIDELITY", `${PRESETS.MAX_FIDELITY.label} (DEFAULT)`],
          ["LOW_RAM", PRESETS.LOW_RAM.label],
          ["AUTO", "AUTO / ADAPTIVE"],
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
        {/* Only when the browser exposes it (Chromium rounds it to a privacy bucket, at most 8 GB); never a default. */}
        {memory != null && (
          <>
            <dt>Device memory</dt>
            <dd>{`about ${memory} GB (navigator.deviceMemory, rounded by the browser)`}</dd>
          </>
        )}
        <dt>Worker</dt>
        <dd data-testid="perf-worker">
          {toggles.workerMath
            ? `READY · offload active${t.worker.latencyMs != null ? ` · last job ${t.worker.latencyMs.toFixed(1)} ms` : " · no job yet"}`
            : "STANDBY · main thread"}
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
