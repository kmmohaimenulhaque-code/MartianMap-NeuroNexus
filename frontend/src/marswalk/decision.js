/* MARSWALK decision helpers shared by the decision card and the exports. */

const DUST_STATUS = { WITHIN: "WITHIN PLANNING LIMITS", REVIEW: "REVIEW REQUIRED", EXCEED: "EXCEEDS PLANNING LIMIT" };
const RANK = { "WITHIN PLANNING LIMITS": 0, "REVIEW REQUIRED": 1, "EXCEEDS PLANNING LIMIT": 2 };

/* The route status combined with the modeled dust class at the console's activeSol (worst of the two). */
export function statusAtSol(routeStatus, dustClass) {
  const dust = DUST_STATUS[dustClass];
  if (!dust || !(routeStatus in RANK)) return routeStatus;
  return RANK[dust] > RANK[routeStatus] ? dust : routeStatus;
}
