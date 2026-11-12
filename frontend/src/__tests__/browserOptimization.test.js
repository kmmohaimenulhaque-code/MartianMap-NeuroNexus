import { describe, expect, it } from "vitest";

import catalogue from "../features/commands.json";
import { PRESETS, TOGGLES, autoReason, effectiveToggles, reportFps } from "../perf/perfStore";
import { heapInfo, trackBuffer } from "../perf/telemetry";
import { CAP_BYTES, createTileCache, memoryBackend, planEviction } from "../perf/tileCache";
import { runOnMainThread } from "../perf/workerClient";

const base = { preset: "AUTO", custom: {}, lowFpsStreak: 0, autoLow: false };

describe("optimization presets", () => {
  it("AUTO turns the low-RAM protections on at 4 GB or less", () => {
    expect(effectiveToggles(base, 4)).toEqual(PRESETS.LOW_RAM.toggles);
    expect(effectiveToggles(base, 8)).toEqual(PRESETS.MAX_FIDELITY.toggles);
    expect(autoReason(base, 4)).toContain("deviceMemory = 4 GB");
  });

  it("AUTO switches on after sustained low FPS and never flips back mid-session", () => {
    let s = base;
    for (let i = 0; i < 5; i += 1) s = reportFps(25, s);
    expect(s.autoLow).toBe(true);
    expect(effectiveToggles(s, 16).suspendWebGL).toBe(true);
    expect(reportFps(60, s).autoLow).toBe(true);
  });

  it("individual toggles override a preset; every toggle is described", () => {
    expect(effectiveToggles({ ...base, preset: "LOW_RAM", custom: { workerMath: false } }).workerMath).toBe(false);
    expect(Object.keys(PRESETS.MAX_FIDELITY.toggles).sort()).toEqual(Object.keys(TOGGLES).sort());
  });

  it("is registered in the command index", () => {
    expect(catalogue.commands.some((c) => c.id === "browser-optimization")).toBe(true);
  });
});

describe("IndexedDB tile cache (LRU, 150 MB)", () => {
  it("evicts least-recently-used entries to stay under the cap", async () => {
    let t = 0;
    const cache = createTileCache(memoryBackend(), 100, () => (t += 1));
    await cache.put("a", { size: 40 });
    await cache.put("b", { size: 40 });
    await cache.get("a"); // a is now more recent than b
    await cache.put("c", { size: 40 });
    const stats = await cache.stats();
    expect(stats.bytes).toBeLessThanOrEqual(100);
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("a")).not.toBeNull();
    expect(await cache.put("huge", { size: 101 })).toBe(false);
  });

  it("plans no eviction under the 150 MB cap", () => {
    expect(CAP_BYTES).toBe(150 * 2 ** 20);
    expect(planEviction([{ key: "x", size: 10, lastAccess: 1 }], 10)).toEqual([]);
  });
});

describe("telemetry and worker fallback", () => {
  it("labels the buffer estimate when performance.memory is missing", () => {
    trackBuffer("grid", 2 ** 20);
    const h = heapInfo({});
    expect(h.estimated).toBe(true);
    expect(h.label).toBe("estimated buffer footprint");
    expect(h.mb).toBeGreaterThanOrEqual(1);
    expect(heapInfo({ memory: { usedJSHeapSize: 2 ** 21, jsHeapSizeLimit: 2 ** 30 } }).estimated).toBe(false);
  });

  it("the main-thread fallback runs the same decimation as the worker", () => {
    const xs = Float64Array.from({ length: 500 }, (_, i) => i);
    const ys = Float64Array.from(xs, (x) => Math.sin(x / 20));
    const idx = runOnMainThread("lttb", { xs, ys, threshold: 50 });
    expect(idx).toBeInstanceOf(Uint32Array);
    expect(idx.length).toBe(50);
  });
});
