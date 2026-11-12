import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyRequest, createFetchTracker, installFetchTracker, isIgnoredPath, labelFor } from "../state/fetchTracker";

const ORIGINS = { origins: ["https://martian-map-api.example.org"] };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const response = (status = 200, statusText = "") => ({ ok: status >= 200 && status < 300, status, statusText });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchTracker labels and ignore list", () => {
  it("maps known backend paths to readable names, falling back to the path", () => {
    expect(labelFor("/marswalk/plan")).toBe("MARSWALK route plan");
    expect(labelFor("/marswalk/evaluate")).toBe("Route evaluation");
    expect(labelFor("/terrain/hires/image")).toBe("HiRISE terrain window");
    expect(labelFor("/terrain/window")).toBe("MOLA terrain window");
    expect(labelFor("/environment/by-place")).toBe("Site environment");
    expect(labelFor("/places")).toBe("USGS place list");
    expect(labelFor("/conditions")).toBe("Conditions at sol");
    expect(labelFor("/dust/timeseries")).toBe("Dust time series");
    expect(labelFor("/thermal/samples")).toBe("THEMIS samples");
    expect(labelFor("/rovers/msl/traverse")).toBe("Rover traverses");
    expect(labelFor("/rovers/m2020/waypoints")).toBe("Rover waypoints");
    expect(labelFor("/usgs/sync")).toBe("USGS map sync");
    expect(labelFor("/media/rover-photos")).toBe("Rover photos");
    expect(labelFor("/sources")).toBe("Source ledger");
    expect(labelFor("/something/new")).toBe("/something/new");
    // Prefix match is on whole segments only.
    expect(labelFor("/placesx")).toBe("/placesx");
  });

  it("ignores polling and background paths", () => {
    for (const path of ["/health", "/ai/status", "/dust/map", "/briefing/mars", "/briefing"]) {
      expect(isIgnoredPath(path)).toBe(true);
    }
    for (const path of ["/marswalk/plan", "/dust/timeseries", "/places", "/healthy"]) {
      expect(isIgnoredPath(path)).toBe(false);
    }
  });

  it("recognizes relative, absolute and Request inputs, and only backend /api/ paths", () => {
    expect(classifyRequest("/api/places?limit=5", undefined, ORIGINS)).toEqual({ path: "/places", label: "USGS place list" });
    expect(classifyRequest("https://martian-map-api.example.org/api/marswalk/plan", { method: "POST" }, ORIGINS)?.label).toBe("MARSWALK route plan");
    expect(classifyRequest(new URL("https://martian-map-api.example.org/api/thermal/samples?lat=1"), undefined, ORIGINS)?.path).toBe("/thermal/samples");
    expect(classifyRequest({ url: "https://martian-map-api.example.org/api/sources", headers: new Headers() }, undefined, ORIGINS)?.label).toBe("Source ledger");
    // Other hosts, non-API paths and ignored paths are not tracked.
    expect(classifyRequest("https://api.nasa.gov/mars-photos/api/v1/rovers", undefined, ORIGINS)).toBe(null);
    expect(classifyRequest("/assets/index.js", undefined, ORIGINS)).toBe(null);
    expect(classifyRequest("/api/health", undefined, ORIGINS)).toBe(null);
    expect(classifyRequest("/api/dust/map?sol=120", undefined, ORIGINS)).toBe(null);
  });

  it("ignores requests marked as prefetch or background by header or URL param", () => {
    expect(classifyRequest("/api/conditions?prefetch=1", undefined, ORIGINS)).toBe(null);
    expect(classifyRequest("/api/conditions?_prefetch", undefined, ORIGINS)).toBe(null);
    expect(classifyRequest("/api/conditions?prefetch=0", undefined, ORIGINS)?.label).toBe("Conditions at sol");
    expect(classifyRequest("/api/conditions", { headers: { Purpose: "prefetch" } }, ORIGINS)).toBe(null);
    expect(classifyRequest("/api/conditions", { headers: [["X-NN-Background", "1"]] }, ORIGINS)).toBe(null);
    expect(classifyRequest("/api/conditions", { headers: new Headers({ "Sec-Purpose": "prefetch;prerender" }) }, ORIGINS)).toBe(null);
    expect(classifyRequest({ url: "/api/conditions", headers: new Headers({ "X-Prefetch": "true" }) }, undefined, ORIGINS)).toBe(null);
    expect(classifyRequest("/api/conditions", { headers: { "Content-Type": "application/json" } }, ORIGINS)?.path).toBe("/conditions");
  });
});

