/* Device and preference checks shared by the landing modules. */

const mq = (q) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });

export const reducedMotion = () => mq("(prefers-reduced-motion: reduce)").matches;
export const finePointer = () => mq("(hover: hover) and (pointer: fine)").matches;
export const isPhone = () => mq("(max-width: 767px)").matches;
export const saveData = () => Boolean(typeof navigator !== "undefined" && navigator.connection && navigator.connection.saveData);

/* A short vibration tick on devices that support it (Android). Never required, off under reduced motion. */
export function haptic(ms = 10) {
  try {
    if (!reducedMotion() && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    /* some browsers throw when vibration is blocked; ignore */
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function onReducedMotionChange(fn) {
  mq("(prefers-reduced-motion: reduce)").addEventListener?.("change", fn);
}
