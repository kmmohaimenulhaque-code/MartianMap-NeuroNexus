/*
 * Record the static demo pack: real responses from a running NeuroNexus backend, keyed exactly as
 * frontend/public/demo-sw.js will look them up (frontend/public/demo-canon.js is shared via vm).
 *
 *   python -m uvicorn science.serve:app --port 7860 &
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright/index.mjs node tools/record_demo_pack.mjs [outDir]
 *
 * 1. A Playwright tour (global console, layers, every Marswalk demo and terrain mode, ground truth,
 *    validation, sources, manual) records every /api request the console makes.
 * 2. Every request that carries the console's sol is replayed for all 668 MY34 sols directly
 *    against the backend, so the ACTIVE SOL slider works everywhere in the demo.
 * Nothing is synthesized: each file is the backend's own response body.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL ?? "http://localhost:7860";
const OUT = process.argv[2] ?? join(ROOT, "build", "demo-pack");
const MAX_SOL = 668;

vm.runInThisContext(readFileSync(join(ROOT, "frontend/public/demo-canon.js"), "utf8"));
const { requestKey, fileName } = globalThis.nnDemoCanon;
const { missionSolAt } = await import(join(ROOT, "frontend/src/state/solMath.js"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "r"), { recursive: true });
const entries = {};
const recorded = []; // [{ method, url, body }]
let bytes = 0;

async function store(method, url, bodyText, status, type, buffer) {
  const u = new URL(url);
  const key = await requestKey(method, u.pathname, u.search, bodyText);
  if (entries[key]) return key;
  const f = await fileName(key);
  writeFileSync(join(OUT, "r", f), buffer);
  bytes += buffer.length;
  entries[key] = { f, s: status, t: type || "application/octet-stream" };
  return key;
}

/* ---------------------------------------------------------------- 1. the tour */
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.route(/fontshare\.com/, async (route) => {
  const response = await route.fetch();
  await route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
});
await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
  const req = route.request();
  let response;
  try {
    response = await route.fetch({ timeout: 300000 }); // cold HiRISE/CTX COG reads can take minutes
  } catch (error) {
    console.log(`skip ${req.method()} ${req.url().slice(0, 120)}: ${error.message.split("\n")[0]}`);
    await route.abort().catch(() => {});
    return;
  }
  const body = await response.body();
  if (response.status() < 500) {
    await store(req.method(), req.url(), req.postData() ?? "", response.status(), response.headers()["content-type"], body);
    recorded.push({ method: req.method(), url: req.url(), body: req.postData() ?? "" });
  }
  await route.fulfill({ response, body });
});
// Every map layer on, so each layer's data request is recorded (the visitor's default set is a subset).
await context.addInitScript(() => {
  const all = ["mola", "hiriseFootprints", "features", "waypoints", "dust", "landingSites", "mslTraverse", "m2020Traverse", "routes"];
  localStorage.setItem("nn.layers", JSON.stringify(Object.fromEntries(all.map((k) => [k, true]))));
});
const page = await context.newPage();
const step = (msg) => console.log(`tour ${msg}`);
const idle = (ms = 1500) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.innerText.includes("SYSTEM ONLINE"), null, { timeout: 90000 });
await page.waitForSelector("[data-testid=thermal-sol-readout]", { timeout: 90000 });
await idle(3000);
step("global console at Gale");

await idle(4000);
step("layers (all on via nn.layers)");

// Sol-dependent requests at two sols, so their URL patterns are known.
for (const sol of [101, 400]) {
  await page.$eval(".nn-solscrub input[type=range]", (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, sol);
  await idle(2500);
}
step("sol scrub");

// Marswalk demos from the Mission Operations Manual quick starts, plus each terrain mode and ground truth.
async function quickStart(id) {
  await page.click("button.burger-button");
  await page.click(`[data-quickstart="${id}"]`);
  await page.waitForSelector("[data-testid=decision-at-sol]", { timeout: 240000 }).catch(() => {});
  await page.waitForFunction(() => !document.body.innerText.includes("Reading the terrain ladder"), null, { timeout: 240000 }).catch(() => {});
  await idle(3000);
}
for (const label of ["demo-gale", "demo-jezero", "demo-ground-truth"]) {
  await quickStart(label);
  for (const mode of ["CTX + MOLA", "MOLA ONLY", "LADDER"]) {
    await page.click(`.mw-shell button:has-text("${mode}")`).catch(() => {});
    await page.waitForFunction(() => !document.body.innerText.includes("PLANNING…"), null, { timeout: 240000 }).catch(() => {});
    await idle(2500);
  }
  for (const overlay of await page.$$(".mw-shell input[type=checkbox]")) {
    if (!(await overlay.isChecked())) await overlay.click().catch(() => {});
    await idle(1500);
  }
  step(`marswalk ${label}`);
}

// Sources drawer, manual status, command index.
await page.click("button:has-text('[SOURCE LEDGER]')").catch(() => {});
await idle(1500);
await page.keyboard.press("Escape");
await page.click("button.burger-button").catch(() => {});
await idle(2500);
await page.keyboard.press("Escape");
step("drawers");
await browser.close();

/* ---------------------------------------------------------------- 2. every sol */
const solRequests = recorded.filter((r) => r.method === "GET" && /[?&](sol|sol_max)=/.test(r.url));
const patterns = new Map();
for (const r of solRequests) {
  const u = new URL(r.url);
  const params = new URLSearchParams(u.search);
  const shape = `${u.pathname}?${[...params.keys()].sort().join("&")}|${[...params.entries()].filter(([k]) => !/^sol/.test(k)).map(([k, v]) => `${k}=${v}`).sort().join("&")}`;
  patterns.set(shape, u);
}
console.log(`sol patterns: ${[...patterns.keys()].map((k) => k.split("|")[0]).join(", ")}`);

async function grab(url) {
  const r = await fetch(url);
  if (r.status >= 500) return false;
  await store("GET", url, "", r.status, r.headers.get("content-type"), Buffer.from(await r.arrayBuffer()));
  return true;
}
for (const u of patterns.values()) {
  const isRover = u.pathname.startsWith("/api/rovers/") && u.searchParams.has("sol_max");
  for (let sol = 1; sol <= MAX_SOL; sol += 1) {
    const next = new URL(u);
    if (isRover) {
      const m = missionSolAt(u.pathname.includes("m2020") ? "m2020" : "msl", sol);
      if (m == null) continue;
      next.searchParams.set("sol_min", String(Math.max(0, m - 120)));
      next.searchParams.set("sol_max", String(m));
    } else {
      next.searchParams.set("sol", String(sol));
    }
    await grab(next.toString());
  }
}

const recordedAt = new Date().toISOString().slice(0, 10);
const manifest = {
  schema: "neuronexus.demo-pack.v1",
  recorded_at: recordedAt,
  backend: BASE,
  commit: process.env.NN_COMMIT ?? null,
  note: "Real responses recorded from the NeuroNexus backend; the service worker answers only these keys.",
  count: Object.keys(entries).length,
  bytes,
  entries,
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest));
const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);
console.log(`demo pack: ${manifest.count} responses, ${(bytes / 2 ** 20).toFixed(1)} MB, entries digest ${digest} → ${OUT}`);
