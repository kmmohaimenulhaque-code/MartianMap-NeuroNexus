/* Loads data for the global map's context layers only when a layer is switched on. */

import { useEffect, useState, useMemo } from "react";
import { useDustFrame } from "../../state/dustFrames";
import { useTerrainGrid } from "../layers/sharedLayerData";

import { missionSolAt } from "../../state/solMath";

async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const lon360 = (lon) => ((Number(lon) % 360) + 360) % 360;

/* ------------------------------------------------------------ rover position labels (2D, ArcGIS and 3D) */

/* The waypoint with the highest sol (ties: the later one in the list, i.e. the end of that sol's drive). */
export function latestWaypoint(waypoints) {
  return (waypoints ?? []).reduce((a, w) => (w?.lat == null || w?.lon == null ? a : !a || (w.sol ?? 0) >= (a.sol ?? 0) ? w : a), null);
}

/* Curiosity at the console's MY34 scenario sol: the last localized waypoint at or before that mission sol. */
export function curiosityAtSolRecord(waypoint, missionSol, my34Sol) {
  if (!waypoint || waypoint.lat == null || waypoint.lon == null) return null;
  return {
    ...waypoint,
    rover: "msl",
    name: "Curiosity",
    kind: "scenario",
    lat: Number(waypoint.lat),
    lon: lon360(waypoint.lon),
    missionSol,
    my34Sol,
    label: `CURIOSITY @ SOL ${my34Sol}`,
    detail: `Curiosity at MY34 sol ${my34Sol} ≈ mission sol ${missionSol}; last localized waypoint: sol ${waypoint.sol ?? "n/a"} (NASA MMGIS). Calendar conversion is approximate to about one sol.`,
    ledgerId: "MMGIS_MSL_WAYPOINTS",
  };
}

/* Perseverance landed 2021-02-18 (Mars Year 36): it has no MY34 position, so it is shown at its latest localization. */
export function perseveranceLatestRecord(latest, retrievedAt = null) {
  if (!latest || latest.lat == null || latest.lon == null) return null;
  const sol = latest.sol ?? null;
  const when = retrievedAt ? `, retrieved ${String(retrievedAt).slice(0, 10)}` : "";
  return {
    ...latest,
    rover: "m2020",
    name: "Perseverance",
    kind: "latest",
    lat: Number(latest.lat),
    lon: lon360(latest.lon),
    missionSol: sol,
    label: `PERSEVERANCE @ SOL ${sol ?? "n/a"}`,
    detail: `Perseverance at its latest NASA MMGIS localization: mission sol ${sol ?? "n/a"}${when}. Perseverance landed on 2021-02-18 (Mars Year 36), so it is not part of the MY34 scenario and this position does not follow the sol slider.`,
    ledgerId: "MMGIS_M2020_WAYPOINTS",
  };
}

/* Present rover records in a fixed order (Curiosity, Perseverance). */
export function roverLabelRecords(rovers) {
  return ["msl", "m2020"].map((k) => rovers?.[k]).filter(Boolean);
}

/* One fetch of Perseverance's latest localization per page load, shared by every map that shows it. */
let m2020Latest = null;
function fetchPerseveranceLatest() {
  if (!m2020Latest) {
    m2020Latest = getJson("/api/rovers/m2020/latest").catch((error) => {
      m2020Latest = null;
      throw error;
    });
  }
  return m2020Latest;
}

/*
 * Rover positions shown as "CURIOSITY @ SOL n" (at the MY34 scenario sol) and "PERSEVERANCE @ SOL n" (latest
 * localization). Used by useContextLayerData (2D and ArcGIS maps) and by the 3D globe, so the labels agree.
 */
export function useRoverPositions(sol, { msl = false, m2020 = false } = {}) {
  const [rovers, setRovers] = useState({ msl: null, m2020: null });
  const [status, setStatus] = useState({});

  const mslSol = msl && sol != null ? missionSolAt("msl", sol) : null;
  useEffect(() => {
    if (mslSol == null) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getJson(`/api/rovers/msl/waypoints?sol_min=${Math.max(0, mslSol - 120)}&sol_max=${mslSol}`, controller.signal)
        .then((body) => {
          const record = curiosityAtSolRecord(latestWaypoint(body.waypoints), mslSol, sol);
          setRovers((r) => ({ ...r, msl: record }));
          setStatus((s) => ({ ...s, msl: record ? undefined : `unavailable: no localized waypoint in the 120 sols before mission sol ${mslSol}` }));
        })
        .catch((e) => e.name !== "AbortError" && setStatus((s) => ({ ...s, msl: `unavailable: ${e.message}` })));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mslSol, sol]);

  useEffect(() => {
    if (!m2020) return undefined;
    let cancelled = false;
    fetchPerseveranceLatest()
      .then((body) => {
        if (cancelled) return;
        const record = perseveranceLatestRecord(body.latest, body.source?.retrieved_at);
        setRovers((r) => ({ ...r, m2020: record }));
        setStatus((s) => ({ ...s, m2020: record ? undefined : "unavailable: no localized waypoint" }));
      })
      .catch((e) => !cancelled && setStatus((s) => ({ ...s, m2020: `unavailable: ${e.message}` })));
    return () => {
      cancelled = true;
    };
  }, [m2020]);

  return { rovers, status };
}

