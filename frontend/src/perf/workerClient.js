/*
 * Runs Marswalk math in the worker when available and enabled, otherwise on the main thread with the
 * same functions (identical results). Grid buffers are transferred once per window, not per call.
 */
import { evaluateProfile, lttb, trackFromGrids } from "../marswalk/marswalkMath.js";
import { perfStore } from "./perfStore.js";
import { setWorkerLatency, trackBuffer } from "./telemetry.js";

let worker = null;
let seq = 0;
const pending = new Map();
const localGrids = new Map();
const workerGrids = new Set();

function getWorker() {
  if (worker || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("../workers/marswalkMath.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data;
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      setWorkerLatency(performance.now() - job.t0, "worker");
      if (ok) job.resolve(result);
      else job.reject(new Error(error));
    };
    worker.onerror = () => {
      setWorkerLatency(null, "worker failed: main-thread fallback");
      worker = null;
      workerGrids.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function runOnMainThread(op, payload) {
  if (op === "evaluate") return evaluateProfile(payload.ds, payload.dz, payload.rough, payload.v);
  if (op === "track") {
    const grids = localGrids.get(payload.gridsKey) ?? payload.grids;
    const track = trackFromGrids(payload.localPts, grids, payload.step);
    return { ...evaluateProfile(track.ds, track.dz, track.rough, payload.v), pts: track.pts };
  }
  if (op === "lttb") return Uint32Array.from(lttb(payload.xs, payload.ys, payload.threshold));
  throw new Error(`unknown op ${op}`);
}

function post(w, op, payload, transfer) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, t0: performance.now() });
    w.postMessage({ id, op, payload }, transfer);
  });
}

/* Register a window's display grids; the worker receives transferred copies (the page keeps its own). */
export function setGrids(key, grids) {
  localGrids.set(key, grids);
  trackBuffer(`grids:${key}`, Object.values(grids).reduce((a, g) => a + (g?.values?.byteLength ?? 0), 0));
  const w = perfStore.enabled("workerMath") ? getWorker() : null;
  if (!w || workerGrids.has(key)) return Promise.resolve();
  const copies = {};
  const transfer = [];
  for (const [name, g] of Object.entries(grids)) {
    if (!g) continue;
    const values = g.values.slice();
    copies[name] = { ...g, values };
    transfer.push(values.buffer);
  }
  workerGrids.add(key);
  return post(w, "grids", { key, grids: copies }, transfer);
}

export function runMath(op, payload, transfer = []) {
  const w = perfStore.enabled("workerMath") ? getWorker() : null;
  if (!w || (op === "track" && !workerGrids.has(payload.gridsKey))) {
    const t0 = performance.now();
    const result = runOnMainThread(op, payload);
    setWorkerLatency(performance.now() - t0, "main thread");
    return Promise.resolve(result);
  }
  return post(w, op, payload, transfer);
}
