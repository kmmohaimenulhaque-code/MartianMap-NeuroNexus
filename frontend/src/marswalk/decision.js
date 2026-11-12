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

