/*
 * Installable-app service worker (normal builds; the static demo uses demo-sw.js instead). It does not cache
 * data: the console needs its API for every number. Page loads go to the network; only when the network is
 * unreachable does it show the offline page, so a stale value is never presented as current.
 */
const SHELL = "nn-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([OFFLINE, "/pwa/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("nn-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()));
});
