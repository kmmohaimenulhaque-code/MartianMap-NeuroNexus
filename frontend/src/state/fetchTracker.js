/*
 * Backend request tracker for the loading pop-up (ui/LoadingOverlay.jsx).
 *
 * Wraps window.fetch once (after apiOrigin.js, which this module imports first so the order is fixed) and
 * records every in-flight backend request: any URL on this page's origin or on VITE_API_ORIGIN whose path
 * contains "/api/". It never changes a request or its result: the wrapper hands back the very promise the
 * underlying fetch returned, so failures still reject exactly as before. Tracking errors are swallowed.
 *
 * Background and polling calls are ignored so the pop-up does not flash: health and AI status polls, dust
 * playback frames, the news briefing, typeahead and chat, and any request marked as prefetch or background
 * (header Purpose / Sec-Purpose: prefetch, X-Prefetch or X-NN-Background, or URL param prefetch / _prefetch).
 *
 * Requests are grouped into bursts. A burst opens with the first request when nothing is pending and closes
 * GRACE_MS after the last one settles; a request that starts inside that grace joins the same burst, so a
 * chain of dependent calls reads as one burst and a dismissed pop-up stays dismissed through it.
 *
 * The store (subscribe / getSnapshot) is shaped for useSyncExternalStore; snapshots are immutable.
 */

import { API_ORIGIN } from "../apiOrigin.js";

export const GRACE_MS = 400;
const MAX_ENTRIES = 40;

/* Readable names for known backend paths (the part after /api). Longest prefix wins; fallback is the path. */
const LABELS = [
  ["/marswalk/plan", "MARSWALK route plan"],
  ["/marswalk/evaluate", "Route evaluation"],
  ["/marswalk/brief", "EVA brief"],
  ["/marswalk", "MARSWALK data"],
  ["/terrain/hires", "HiRISE terrain window"],
  ["/terrain/window", "MOLA terrain window"],
  ["/terrain/sources", "Terrain source footprints"],
  ["/terrain/metadata", "Terrain metadata"],
  ["/terrain/route-plan", "Terrain route plan"],
  ["/environment", "Site environment"],
  ["/places", "USGS place list"],
  ["/conditions/seasonal", "Seasonal conditions"],
  ["/conditions", "Conditions at sol"],
  ["/dust/timeseries", "Dust time series"],
  ["/dust/meta", "Dust model metadata"],
  ["/thermal", "THEMIS samples"],
  ["/rovers", "Rover traverses"],
  ["/usgs/sync", "USGS map sync"],
  ["/media", "Rover photos"],
  ["/sources", "Source ledger"],
  ["/landing-sites", "Landing sites"],
  ["/data/status", "Data status"],
  ["/validation", "Validation report"],
  ["/mars3d", "3D globe data"],
  ["/routes", "Route methodology"],
  ["/orbital", "Orbital close approaches"],
  ["/ai/provenance", "AI provenance"],
].sort((a, b) => b[0].length - a[0].length);

/* Background, polling and interactive calls that must not raise the pop-up. Prefix match on the path after /api. */
const IGNORED = ["/health", "/ai/status", "/dust/map", "/briefing", "/places/suggest", "/ai/chat"];

const PREFETCH_PARAMS = ["prefetch", "_prefetch"];

const matches = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

/* Paths with a variable segment, checked before the prefixes. */
const LABEL_PATTERNS = [
  [/^\/rovers\/[^/]+\/waypoints(\/|$)/, "Rover waypoints"],
  [/^\/rovers\/[^/]+\/latest(\/|$)/, "Rover latest position"],
];

export function labelFor(path) {
  const pattern = LABEL_PATTERNS.find(([re]) => re.test(path));
  if (pattern) return pattern[1];
  const hit = LABELS.find(([prefix]) => matches(path, prefix));
  return hit ? hit[1] : path;
}

export function isIgnoredPath(path) {
  return IGNORED.some((prefix) => matches(path, prefix));
}

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url; // Request
  if (input && typeof input.href === "string") return input.href; // URL
  return String(input ?? "");
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  if (Array.isArray(headers)) {
    const hit = headers.find((pair) => String(pair?.[0]).toLowerCase() === name);
    return hit ? hit[1] : null;
  }
  if (typeof headers === "object") {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return key ? headers[key] : null;
  }
  return null;
}

const truthy = (value) => value != null && !/^(0|false|no|off)$/i.test(String(value).trim());

function markedBackground(url, init, input) {
  for (const headers of [init?.headers, input?.headers]) {
    for (const name of ["purpose", "sec-purpose"]) {
      if (/prefetch/i.test(String(headerValue(headers, name) ?? ""))) return true;
    }
    for (const name of ["x-prefetch", "x-nn-background"]) {
      if (truthy(headerValue(headers, name))) return true;
    }
  }
  return PREFETCH_PARAMS.some((p) => url.searchParams.has(p) && truthy(url.searchParams.get(p) || "1"));
}

function defaultOrigins() {
  const out = [];
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") out.push(window.location.origin);
  if (API_ORIGIN) {
    try {
      out.push(new URL(API_ORIGIN).origin);
    } catch {
      // Not a valid origin; relative requests are still tracked.
    }
  }
  return out;
}

/*
 * Decide whether a fetch is a tracked backend request. Returns { path, label } or null.
 * origins: list of backend origins; null accepts any origin (relative URLs always count as same origin).
 */
