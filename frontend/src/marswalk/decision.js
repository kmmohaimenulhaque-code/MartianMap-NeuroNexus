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
export function routePolyline(plan, max = 400) {
  const coords = plan?.geometry?.coordinates ?? [];
  if (coords.length < 2) return [];
  const step = Math.max(1, Math.ceil(coords.length / max));
  const picked = coords.filter((_, i) => i % step === 0);
  if (picked[picked.length - 1] !== coords[coords.length - 1]) picked.push(coords[coords.length - 1]);
  const out = [];
  for (const [lon, lat] of picked) {
    const p = [round6(lat), round6(lon)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

