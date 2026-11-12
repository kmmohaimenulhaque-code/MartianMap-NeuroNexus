/*
 * Install as app was removed. Browsers that registered its service worker (/app-sw.js) unregister it here,
 * so no stale worker or install prompt remains. The static demo's own worker (/demo-sw.js) is left alone.
 */
if (typeof navigator !== "undefined" && navigator.serviceWorker?.getRegistrations) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.filter((r) => /\/app-sw\.js$/.test(r.active?.scriptURL ?? r.installing?.scriptURL ?? "")).forEach((r) => r.unregister()))
    .catch(() => {});
}
