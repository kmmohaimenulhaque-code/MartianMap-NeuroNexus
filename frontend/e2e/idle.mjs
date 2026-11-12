/*
 * Screenshots only once the maps have finished loading: no network request in flight (API, ArcGIS and Leaflet
 * tiles), every Leaflet tile loaded and no loading pop-up, all held for `quietMs`. Gives up after `timeoutMs`
 * and says so, rather than hanging on a slow tile server.
 */
export function trackIdle(page) {
  const inflight = new Set();
  page.on("request", (r) => inflight.add(r));
  page.on("requestfinished", (r) => inflight.delete(r));
  page.on("requestfailed", (r) => inflight.delete(r));
  return async function waitIdle({ quietMs = 2000, timeoutMs = 90000 } = {}) {
    const end = Date.now() + timeoutMs;
    let quietSince = 0;
    while (Date.now() < end) {
      const busy =
        inflight.size > 0 ||
        (await page.evaluate(() => Boolean(document.querySelector(".leaflet-tile:not(.leaflet-tile-loaded), [data-testid=loading-overlay]"))).catch(() => false));
      if (busy) quietSince = 0;
      else if (!quietSince) quietSince = Date.now();
      else if (Date.now() - quietSince >= quietMs) return true;
      await page.waitForTimeout(250);
    }
    console.log(`idle: still loading after ${timeoutMs / 1000} s (${inflight.size} requests in flight)`);
    return false;
  };
}
