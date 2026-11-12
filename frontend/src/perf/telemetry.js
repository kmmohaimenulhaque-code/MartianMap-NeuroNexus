/*
 * Live telemetry: UI frames per second, JS heap (performance.memory, Chromium only; otherwise an
 * estimate of the typed-array buffers NeuroNexus holds, labeled as an estimate), worker latency.
 */

const buffers = new Map();
let workerLatencyMs = null;
let workerStatus = "idle";

export function trackBuffer(name, bytes) {
  if (bytes > 0) buffers.set(name, bytes);
  else buffers.delete(name);
}

export function setWorkerLatency(ms, status = "ready") {
  workerLatencyMs = ms;
  workerStatus = status;
}

export function heapInfo(perf = globalThis.performance) {
  const mem = perf?.memory;
  if (mem && Number.isFinite(mem.usedJSHeapSize)) {
    return { mb: mem.usedJSHeapSize / 2 ** 20, limitMb: mem.jsHeapSizeLimit / 2 ** 20, estimated: false, label: "JS heap" };
  }
  const total = [...buffers.values()].reduce((a, b) => a + b, 0);
  return { mb: total / 2 ** 20, limitMb: null, estimated: true, label: "estimated buffer footprint" };
}

export function workerInfo() {
  return { latencyMs: workerLatencyMs, status: workerStatus };
}

/* rAF frame counter; calls onFps once per second until stopped. */
export function startFpsMeter(onFps, raf = globalThis.requestAnimationFrame, now = () => globalThis.performance.now()) {
  if (!raf) return () => {};
  let frames = 0;
  let last = now();
  let handle = null;
  let running = true;
  const tick = () => {
    if (!running) return;
    frames += 1;
    const t = now();
    if (t - last >= 1000) {
      onFps((frames * 1000) / (t - last));
      frames = 0;
      last = t;
    }
    handle = raf(tick);
  };
  handle = raf(tick);
  return () => {
    running = false;
    if (handle != null) globalThis.cancelAnimationFrame?.(handle);
  };
}