export function classifyRequest(input, init, { origins = defaultOrigins() } = {}) {
  const raw = urlOf(input);
  if (!raw) return null;
  const base = typeof window !== "undefined" && window.location?.href ? window.location.href : "http://localhost/";
  let url;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith("//");
  if (!relative && origins && !origins.includes(url.origin)) return null;
  const at = url.pathname.indexOf("/api/");
  if (at < 0) return null;
  const path = url.pathname.slice(at + 4) || "/";
  if (isIgnoredPath(path) || markedBackground(url, init, input)) return null;
  return { path, label: labelFor(path) };
}

function errorText(error) {
  if (!error) return "Request failed";
  const message = error.message ?? String(error);
  return message || error.name || "Request failed";
}

const EMPTY = Object.freeze({ burst: 0, active: false, pending: 0, total: 0, done: 0, failed: 0, cancelled: 0, entries: Object.freeze([]) });

export function createFetchTracker({ graceMs = GRACE_MS, maxEntries = MAX_ENTRIES, origins, now = () => Date.now() } = {}) {
  let snapshot = EMPTY;
  let nextId = 1;
  let graceTimer = null;
  const listeners = new Set();
  let notifyQueued = false;

  /* The snapshot changes at once; subscribers hear about it in a microtask, so a fetch issued during a render
     never updates another component mid-render, and a batch of requests started together notifies once. */
  const notify = () => {
    notifyQueued = false;
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // A broken subscriber must not break fetch.
      }
    });
  };
  const emit = (next) => {
    snapshot = Object.freeze(next);
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(notify);
  };

  const closeBurst = () => {
    graceTimer = null;
    if (snapshot.pending === 0 && snapshot.active) emit({ ...snapshot, active: false });
  };

  function start(input, init) {
    const hit = classifyRequest(input, init, origins === undefined ? undefined : { origins });
    if (!hit) return null;
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    const fresh = !snapshot.active;
    const base = fresh ? { ...EMPTY, burst: snapshot.burst + 1, active: true } : snapshot;
    const entry = Object.freeze({ id: nextId++, path: hit.path, label: hit.label, startedAt: now(), finishedAt: null, status: "pending", error: null, httpStatus: null });
    let entries = [...base.entries, entry];
    while (entries.length > maxEntries) {
      const drop = entries.findIndex((e) => e.status !== "pending");
      entries.splice(drop >= 0 ? drop : 0, 1);
    }
    emit({ ...base, active: true, pending: base.pending + 1, total: base.total + 1, entries: Object.freeze(entries) });
    return entry.id;
  }

  /* outcome: { response } when fetch resolved, { error } when it rejected. */
  function finish(id, outcome = {}) {
    const index = snapshot.entries.findIndex((e) => e.id === id);
    const current = index >= 0 ? snapshot.entries[index] : null;
    if (current && current.status !== "pending") return;
    let status = "done";
    let error = null;
    let cancelled = false;
    let httpStatus = null;
    if (outcome.error) {
      if (outcome.error.name === "AbortError") cancelled = true;
      else {
        status = "failed";
        error = errorText(outcome.error);
      }
    } else if (outcome.response) {
      httpStatus = outcome.response.status ?? null;
      if (outcome.response.ok === false) {
        status = "failed";
        error = `HTTP ${httpStatus ?? "error"}${outcome.response.statusText ? ` ${outcome.response.statusText}` : ""}`;
      }
    }
    // A cancelled request was superseded or its view closed: nobody waits for it, so it leaves the list and counts.
    let entries = snapshot.entries;
    if (current) {
      entries = [...entries];
      if (cancelled) entries.splice(index, 1);
      else entries[index] = Object.freeze({ ...current, status, error, httpStatus, finishedAt: now() });
      entries = Object.freeze(entries);
    }
    const pending = Math.max(0, snapshot.pending - 1);
    emit({
      ...snapshot,
      pending,
      total: cancelled ? Math.max(0, snapshot.total - 1) : snapshot.total,
      done: snapshot.done + (status === "done" && !cancelled ? 1 : 0),
      failed: snapshot.failed + (status === "failed" ? 1 : 0),
      cancelled: snapshot.cancelled + (cancelled ? 1 : 0),
      entries,
    });
    if (pending === 0) {
      if (graceMs <= 0) closeBurst();
      else graceTimer = setTimeout(closeBurst, graceMs);
    }
  }

  /* Returns a fetch with the same behavior as fetchImpl that records backend requests on the way through. */
  function wrap(fetchImpl) {
    const tracked = function trackedFetch(input, init) {
      let id = null;
      try {
        id = start(input, init);
      } catch {
        id = null;
      }
      let promise;
      try {
        promise = fetchImpl(input, init);
      } catch (error) {
        if (id != null) finish(id, { error });
        throw error;
      }
      if (id != null && promise && typeof promise.then === "function") {
        promise.then(
          (response) => finish(id, { response }),
          (error) => finish(id, { error }),
        );
      } else if (id != null) {
        finish(id, {});
      }
      return promise;
    };
    tracked.__nnFetchTracked = true;
    return tracked;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    start,
    finish,
    wrap,
  };
}

/* Shared tracker: one per page, kept across hot reloads so the fetch wrapper and the store stay paired. */
const GLOBAL_KEY = "__nnFetchTracker";
export const fetchTracker = globalThis[GLOBAL_KEY] ?? (globalThis[GLOBAL_KEY] = createFetchTracker());

export function installFetchTracker(target = typeof window !== "undefined" ? window : null, tracker = fetchTracker) {
  if (!target || typeof target.fetch !== "function" || target.fetch.__nnFetchTracked) return false;
  const previous = target.fetch;
  target.fetch = tracker.wrap((input, init) => previous.call(target, input, init));
  return true;
}

installFetchTracker();
