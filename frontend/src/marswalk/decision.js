/* MARSWALK decision helpers shared by the decision card and the exports. */

import { DUST_CLASS, dustLevel } from "../state/solMath";

const DUST_STATUS = { WITHIN: "WITHIN PLANNING LIMITS", REVIEW: "REVIEW REQUIRED", EXCEED: "EXCEEDS PLANNING LIMIT" };
const RANK = { "WITHIN PLANNING LIMITS": 0, "REVIEW REQUIRED": 1, "EXCEEDS PLANNING LIMIT": 2 };

/* The route status combined with the modeled dust class at the console's activeSol (worst of the two). */
export function statusAtSol(routeStatus, dustClass) {
  const dust = DUST_STATUS[dustClass];
  if (!dust || !(routeStatus in RANK)) return routeStatus;
  return RANK[dust] > RANK[routeStatus] ? dust : routeStatus;
}

/* Per-sol statuses, counts and the longest run of WITHIN sols (pure; unit-tested). */
export function seasonStatuses(routeStatus, taus) {
  const statuses = taus.map((tau) => {
    const level = dustLevel(tau);
    return level ? statusAtSol(routeStatus, DUST_CLASS[level]) : null;
  });
  const counts = {};
  let best = null;
  let run = null;
  statuses.forEach((status, i) => {
    if (status) counts[status] = (counts[status] ?? 0) + 1;
    if (status === "WITHIN PLANNING LIMITS") {
      run = run ? { ...run, end: i + 1 } : { start: i + 1, end: i + 1 };
      if (!best || run.end - run.start > best.end - best.start) best = run;
    } else run = null;
  });
  return { statuses, counts, longestWithin: best };
}


const round6 = (v) => Math.round(v * 1e6) / 1e6;

/* The plan's route as an evaluate polyline: [lat, lon], at most `max` vertices, no repeated vertices. */
/* Douglas-Peucker on local metres: indices of the vertices kept within tol metres of the line. */
function simplify(xy, tol) {
  const keep = new Uint8Array(xy.length);
  keep[0] = 1;
  keep[xy.length - 1] = 1;
  const stack = [[0, xy.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a];
    const dx = xy[b][0] - ax;
    const dy = xy[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const t = len2 ? Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2)) : 0;
      const d = Math.hypot(xy[i][0] - ax - t * dx, xy[i][1] - ay - t * dy);
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return xy.map((_, i) => i).filter((i) => keep[i]);
}

/*
 * The plan's route as [lat, lon] vertices for /marswalk/evaluate (at most 500). Shape-preserving: the tolerance
 * starts at 0.25 m and doubles only until the vertex count fits, so the re-evaluated line follows the planned one
 * instead of cutting corners across steeper cells.
 */
export function routePolyline(plan, max = 480) {
  const coords = plan?.geometry?.coordinates ?? [];
  if (coords.length < 2) return [];
  const lat0 = (coords[0][1] * Math.PI) / 180;
  const m = 3389500 * (Math.PI / 180);
  const xy = coords.map(([lon, lat]) => [lon * m * Math.cos(lat0), lat * m]);
  let idx = coords.map((_, i) => i);
  for (let tol = 0.25; idx.length > max && tol < 1e4; tol *= 2) idx = simplify(xy, tol);
  const out = [];
  for (const i of idx) {
    const p = [round6(coords[i][1]), round6(coords[i][0])];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

