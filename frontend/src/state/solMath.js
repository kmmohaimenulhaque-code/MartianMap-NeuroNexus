/*
 * Pure sol / season helpers behind the console's single activeSol (MY34 scenario sol, 1..668).
 * Ls comes from the NASA Ames MGCM MY34 table served by /api/dust/meta (never re-derived here).
 * Calendar: MY34 began 2017-03-23 (Piqueux et al. 2015 numbering); a sol is 88,775.244 s.
 */

export const SOL_SECONDS = 88775.244;
export const MY34_START_UTC = Date.UTC(2017, 2, 23);
/* Curiosity landed 2012-08-06 05:17:57 UTC (mission sol 0). Perseverance landed 2021-02-18 (MY36). */
export const MSL_LANDING_UTC = Date.UTC(2012, 7, 6, 5, 17, 57);
export const M2020_LANDING_UTC = Date.UTC(2021, 1, 18, 20, 55);

export function lsAt(table, sol) {
  if (!Array.isArray(table) || !table.length) return null;
  const v = table[Math.min(table.length, Math.max(1, Math.round(sol))) - 1];
  return Number.isFinite(v) ? v : null;
}

/* Column index of a season bin (e.g. 15 deg bins over 0..360). */
export function lsBin(ls, binDeg) {
  if (!Number.isFinite(ls) || !(binDeg > 0)) return null;
  return Math.floor((((ls % 360) + 360) % 360) / binDeg);
}

export function my34SolToUtc(sol) {
  return new Date(MY34_START_UTC + (Math.max(1, sol) - 1) * SOL_SECONDS * 1000);
}

/* Mission sol of a rover at a MY34 scenario sol; null when the rover was not yet on Mars. */
export function missionSolAt(rover, my34Sol) {
  const t = my34SolToUtc(my34Sol).getTime();
  const landing = rover === "m2020" ? M2020_LANDING_UTC : MSL_LANDING_UTC;
  if (t < landing) return null;
  return Math.floor((t - landing) / (SOL_SECONDS * 1000));
}

export function seasonName(ls) {
  if (!Number.isFinite(ls)) return "season unknown";
  const names = ["northern spring", "northern summer", "northern autumn", "northern winter"];
  return names[lsBin(ls, 90)];
}

/* Solar geometry: same formulas as science/conditions/solar.py (parity-tested). */
export const OBLIQUITY_DEG = 25.19;
const RAD = Math.PI / 180;
const DUST_CLASS = { low: "WITHIN", moderate: "WITHIN", high: "REVIEW", very_high: "EXCEED" };
export const DUST_BANDS = [
  { level: "low", max: 0.2 },
  { level: "moderate", max: 0.5 },
  { level: "high", max: 1.0 },
  { level: "very_high", max: null },
];

export function dustLevel(tau) {
  if (!Number.isFinite(tau)) return null;
  return DUST_BANDS.find((b) => b.max == null || tau < b.max).level;
}

export function solarGeometry(latDeg, lsDeg, tau = null) {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lsDeg)) return null;
  const dec = Math.asin(Math.sin(OBLIQUITY_DEG * RAD) * Math.sin(lsDeg * RAD)) / RAD;
  const noon = 90 - Math.abs(latDeg - dec);
  const x = -Math.tan(latDeg * RAD) * Math.tan(dec * RAD);
  const day = x <= -1 ? 24 : x >= 1 ? 0 : (24 * Math.acos(x)) / RAD / 180;
  const out = { declinationDeg: dec, noonElevationDeg: noon, daylightH: day };
  if (Number.isFinite(tau)) {
    if (noon > 0) out.directBeam = Math.exp(-tau / Math.sin(noon * RAD));
    out.dustLevel = dustLevel(tau);
    out.dustClass = DUST_CLASS[out.dustLevel];
  }
  return out;
}
