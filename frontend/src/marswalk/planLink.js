/*
 * Shareable MARSWALK plan link: the plan request (site, targets, EVA length, terrain mode, parameter overrides),
 * the active sol and the plan_id it produced, carried in the URL hash as #mw=<base64url JSON>. Opening the link
 * replans the same request and reports whether the new plan_id matches (validation V5, determinism).
 * Decoding is strict: anything malformed is ignored rather than guessed.
 */
const SITES = ["gale", "jezero"];
const MODES = ["ladder", "ctx_mola", "mola"];
const OVERRIDE_KEYS = ["eva_pace_kmh", "slope_review_deg", "slope_limit_deg", "reserve_fraction", "body_mass_kg", "suit_and_payload_mass_kg", "terrain_factor_rough"];
const PREFIX = "#mw=";

const toB64Url = (text) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (text) => decodeURIComponent(escape(atob(text.replace(/-/g, "+").replace(/_/g, "/"))));
const finite = (v) => typeof v === "number" && Number.isFinite(v);

export function encodePlanLink({ site, targets, evaHours, mode, overrides, sol, planId }) {
  const payload = {
    v: 1,
    site,
    t: targets.map((t) => [Math.round(t.lat * 1e6) / 1e6, Math.round(t.lon * 1e6) / 1e6]),
    eva: evaHours,
    mode,
    ...(overrides && Object.keys(overrides).length ? { ov: overrides } : {}),
    ...(sol ? { sol } : {}),
    ...(planId ? { pid: planId } : {}),
  };
  return PREFIX + toB64Url(JSON.stringify(payload));
}

export function decodePlanLink(hash) {
  if (typeof hash !== "string" || !hash.startsWith(PREFIX)) return null;
  let p;
  try {
    p = JSON.parse(fromB64Url(hash.slice(PREFIX.length)));
  } catch {
    return null;
  }
  if (!p || p.v !== 1 || !SITES.includes(p.site) || !MODES.includes(p.mode) || ![4, 8].includes(p.eva)) return null;
  if (!Array.isArray(p.t) || p.t.length < 1 || p.t.length > 5) return null;
  const targets = p.t.map((pair) => (Array.isArray(pair) && finite(pair[0]) && finite(pair[1]) && Math.abs(pair[0]) <= 90 && Math.abs(pair[1]) <= 360 ? { lat: pair[0], lon: pair[1] } : null));
  if (targets.includes(null)) return null;
  const overrides = {};
  for (const [key, value] of Object.entries(p.ov ?? {})) if (OVERRIDE_KEYS.includes(key) && finite(value)) overrides[key] = value;
  const sol = Number.isInteger(p.sol) && p.sol >= 1 && p.sol <= 668 ? p.sol : null;
  const sharedPlanId = typeof p.pid === "string" && /^[\w.:-]{4,128}$/.test(p.pid) ? p.pid : null;
  return { id: "shared-link", site: p.site, targets, evaHours: p.eva, mode: p.mode, overrides, sol, sharedPlanId, groundTruth: false, label: "Shared plan link" };
}
