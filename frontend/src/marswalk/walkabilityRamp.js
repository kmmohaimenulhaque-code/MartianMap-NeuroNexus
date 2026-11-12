/*
 * Walkability colors come from tokens.css (never hard-coded here): read the CSS custom properties
 * at runtime and interpolate cyan -> amber -> red with falling luminance. EXCEED is also hatched.
 */

export const RAMP_TOKENS = ["--nn-walk-ramp-lo", "--nn-walk-ramp-mid", "--nn-walk-ramp-hi"];
export const CLASS_TOKENS = {
  "WITHIN PLANNING LIMITS": "--nn-walk-within",
  "REVIEW REQUIRED": "--nn-walk-review",
  "EXCEEDS PLANNING LIMIT": "--nn-walk-exceed",
  UNAVAILABLE: "--nn-walk-unavail",
};
export const SOURCE_TOKENS = { HIRISE: "--nn-src-hirise", CTX: "--nn-src-ctx", MOLA: "--nn-src-mola", NONE: "--nn-walk-unavail" };

export function hexToRgb(hex) {
  const h = String(hex).trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rampColor(walk, stops) {
  const [lo, mid, hi] = stops.map(hexToRgb);
  const t = Math.min(1, Math.max(0, walk / 100));
  const [a, b, f] = t < 0.5 ? [lo, mid, t * 2] : [mid, hi, t * 2 - 1];
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * f));
  return `rgb(${rgb.join(", ")})`;
}

export function luminance(rgbText) {
  const [r, g, b] = rgbText.match(/\d+/g).map((n) => Number(n) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function cssVar(name, element = typeof document !== "undefined" ? document.documentElement : null) {
  if (!element) return "";
  return getComputedStyle(element).getPropertyValue(name).trim();
}

export function tokenColor(token) {
  return `var(${token})`;
}