/* ------------------------------------------------------------ landing-site labels */

const SITE_STATUS_TEXT = {
  successful_landing: "successful landing",
  landed_not_operational: "reached the surface, never operated",
  crash_site: "impact site of a failed landing",
};

export function landingSiteLabel(site) {
  return site?.label || site?.spacecraft || site?.mission || "Landing site";
}

export function landingSiteStatus(site) {
  return SITE_STATUS_TEXT[site?.site_status] ?? String(site?.site_status ?? "status n/a").replace(/_/g, " ");
}

export function landingSiteDetail(site) {
  const parts = [site?.mission, site?.spacecraft !== site?.mission ? site?.spacecraft : null, site?.agency, site?.landing_date, site?.region, landingSiteStatus(site)];
  return parts.filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------ label decluttering (2D and ArcGIS maps) */

export const LABEL_DIRECTIONS = ["right", "left", "top", "bottom"];

/* Approximate rendered size of a label (Switzer, uppercase-heavy, padding included). */
export function labelSize(text, fontPx = 12) {
  return { w: String(text ?? "").length * fontPx * 0.62 + 14, h: fontPx + 10 };
}

/* Screen box of a label placed on one side of its anchor point, `gap` pixels away. */
export function labelBox(x, y, w, h, direction, gap = 12) {
  if (direction === "left") return { x0: x - gap - w, x1: x - gap, y0: y - h / 2, y1: y + h / 2 };
  if (direction === "top") return { x0: x - w / 2, x1: x + w / 2, y0: y - gap - h, y1: y - gap };
  if (direction === "bottom") return { x0: x - w / 2, x1: x + w / 2, y0: y + gap, y1: y + gap + h };
  return { x0: x + gap, x1: x + gap + w, y0: y - h / 2, y1: y + h / 2 };
}

const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/*
 * Greedy label placement in screen space. Items { id, x, y, text, size?, priority? } are placed by priority
 * (lower first), each on the first side (right, left, top, bottom) that stays inside the view and clears the
 * labels already placed and every other item's marker (priority-0 labels fall back to covering a marker).
 * Returns Map id -> direction, or null when the label is left off (its marker keeps a hover tooltip).
 */
export function declutterLabels(items, { width = Infinity, height = Infinity, gap = 12, markerRadius = 6 } = {}) {
  const markers = items.map((it) => ({ id: it.id, x0: it.x - markerRadius, x1: it.x + markerRadius, y0: it.y - markerRadius, y1: it.y + markerRadius }));
  const placed = [];
  const out = new Map();
  const ordered = items.map((it, i) => ({ it, i })).sort((a, b) => (a.it.priority ?? 1) - (b.it.priority ?? 1) || a.i - b.i);
  for (const { it } of ordered) {
    const { w, h } = labelSize(it.text, it.size);
    if (!Number.isFinite(it.x) || !Number.isFinite(it.y) || it.x < 0 || it.y < 0 || it.x > width || it.y > height) {
      out.set(it.id, null);
      continue;
    }
    // Priority-0 labels (rovers) may cover another marker when no side is clear; lower priorities never do.
    const passes = (it.priority ?? 1) <= 0 ? [true, false] : [true];
    let chosen = null;
    for (const avoidMarkers of passes) {
      for (const direction of LABEL_DIRECTIONS) {
        const box = labelBox(it.x, it.y, w, h, direction, gap);
        if (box.x0 < 0 || box.y0 < 0 || box.x1 > width || box.y1 > height) continue;
        if (placed.some((b) => overlaps(b, box))) continue;
        if (avoidMarkers && markers.some((m) => m.id !== it.id && overlaps(m, box))) continue;
        chosen = { direction, box };
        break;
      }
      if (chosen) break;
    }
    if (chosen) placed.push(chosen.box);
    out.set(it.id, chosen?.direction ?? null);
  }
  return out;
}

/* ------------------------------------------------------------ the hook */

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
  const grid = useTerrainGrid(location, want("slope") || want("roughness") || want("walkability"));

  /* Curiosity at the console's activeSol (MY34) and Perseverance at its latest localization (landed MY36). */
  const roverPositions = useRoverPositions(sol, { msl: want("mslTraverse"), m2020: want("m2020Traverse") });

  const merged = useMemo(
    () => ({ ...data, dust: dustFrame.data, grid: grid.data, rovers: roverPositions.rovers, roverAtSol: { msl: roverPositions.rovers.msl } }),
    [data, dustFrame.data, grid.data, roverPositions.rovers],
  );
  const mergedStatus = useMemo(() => {
    const out = { ...status };
    if (dustFrame.error) out.dust = `unavailable: ${dustFrame.error}`;
    if (grid.error) for (const id of ["slope", "roughness", "walkability"]) out[id] = `unavailable: ${grid.error}`;
    // Shown under the traverse layer that draws the label (the menu keys status by layer id).
    if (roverPositions.status.msl && !out.mslTraverse) out.mslTraverse = `Curiosity position label ${roverPositions.status.msl}`;
    if (roverPositions.status.m2020 && !out.m2020Traverse) out.m2020Traverse = `Perseverance position label ${roverPositions.status.m2020}`;
    return out;
  }, [status, dustFrame.error, grid.error, roverPositions.status]);
  return { data: merged, status: mergedStatus };
}