describe("fetchTracker store and fetch wrapper", () => {
  it("tracks pending -> done and pending -> failed without changing results", async () => {
    const tracker = createFetchTracker({ graceMs: 0, ...ORIGINS });
    const plan = deferred();
    const env = deferred();
    const health = deferred();
    const inner = vi.fn((input) => {
      if (String(input).includes("marswalk")) return plan.promise;
      if (String(input).includes("health")) return health.promise;
      return env.promise;
    });
    const fetch = tracker.wrap(inner);

    const planCall = fetch("/api/marswalk/plan", { method: "POST" });
    const envCall = fetch("/api/environment?lat=1&lon=2");
    const healthCall = fetch("/api/health");
    expect(inner).toHaveBeenCalledTimes(3);
    expect(inner).toHaveBeenCalledWith("/api/marswalk/plan", { method: "POST" });

    let snap = tracker.getSnapshot();
    expect(snap.active).toBe(true);
    expect(snap.burst).toBe(1);
    expect(snap.pending).toBe(2);
    expect(snap.total).toBe(2);
    expect(snap.entries.map((e) => [e.label, e.status])).toEqual([
      ["MARSWALK route plan", "pending"],
      ["Site environment", "pending"],
    ]);
    expect(typeof snap.entries[0].startedAt).toBe("number");

    const ok = response(200);
    plan.resolve(ok);
    await expect(planCall).resolves.toBe(ok);
    await flush();
    snap = tracker.getSnapshot();
    expect(snap.entries[0].status).toBe("done");
    expect(snap.done).toBe(1);
    expect(snap.pending).toBe(1);

    const boom = new TypeError("Failed to fetch");
    env.reject(boom);
    await expect(envCall).rejects.toBe(boom);
    await flush();
    snap = tracker.getSnapshot();
    expect(snap.entries[1].status).toBe("failed");
    expect(snap.entries[1].error).toBe("Failed to fetch");
    expect(snap.failed).toBe(1);
    expect(snap.pending).toBe(0);
    expect(snap.active).toBe(false);

    health.resolve(ok);
    await expect(healthCall).resolves.toBe(ok);
    expect(tracker.getSnapshot().total).toBe(2);
  });

  it("returns the very promise the underlying fetch returned", () => {
    const tracker = createFetchTracker(ORIGINS);
    const promise = new Promise(() => {});
    const fetch = tracker.wrap(() => promise);
    expect(fetch("/api/places")).toBe(promise);
    expect(fetch("/api/health")).toBe(promise);
  });

  it("marks HTTP errors as failed and drops aborted requests", async () => {
    const tracker = createFetchTracker({ graceMs: 0, ...ORIGINS });
    const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    const fetch = tracker.wrap((input) => (String(input).includes("sources") ? Promise.resolve(response(503, "Service Unavailable")) : Promise.reject(abort)));
    const sourcesCall = fetch("/api/sources");
    const thermalCall = fetch("/api/thermal/samples");
    await expect(sourcesCall).resolves.toMatchObject({ status: 503 });
    await expect(thermalCall).rejects.toBe(abort);
    await flush();
    const snap = tracker.getSnapshot();
    // The aborted request leaves the list and the counts; the HTTP error stays as failed.
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0].status).toBe("failed");
    expect(snap.entries[0].error).toBe("HTTP 503 Service Unavailable");
    expect(snap).toMatchObject({ total: 1, failed: 1, done: 0, cancelled: 1, pending: 0 });
  });

  it("rethrows synchronous fetch errors and records them", () => {
    const tracker = createFetchTracker({ graceMs: 0, ...ORIGINS });
    const fetch = tracker.wrap(() => {
      throw new TypeError("bad init");
    });
    expect(() => fetch("/api/places")).toThrow("bad init");
    expect(tracker.getSnapshot().entries[0].status).toBe("failed");
  });

  it("keeps one burst through the settle grace and opens a new one after it", async () => {
    vi.useFakeTimers();
    const tracker = createFetchTracker({ graceMs: 400, ...ORIGINS });
    const fetch = tracker.wrap(() => Promise.resolve(response(200)));
    await fetch("/api/places");
    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.getSnapshot()).toMatchObject({ burst: 1, active: true, pending: 0, total: 1 });

    await vi.advanceTimersByTimeAsync(200);
    await fetch("/api/environment");
    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.getSnapshot()).toMatchObject({ burst: 1, active: true, total: 2, done: 2 });

    await vi.advanceTimersByTimeAsync(400);
    expect(tracker.getSnapshot()).toMatchObject({ burst: 1, active: false });

    await fetch("/api/sources");
    await vi.advanceTimersByTimeAsync(0);
    const snap = tracker.getSnapshot();
    expect(snap).toMatchObject({ burst: 2, active: true, total: 1 });
    expect(snap.entries.map((e) => e.label)).toEqual(["Source ledger"]);
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const tracker = createFetchTracker({ graceMs: 0, ...ORIGINS });
    const listener = vi.fn();
    const off = tracker.subscribe(listener);
    const fetch = tracker.wrap(() => Promise.resolve(response(200)));
    await fetch("/api/places");
    await flush();
    expect(listener).toHaveBeenCalled();
    off();
    listener.mockClear();
    await fetch("/api/places");
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it("installs on a window-like target once", () => {
    const tracker = createFetchTracker(ORIGINS);
    const target = { fetch: vi.fn(() => Promise.resolve(response(200))) };
    expect(installFetchTracker(target, tracker)).toBe(true);
    const wrapped = target.fetch;
    expect(installFetchTracker(target, tracker)).toBe(false);
    expect(target.fetch).toBe(wrapped);
    target.fetch("/api/places");
    expect(tracker.getSnapshot().pending).toBe(1);
  });
});
