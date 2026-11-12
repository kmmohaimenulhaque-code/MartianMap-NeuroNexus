/*
 * One cache of MY34 dust optical-depth frames (GET /api/dust/map?sol=N, about 44 KB each) shared by every view
 * that draws the global dust map: the 2D overlay, the right-panel heatmap and the 3D globe. Before this each
 * view fetched its own copy and aborted it on every sol change, so during playback (a new sol every 120 ms)
 * frames rarely finished and the map lagged. Now a frame is fetched once, playback prefetches ahead, and the
 * sol ticker only advances when the next frame is ready (useDustFrame keeps showing the last ready frame).
 */
import { useEffect, useState } from "react";

const MAX_FRAMES = 160; // about 7 MB of JSON at most
const frames = new Map(); // sol -> { promise, data, error }

function touch(sol, entry) {
  frames.delete(sol);
  frames.set(sol, entry);
  while (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value);
}

export function loadDustFrame(sol) {
  const key = Number(sol);
  const hit = frames.get(key);
  if (hit) {
    touch(key, hit);
    return hit.promise;
  }
  const entry = { data: null, error: null, promise: null };
  entry.promise = fetch(`/api/dust/map?sol=${key}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data) => {
      entry.data = data;
      return data;
    })
    .catch((error) => {
      entry.error = error;
      frames.delete(key); // allow a retry later
      throw error;
    });
  touch(key, entry);
  return entry.promise;
}

export const peekDustFrame = (sol) => frames.get(Number(sol))?.data ?? null;
export const dustFrameFailed = (sol) => Boolean(frames.get(Number(sol))?.error);

/* Warm the cache for the sols playback will show next (step 2, wrapping at 668), a few requests at a time. */
export const SCENARIO_SOLS = 668; // MY34 scenario length (GET /api/dust/meta "sols")

/* Next playback sol, wrapping to 1 instead of stepping past the last sol (667 + 2 used to request sol 669). */
export function nextPlaybackSol(sol, step = 2) {
  return sol + step > SCENARIO_SOLS ? 1 : sol + step;
}

export function prefetchDustFrames(fromSol, count = 16, step = 2) {
  let s = fromSol;
  for (let i = 0; i < count; i += 1) {
    s = nextPlaybackSol(s, step);
    if (!frames.has(s)) loadDustFrame(s).catch(() => {});
  }
}

/*
 * The frame for `sol`, or while it loads the last frame this hook showed (never blank during playback).
 * Returns { data, sol: the sol the data belongs to, error }.
 */
export function useDustFrame(sol, enabled = true) {
  const [state, setState] = useState(() => ({ data: peekDustFrame(sol), sol: peekDustFrame(sol) ? sol : null, error: "" }));
  const ready = enabled ? peekDustFrame(sol) : null;
  useEffect(() => {
    if (!enabled || sol == null) return undefined;
    let live = true;
    loadDustFrame(sol)
      .then((data) => live && setState({ data, sol, error: "" }))
      .catch((error) => live && setState((s) => ({ ...s, error: error.message })));
    return () => {
      live = false;
    };
  }, [sol, enabled]);
  if (!enabled) return { data: null, sol: null, error: "" };
  return ready ? { data: ready, sol, error: "" } : state;
}
