/* Number → display text, or null when there is no finite value. */
export function fmt(value, digits = 1, unit = "") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const text = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(digits);
  return `${text}${unit}`;
}
