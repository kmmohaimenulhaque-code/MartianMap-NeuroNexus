/* Loads data for the global map's context layers only when a layer is switched on. */

import { useEffect, useState, useMemo } from "react";
import { useDustFrame } from "../../state/dustFrames";

import { missionSolAt } from "../../state/solMath";

async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function useContextLayerData(visibility, location, sol) {
  const [data, setData] = useState({});
  const [status, setStatus] = useState({});
  const want = (key) => Boolean(visibility[key]);

  const needTraverses = want("mslTraverse") || want("m2020Traverse");
  useEffect(() => {
    if (!needTraverses) return undefined;
    const controller = new AbortController();
    Promise.all(["msl", "m2020"].map((r) => getJson(`/api/rovers/${r}/traverse?max_vertices=3000`, controller.signal)))
      .then(([msl, m2020]) => setData((d) => ({ ...d, traverses: { msl: msl.geometry.coordinates, m2020: m2020.geometry.coordinates } })))
      .catch((e) => e.name !== "AbortError" && setStatus((s) => ({ ...s, mslTraverse: `unavailable: ${e.message}` })));
    return () => controller.abort();
  }, [needTraverses]);

  const needWaypoints = want("waypoints");
  useEffect(() => {
    if (!needWaypoints) return undefined;
    const controller = new AbortController();
    Promise.all(["msl", "m2020"].map((r) => getJson(`/api/rovers/${r}/waypoints`, controller.signal)))
      .then(([msl, m2020]) => setData((d) => ({ ...d, waypoints: { msl: msl.waypoints, m2020: m2020.waypoints } })))
      .catch((e) => e.name !== "AbortError" && setStatus((s) => ({ ...s, waypoints: `unavailable: ${e.message}` })));
    return () => controller.abort();
  }, [needWaypoints]);

  const needLanding = want("landingSites");
  useEffect(() => {
    if (!needLanding) return undefined;
    const controller = new AbortController();
    getJson("/api/landing-sites", controller.signal)
      .then((body) => setData((d) => ({ ...d, landingSites: body.sites })))
      .catch((e) => e.name !== "AbortError" && setStatus((s) => ({ ...s, landingSites: `unavailable: ${e.message}` })));
    return () => controller.abort();
  }, [needLanding]);

  const lat = location?.latitude_deg;
  const lon = location?.longitude_deg;
  const needFootprints = want("hiriseFootprints") && lat != null;
  useEffect(() => {
    if (!needFootprints) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getJson(`/api/terrain/sources?lat=${lat}&lon=${((lon + 180) % 360) - 180}&radius_km=10&families=HIRISE`, controller.signal)
        .then((body) => setData((d) => ({ ...d, footprints: body.products })))
        .catch((e) => e.name !== "AbortError" && setStatus((s) => ({ ...s, hiriseFootprints: `unavailable: ${e.message}` })));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needFootprints, lat, lon]);

  // Dust frames come from the shared cache (state/dustFrames.js): no per-view refetch during playback.
  const dustFrame = useDustFrame(sol, want("dust"));

  /* Where Curiosity was at the console's activeSol (MY34): last waypoint at or before that mission sol. */
  const mslSol = needTraverses && sol != null ? missionSolAt("msl", sol) : null;
  useEffect(() => {
    if (mslSol == null) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getJson(`/api/rovers/msl/waypoints?sol_min=${Math.max(0, mslSol - 120)}&sol_max=${mslSol}`, controller.signal)
        .then((body) => {
          const last = (body.waypoints ?? []).reduce((a, w) => (!a || (w.sol ?? 0) >= (a.sol ?? 0) ? w : a), null);
          setData((d) => ({ ...d, roverAtSol: { msl: last ? { ...last, missionSol: mslSol, my34Sol: sol } : null } }));
        })
        .catch((e) => e.name !== "AbortError" && setStatus((s) => ({ ...s, roverAtSol: `unavailable: ${e.message}` })));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mslSol, sol]);

  const merged = useMemo(() => ({ ...data, dust: dustFrame.data }), [data, dustFrame.data]);
  const mergedStatus = useMemo(() => (dustFrame.error ? { ...status, dust: `unavailable: ${dustFrame.error}` } : status), [status, dustFrame.error]);
  return { data: merged, status: mergedStatus };
}
