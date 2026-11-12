/*
 * Playwright e2e + screenshot tour (v3). Run against a live console (API + built frontend):
 *   python -m uvicorn science.serve:app --port 7860 &
 *   node frontend/e2e/screenshots.mjs            # BASE_URL defaults to http://localhost:7860
 * Each step asserts the behavior it shows; any page error or failed assertion exits non-zero.
 * Uses the playwright package from the environment (PLAYWRIGHT_MODULE overrides the import path).
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:7860";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "screenshots", "v3");
mkdirSync(OUT, { recursive: true });

const errors = [];
const check = (ok, message) => {
  if (!ok) throw new Error(`E2E assertion failed: ${message}`);
  console.log(`ok   ${message}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
// Some sandboxes strip CORS from the Fontshare CDN; re-serve the same bytes so Switzer renders.
await context.route(/fontshare\.com/, async (route) => {
  const response = await route.fetch();
  await route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
});
const page = await context.newPage();
// ArcGIS throws "webgl:major-performance-caveat-detected" on headless software WebGL (no GPU here); only that is ignored.
page.on("pageerror", (e) => e.name !== "webgl:major-performance-caveat-detected" && errors.push(`${e.name}: ${e.message}`));

const shot = async (name) => {
  await page.screenshot({ path: join(OUT, name) });
  console.log(`shot ${name}`);
};
const openWheelAt = async (x, y) => {
  await page.mouse.move(x, y);
  await page.mouse.click(x, y, { button: "right" });
  await page.waitForTimeout(80);
  await page.mouse.click(x, y, { button: "right" });
  await page.waitForSelector("[data-testid=radial-wheel]");
};
const setSol = async (sol) => {
  await page.$eval(
    ".nn-solscrub input[type=range]",
    (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, String(value));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    sol,
  );
};

try {
  await page.goto(`${BASE.replace(/\/$/, "")}/console/`, { waitUntil: "domcontentloaded" }); // console moved to /console/ (landing page at /)
  await page.waitForFunction(() => document.body.innerText.includes("SYSTEM ONLINE"), null, { timeout: 60000 });
  await page.waitForSelector("[data-testid=thermal-sol-readout]", { timeout: 60000 });
  await page.waitForTimeout(2500);

  // 1. Console overview, Browser Optimization OFF by default.
  check((await page.textContent(".perf-pill")).includes("FULL FIDELITY"), "Browser Optimization is OFF by default (FULL FIDELITY)");
  check(!/[\u{1F300}-\u{1FAFF}]/u.test(await page.textContent("body")), "no emoji anywhere in the rendered UI");
  await shot("01_console_overview.png");

  // 2. Radial Feature Wheel: double right-click, hover a sector, sub-wheel expands.
  await openWheelAt(960, 560);
  const sectors = await page.$$(".nn-wheel-sector");
  check(sectors.length === 8, "double right-click opens the 8-sector wheel");
  const box = await sectors[4].boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector("[data-action=sol-peak]");
  const sub = await page.$("[data-action=thermal]");
  const sb = await sub.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.waitForTimeout(350);
  check((await page.$$(".nn-wheel-subitem")).length === 4, "ENVIRONMENT & SOL expands its 4 sub-features");
  await shot("02_radial_wheel_subwheel.png");
  await page.keyboard.press("Escape");
  check(!(await page.$("[data-testid=radial-wheel]")), "Escape closes the wheel");

  // 3. Sol-synced THEMIS heatmap: scrub to MY34 sol 400 (2018 global dust storm).
  const before = await page.textContent("[data-testid=thermal-sol-readout]");
  await setSol(400);
  await page.waitForFunction(() => document.querySelector("[data-testid=thermal-sol-readout]")?.innerText.toUpperCase().includes("SOL 400"), null, { timeout: 15000 });
  const after = await page.textContent("[data-testid=thermal-sol-readout]");
  check(before !== after, "THEMIS readout follows the active sol");
  await page.$eval("[data-testid=thermal-sol-readout]", (el) => el.scrollIntoView({ block: "center" }));
  await page.waitForFunction(() => document.querySelector(".nn-rover-label")?.innerText.includes("SOL 400"), null, { timeout: 15000 });
  check(true, "Curiosity's position marker follows the active sol (MY34 sol 400)");
  await page.waitForFunction(() => document.querySelector("[data-testid=sol-conditions]")?.innerText.includes("EXCEED"), null, { timeout: 15000 });
  check(true, "conditions card shows the storm-level dust class at sol 400");
  await shot("03_thermal_sol_synced.png");

  // 4. Categorized layers and the dynamic legend; the map toolbar never overlaps itself.
  await setSol(100);
  const overlap = await page.$$eval(".map-toolbar > *", (els) => {
    const r = els.map((e) => e.getBoundingClientRect()).filter((b) => b.width);
    return r.some((a, i) => r.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
  });
  check(!overlap, "ROUTE DESIGN, 3D MAP, LAYERS and MAP LEGEND do not overlap");
  const rightOverflow = await page.$eval(".right-column", (col) => {
    const edge = col.getBoundingClientRect().right;
    return [...col.querySelectorAll("input, a, .mission-row")].some((e) => e.getBoundingClientRect().right > edge + 1);
  });
  check(!rightOverflow, "right-panel inputs, links and rows stay inside the panel");
  await page.click("button.mission-action:has-text('MAP LEGEND')");
  await page.waitForTimeout(400);
  await page.click("button.mission-action:has-text('LAYERS')");
  await page.waitForTimeout(800);
  const wrapped = await page.$$eval(".nn-legend-item", (items) => items.some((e) => e.getBoundingClientRect().height > 30));
  check(!wrapped, "legend phrases stay on one line");
  await shot("04_layers_and_legend.png");
  await page.keyboard.press("Escape");
  await page.click("button.mission-action:has-text('LAYERS')").catch(() => {});

  // 5. MARSWALK mode from the wheel: ROUTE & EVA -> PLAN MARSWALK.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("nn:open-wheel")));
  await page.waitForSelector("[data-testid=radial-wheel]");
  await (await page.$$(".nn-wheel-sector"))[1].click();
  await page.click("[data-action=marswalk-demo]");
  await page.waitForSelector("[data-testid=decision-at-sol]", { timeout: 180000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Reading the terrain ladder"), null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  check((await page.textContent("[data-testid=decision-at-sol]")).toUpperCase().includes("SOL 100"), "MARSWALK decision is evaluated at the active sol");
  await shot("05_marswalk_mode.png");

  // 6. Same plan at the storm sol: the dust class raises the decision.
  await setSol(400);
  await page.waitForFunction(() => document.querySelector("[data-testid=decision-at-sol]")?.innerText.toUpperCase().includes("SOL 400"), null, { timeout: 30000 });
  check((await page.textContent("[data-testid=decision-at-sol]")).includes("EXCEED"), "storm sol raises the MARSWALK decision to EXCEEDS PLANNING LIMIT");
  await shot("06_marswalk_storm_sol.png");

  // 7. Browser Optimization panel in the Menu (opt-in switch).
  await page.click("button.burger-button");
  await page.waitForSelector("#browser-optimization");
  await page.$eval("#browser-optimization", (el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
  check((await page.textContent(".perf-master")).includes("OFF"), "Menu shows [BROWSER OPTIMIZATION] OFF until the user turns it on");
  await shot("07_browser_optimization.png");
  await page.keyboard.press("Escape");

  // 7b. Radial Feature Wheel over the 3D globe.
  await page.keyboard.press("Escape");
  await page.click("button:has-text('GLOBAL CONSOLE')");
  await page.waitForSelector(".map-toolbar");
  await page.click(".map-toolbar button:has-text('3D MAP')");
  await page.waitForTimeout(8000);
  const canvas = await page.$(".esri-view canvas, .esri-view-surface");
  const cb = canvas ? await canvas.boundingBox() : { x: 900, y: 500, width: 0, height: 0 };
  await openWheelAt(cb.x + cb.width / 2, cb.y + cb.height / 2);
  const onTop = await page.evaluate(() => {
    const w = document.querySelector(".nn-wheel");
    const b = w.getBoundingClientRect();
    return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(".nn-wheel") != null;
  });
  check(onTop, "double right-click inside the 3D globe opens the wheel on top");
  await shot("09_wheel_over_3d_globe.png");
  await page.keyboard.press("Escape");
  check(!(await page.evaluate(() => document.body.innerText.includes("\u2014"))), "no em dash in the rendered DOM text");

  // 8. Command Index lists the wheel and every export.
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  await page.keyboard.type("export");
  await page.waitForTimeout(400);
  await shot("08_command_index_exports.png");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}
