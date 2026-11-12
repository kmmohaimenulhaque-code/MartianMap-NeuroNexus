/*
 * Multi-device verification (desktop, iPad, iPhone 15, Android Chrome) against a live console:
 *   python -m uvicorn science.serve:app --port 7860 &
 *   node frontend/e2e/devices.mjs                # BASE_URL defaults to http://localhost:7860
 * Asserts the responsive layout rules and saves the mobile showcase screenshots to assets/screenshots/v3.
 * Chromium device emulation (viewport, touch, mobile UA flags); it is not a real iOS Safari or Android device.
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
  if (!ok) throw new Error(`DEVICE ASSERTION FAILED: ${message}`);
  console.log(`ok   ${message}`);
};

const browser = await chromium.launch();

async function open(name, viewport, touch) {
  const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1 });
  await context.route(/fontshare\.com/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => e.name !== "webgl:major-performance-caveat-detected" && errors.push(`${name} ${e.name}: ${e.message}`));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /ONLINE/.test(document.querySelector(".status-dot")?.textContent ?? ""), null, { timeout: 120000 });
  await page.waitForSelector(".leaflet-container", { timeout: 60000 });
  await page.waitForTimeout(2500);
  return { context, page };
}

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, visible: getComputedStyle(el).visibility !== "hidden" && r.width > 0 };
}, selector);
const overlappingButtons = (page) => page.evaluate(() => {
  const rects = [...document.querySelectorAll(".topbar button, .topbar .status-dot, .topbar .brand-block h1, .nn-dock button")].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
  let n = 0;
  for (let i = 0; i < rects.length; i += 1)
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n += 1;
    }
  return n;
});
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, name) });
  console.log(`shot ${name}`);
};

/* ---------------------------------------------------------------- desktop 1440 x 900 */
{
  const { context, page } = await open("desktop", { width: 1440, height: 900 }, false);
  check(await noOverflow(page), "desktop 1440: no horizontal overflow");
  const left = await box(page, ".left-column");
  const right = await box(page, ".right-column");
  check(left?.visible && right?.visible && left.left < 20 && right.right <= 1440, "desktop 1440: 3-column cockpit, both side columns on screen");
  check(!(await box(page, ".nn-dock"))?.width, "desktop 1440: no mobile dock");
  await context.close();
}

/* ---------------------------------------------------------------- iPad 768 x 1024 */
{
  const { context, page } = await open("ipad", { width: 768, height: 1024 }, true);
  check(await noOverflow(page), "iPad 768: no horizontal overflow");
  check((await box(page, ".nn-dock"))?.width === 768, "iPad 768: tactical dock spans the width");
  const map = await box(page, ".map-panel-body");
  check(map.width >= 480, `iPad 768: map viewport ${Math.round(map.width)} px wide (>= 480)`);
  await page.click('[data-dock="intel"]');
  await page.waitForTimeout(400);
  const intel = await box(page, ".left-column");
  check(intel.visible && intel.left === 0, "iPad 768: INTEL opens the left drawer");
  await shot(page, "tablet-drawer-ipad.png");
  await page.click('[data-dock="mission"]');
  await page.waitForTimeout(400);
  const mission = await box(page, ".right-column");
  check(mission.visible && Math.abs(mission.right - 768) < 2, "iPad 768: MISSION opens the right drawer");
  await context.close();
}

/* ---------------------------------------------------------------- iPhone 15 393 x 852 */
{
  const { context, page } = await open("iphone", { width: 393, height: 852 }, true);
  check(await noOverflow(page), "iPhone 393: no horizontal overflow");
  check((await overlappingButtons(page)) === 0, "iPhone 393: no overlapping header or dock buttons");
  const dockButtons = await page.$$eval(".nn-dock button", (els) => els.map((e) => e.getBoundingClientRect()).map((r) => Math.min(r.width, r.height)));
  check(dockButtons.length === 5 && dockButtons.every((s) => s >= 44), "iPhone 393: five dock tabs, each at least 44 x 44");
  await shot(page, "mobile-console-ios.png");

  await page.click('[data-dock="intel"]');
  await page.waitForTimeout(450);
  const sheet = await box(page, ".left-column");
  check(sheet.visible && sheet.left === 0 && sheet.right === 393 && sheet.bottom - sheet.top <= 852 * 0.78 + 1, "iPhone 393: INTEL bottom sheet, at most 78% of the height");
  await shot(page, "mobile-intel-sheet-ios.png");
  await page.click(".left-column .nn-sheet-close");
  await page.waitForTimeout(400);
  check(!(await box(page, ".left-column")).visible, "iPhone 393: [CLOSE] hides the sheet");

  await page.click('[data-dock="mission"]');
  await page.waitForTimeout(450);
  check((await box(page, ".right-column")).visible, "iPhone 393: MISSION bottom sheet");
  await page.click('[data-dock="map"]');
  await page.waitForTimeout(400);

  // Long-press (500 ms, one finger) on the map opens the Radial Feature Wheel.
  const mapBox = await box(page, ".map-panel-body .leaflet-container");
  const cdp = await context.newCDPSession(page);
  const point = { x: Math.round(mapBox.left + mapBox.width / 2), y: Math.round(mapBox.top + mapBox.width / 2) };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForSelector("[data-testid=radial-wheel]", { timeout: 3000 });
  check(true, "iPhone 393: long-press on the map opens the wheel");
  await page.click(".nn-wheel-sector >> nth=2");
  await page.waitForTimeout(500);
  const wheel = await box(page, ".nn-wheel-svg");
  const sub = await box(page, ".nn-wheel-sub");
  check(wheel.left >= 0 && wheel.right <= 393 && sub.left >= 0 && sub.right <= 393, "iPhone 393: wheel and tapped sub-wheel fit inside 393 px");
  await shot(page, "mobile-radial-wheel.png");
  await page.keyboard.press("Escape");

  await page.click(".map-3d-button");
  await page.waitForTimeout(12000);
  check(await noOverflow(page), "iPhone 393: 3D globe panel opens without overflow (headless has no GPU, so the globe itself is not rendered here)");
  await page.keyboard.press("Escape");
  await page.click(".map-3d-button").catch(() => {});

  await page.click("button.burger-button");
  await page.click('[data-quickstart="demo-gale"]');
  await page.waitForSelector("[data-testid=decision-at-sol]", { state: "attached", timeout: 240000 });
  await page.waitForTimeout(2500);
  check(await noOverflow(page), "iPhone 393: MARSWALK without overflow");
  await shot(page, "mobile-marswalk.png");
  await page.click('[data-dock="mission"]');
  await page.waitForSelector("[data-testid=season-ribbon] svg", { timeout: 60000 });
  await page.waitForTimeout(400);
  await shot(page, "mobile-marswalk-decision.png");
  await context.close();
}

/* ---------------------------------------------------------------- Android Chrome 360 x 800 */
{
  const { context, page } = await open("android", { width: 360, height: 800 }, true);
  check(await noOverflow(page), "Android 360: scrollWidth <= innerWidth");
  check((await overlappingButtons(page)) === 0, "Android 360: no overlapping buttons");
  await page.click('[data-dock="route"]');
  await page.waitForTimeout(450);
  check((await box(page, ".route-console")).visible, "Android 360: ROUTE sheet");
  await shot(page, "android-route-sheet.png");
  await context.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("devices: all checks passed");
