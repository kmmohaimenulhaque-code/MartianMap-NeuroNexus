/*
 * Static demo service worker: answers same-origin /api/* requests from the demo pack, a set of real
 * responses recorded from the live NeuroNexus backend (tools/record_demo_pack.mjs). A request that
 * was not recorded gets an honest 503 NOT_IN_DEMO_PACK; nothing is synthesized.
 */
/* global importScripts */
importScripts("/demo-canon.js");

const PACK = "/demo-pack/";
let manifestPromise = null;
const manifest = () => (manifestPromise ??= fetch(PACK + "manifest.json").then((r) => r.json()));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/api/")) return;
  event.respondWith(replay(event.request, url));
});

async function replay(request, url) {
  const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
  const key = await self.nnDemoCanon.requestKey(request.method, url.pathname, url.search, body);
  const m = await manifest();
  const entry = m.entries[key];
  if (!entry) {
    const error = {
      error: {
        code: "NOT_IN_DEMO_PACK",
        message: "Static demo: this request was not recorded, so no value is shown.",
        hint: "Run the full console locally (README Quick start) for live computation.",
      },
    };
    return new Response(JSON.stringify(error), { status: 503, headers: { "content-type": "application/json", "x-nn-demo": "miss" } });
  }
  const r = await fetch(PACK + "r/" + entry.f);
  return new Response(r.body, { status: entry.s, headers: { "content-type": entry.t, "x-nn-demo": "replay" } });
}
