/*
 * Multi-device verification against a live console:
 *   python -m uvicorn science.serve:app --port 7860 &
 *   node frontend/e2e/devices.mjs                # BASE_URL defaults to http://localhost:7860
 * PCs, laptops and tablets (>= 768 px) keep the 3-column cockpit; phones (< 768 px) get the 2-row HUD, the
 * full-height map, the bottom dock and sheets. Saves the showcase screenshots to assets/screenshots/v3.
 * Chromium device emulation (viewport, touch, mobile flags); not a real iOS Safari or Android device.
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

// WebGL on any machine: ANGLE, GPU blocklist ignored (software rendering where there is no GPU).
const browser = await chromium.launch({ args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--enable-unsafe-swiftshader"] });

async function open(name, viewport, touch, dpr = touch ? 2 : 1) {
  const context = await browser.newContext({ viewport, isMobile: touch && viewport.width < 768, hasTouch: touch, deviceScaleFactor: dpr });
  await context.route(/fontshare\.com/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name} ${e.name}: ${e.message}`));
  await page.goto(`${BASE.replace(/\/$/, "")}/console/`, { waitUntil: "domcontentloaded" }); // console moved to /console/ (landing page at /)
  await page.waitForFunction(() => /ONLINE/.test(document.querySelector(".status-dot")?.textContent ?? ""), null, { timeout: 120000 });
  await page.waitForSelector(".leaflet-container", { timeout: 60000 });
  await page.waitForTimeout(2500);
  return { context, page };
}

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = (page, selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, visible: cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 };
  }, selector);
const overlappingButtons = (page) =>
  page.evaluate(() => {
    const rects = [...document.querySelectorAll(".topbar button, .topbar .status-dot, .topbar .brand-block h1, .nn-phone-mapbar button, .nn-phone-mapbar .search-box, .nn-dock button")]
      .filter((e) => e.offsetParent && getComputedStyle(e).visibility !== "hidden")
      .map((e) => e.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < rects.length; i += 1)
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n += 1;
      }
    return n;
  });
// Buttons cut off by the viewport edge (outside sideways-scrolling strips and closed sheets).
const clippedButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((e) => e.offsetParent && getComputedStyle(e).visibility !== "hidden")
      .filter((e) => !e.closest(".mission-actions, .map-legend, .m3d-tools, [style*='visibility: hidden']"))
      .map((e) => ({ t: e.textContent.trim().slice(0, 30), r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.bottom > 0 && r.top < innerHeight && (r.left < -1 || r.right > innerWidth + 1))
      .map(({ t }) => t),
  );
// The 2D map's active selection marker: box, map center, cyan ring, and whether clicks pass through it.
const selectionMarker = (page) =>
  page.evaluate(() => {
    const map = document.querySelector(".map-panel-body .leaflet-container");
    const el = map?.querySelector("[data-testid=map-selection-marker]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const m = map.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      visible: r.width > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0,
      size: Math.round(r.width),
      dx: r.left + r.width / 2 - (m.left + m.width / 2),
      dy: r.top + r.height / 2 - (m.top + m.height / 2),
      inside: r.left >= m.left && r.right <= m.right && r.top >= m.top && r.bottom <= m.bottom,
      passThrough: getComputedStyle(el.closest(".leaflet-marker-icon")).pointerEvents === "none",
      ring: getComputedStyle(el.querySelector(".nn-select-marker__ring")).borderTopColor,
    };
  });
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, name) });
  console.log(`shot ${name}`);
};
const cockpit = async (page, w, label) => {
  check(await noOverflow(page), `${label}: no horizontal overflow`);
  const left = await box(page, ".left-column");
  const right = await box(page, ".right-column");
  const field = await box(page, ".site-field");
  check(left?.visible && right?.visible && field?.visible && left.left < 20 && right.right <= w + 1 && left.right <= field.left && field.right <= right.left,
    `${label}: 3-column cockpit (left ${Math.round(left.width)} | map ${Math.round(field.width)} | right ${Math.round(right.width)})`);
  check(!(await box(page, ".nn-dock"))?.visible, `${label}: no phone dock`);
};

/* ---------------------------------------------------------------- PC / laptop 1440 x 900 */
{
  const { context, page } = await open("desktop", { width: 1440, height: 900 }, false);
  await cockpit(page, 1440, "desktop 1440");
  const zoom = await page.evaluate(() => {
    const a = document.querySelector(".leaflet-control-zoom-in");
    const cs = getComputedStyle(a);
    return { color: cs.color, bg: cs.backgroundColor };
  });
  check(zoom.color === "rgb(1, 255, 255)" && /rgba?\(9, 17, 21/.test(zoom.bg), `desktop 1440: Leaflet zoom buttons are dark cyan (${zoom.color} on ${zoom.bg})`);
  // Leaflet: unmounting the map during an animated zoom must not throw (late _onZoomTransitionEnd timer).
  const before = errors.length;
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => new Promise((done) => {
      document.querySelector(".map-panel-body .leaflet-control-zoom-in").click();
      setTimeout(() => { [...document.querySelectorAll(".mode-switch button")][1].click(); done(); }, 90);
    }));
    await page.waitForTimeout(700);
    await page.evaluate(() => [...document.querySelectorAll(".mode-switch button")][0].click());
    await page.waitForSelector(".map-panel-body .leaflet-control-zoom-in", { timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  check(errors.length === before, "desktop 1440: switching to MARSWALK mid-zoom raises no Leaflet error");

  // Shared LAYERS: a layer turned on from the ArcGIS map's menu is on in the 2D map's menu too.
  await page.click('#panel-usgs-map [role="radio"]:first-child');
  await page.waitForSelector("[data-testid=arcgis-layered] canvas", { timeout: 90000 });
  await page.click("[data-testid=layers-arcgis]");
  const slope = '[data-testid=layers-menu-arcgis] [data-layer="slope"] input[type=checkbox]';
  if (!(await page.isChecked(slope))) await page.click(slope);
  await page.waitForTimeout(3500);
  await shot(page, "desktop-arcgis-layers.png");
  await page.keyboard.press("Escape");
  await page.mouse.click(720, 60);
  await page.click(".map-toolbar [data-testid=layers-2d]");
  check(await page.isChecked('[data-testid=layers-menu-2d] [data-layer="slope"] input[type=checkbox]'), "desktop 1440: SLOPE turned on in the ArcGIS LAYERS menu is on in the 2D LAYERS menu");
  check((await box(page, '[data-testid=layers-menu-2d] [data-layer="slope"] input[type=range]'))?.visible, "desktop 1440: opacity slider shown for an active layer");
  await page.click('[data-testid=layers-menu-2d] [data-layer="slope"] input[type=checkbox]');
  await page.mouse.click(720, 60);

  // Smooth wheel zoom: one standard wheel notch zooms the 2D map by about half a level (it used to jump 2).
  {
    const wb = await page.locator(".map-panel-body .leaflet-container").boundingBox();
    const zoomOf = () => page.evaluate(() => Number(document.querySelector(".map-panel-body .leaflet-container").dataset.zoom));
    await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
    const z0 = await zoomOf();
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(900);
    const step = (await zoomOf()) - z0;
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(900);
    check(step > 0 && step <= 0.75, `desktop 1440: one wheel notch zooms the 2D map by ${step} level (smooth, quarter-level snap)`);
  }

  // Map sync: a pick on the 2D map recenters the ArcGIS map; a pick on the ArcGIS map recenters the 2D map.
  const centerOf = (s) => page.evaluate((s) => document.querySelector(s)?.dataset.center?.split(",").map(Number), s);
  const near = (a, b) => a && b && Math.abs(a[0] - b[0]) < 0.05 && Math.abs(((a[1] - b[1] + 540) % 360) - 180) < 0.05;
  let mb = await page.locator(".map-panel-body .leaflet-container").boundingBox();
  await page.mouse.click(mb.x + mb.width * 0.3, mb.y + mb.height * 0.45);
  await page.waitForTimeout(3000);
  const pick2d = await centerOf(".nn-arcgis-view");
  check(pick2d && !near(pick2d, [-5.3672, 137.811]), `desktop 1440: a 2D pick recenters the ArcGIS map (${pick2d})`);
  mb = await page.locator("[data-testid=arcgis-layered]").boundingBox();
  await page.mouse.click(mb.x + mb.width * 0.7, mb.y + mb.height * 0.3);
  await page.waitForTimeout(3000);
  const d2 = await centerOf(".map-panel-body .leaflet-container");
  check(d2 && !near(d2, pick2d), `desktop 1440: an ArcGIS pick recenters the 2D map (${d2})`);

  // Active selection marker on the 2D map: cyan ring at the selection, above the feature dots, clicks pass through.
  const sel = await selectionMarker(page);
  check(sel?.visible && sel.inside && sel.passThrough && sel.ring === "rgb(1, 255, 255)" && sel.size >= 24,
    `desktop 1440: cyan selection marker visible on the 2D map (${sel?.size} px ring, clicks pass through)`);
  check(Math.abs(sel.dx) <= 3 && Math.abs(sel.dy) <= 3, `desktop 1440: the ArcGIS pick sits under the 2D selection marker at the map center (${Math.round(sel.dx)}, ${Math.round(sel.dy)} px off)`);
  await page.click(".map-panel-body .leaflet-control-zoom-in");
  await page.waitForTimeout(500);
  await page.click(".map-panel-body .leaflet-control-zoom-in");
  await page.waitForTimeout(900);
  const zoomedSel = await selectionMarker(page);
  check(zoomedSel?.visible && zoomedSel.inside && zoomedSel.size === sel.size, "desktop 1440: the selection marker stays visible, same size, when zoomed in");

  // Search: Enter picks the first suggestion and closes the list.
  await page.fill(".search-box input", "Jezero");
  await page.waitForSelector(".suggestions button", { timeout: 15000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  check(!(await page.$(".suggestions")), "desktop 1440: Enter in search selects and closes the suggestions");

  // METHOD popover in the left column: drawn on the page, fully inside the window.
  const method = page.locator(".left-column .nn-pop-trigger", { hasText: "METHOD" }).first();
  await method.scrollIntoViewIfNeeded();
  await method.hover();
  await page.waitForTimeout(400);
  const card = await box(page, ".nn-pop-card");
  check(card?.visible && card.left >= 0 && card.top >= 0 && card.right <= 1440 && card.bottom <= 900, "desktop 1440: METHOD popover is inside the window, not clipped by the panel");
  await page.mouse.move(720, 450);

  // Multi-stop EVA from the menu, then parameter sensitivity on that route.
  await page.click("button.burger-button");
  await page.click('[data-quickstart="demo-multistop"]');
  await page.waitForSelector("[data-testid=decision-at-sol]", { state: "attached", timeout: 240000 });
  await page.waitForTimeout(2500);
  const stops = await page.locator("[data-testid=mw-stops] li").count();
  check(stops === 3, `desktop 1440: multi-stop demo plans through ${stops} stops`);
  await shot(page, "desktop-multistop.png");
  await page.click("#mw-sensitivity .mw-sens-run");
  await page.waitForSelector("#mw-sensitivity .mw-sens-row", { timeout: 180000 });
  const rows = await page.locator("#mw-sensitivity .mw-sens-row").count();
  check(rows >= 3, `desktop 1440: parameter sensitivity shows ${rows} parameters`);
  await page.evaluate(() => document.querySelector("#mw-sensitivity").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await shot(page, "desktop-sensitivity.png");
  await context.close();
}

/* ---------------------------------------------------------------- iPads: the same cockpit */
for (const [w, h, name, file] of [[768, 1024, "iPad mini 768", null], [820, 1180, "iPad Air 820", "tablet-cockpit-ipad-air.png"], [1024, 768, "iPad landscape 1024", "tablet-cockpit-ipad-landscape.png"]]) {
  const { context, page } = await open(name, { width: w, height: h }, true);
  await cockpit(page, w, name);
  check((await overlappingButtons(page)) === 0, `${name}: no overlapping header buttons`);
  { const c = await clippedButtons(page); check(c.length === 0, `${name}: no clipped buttons${c.length ? ` (${c.join(", ")})` : ""}`); }
  const map = await box(page, ".map-panel-body .leaflet-container");
  check(map.height >= 180, `${name}: 2D map keeps ${Math.round(map.height)} px of height`);
  if (file) await shot(page, file);
  if (w === 820) {
    // Touch tablets: a 500 ms long-press on the map opens the wheel.
    const cdp = await context.newCDPSession(page);
    const p = { x: Math.round(map.left + map.width / 2), y: Math.round(map.top + map.height / 2) };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await page.waitForTimeout(650);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForSelector("[data-testid=radial-wheel]", { timeout: 3000 });
    check(true, `${name}: long-press opens the wheel on a touch tablet`);
  }
  await context.close();
}

/* ---------------------------------------------------------------- iPhone 15 393 x 852 (3x) */
{
  const { context, page } = await open("iphone", { width: 393, height: 852 }, true, 3);
  const meta = await page.evaluate(() => ({
    viewport: document.querySelector('meta[name=viewport]')?.content ?? "",
    theme: document.querySelector('meta[name=theme-color]')?.content,
    apple: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
    status: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.content,
    shell: document.querySelector(".mission-shell").getBoundingClientRect().height,
    touch: navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches,
  }));
  check(/viewport-fit=cover/.test(meta.viewport) && meta.theme === "#081014" && meta.apple === "yes" && meta.status === "black-translucent", "iPhone 393: mobile web-app meta tags present");
  check(Math.abs(meta.shell - 852) < 2 && meta.touch, "iPhone 393: shell fills the dynamic viewport height; touch / coarse pointer recognized");
  check(await noOverflow(page), "iPhone 393: no horizontal overflow");
  const top = await box(page, ".topbar");
  const sub = await box(page, ".field-header");
  const map = await box(page, ".map-panel-body .leaflet-container");
  check(sub.bottom <= 88, `iPhone 393: 2-row HUD is ${Math.round(sub.bottom)} px tall (<= 88; row 1 ${Math.round(top.height)} px, row 2 ${Math.round(sub.height)} px)`);
  check(map.height / 852 >= 0.75, `iPhone 393: map uses ${Math.round((100 * map.height) / 852)}% of the screen height`);
  check((await overlappingButtons(page)) === 0, "iPhone 393: no overlapping header, sub-bar or dock buttons");
  const clipped = await clippedButtons(page);
  check(clipped.length === 0, `iPhone 393: no clipped buttons${clipped.length ? ` (${clipped.join(", ")})` : ""}`);
  const visibleLabels = await page.evaluate(() =>
    [...document.querySelectorAll("button")].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== "hidden" && !e.closest(".map-legend")).map((e) => (e.getAttribute("aria-label") || e.textContent).trim()).filter(Boolean));
  const dupes = visibleLabels.filter((t, i) => visibleLabels.indexOf(t) !== i && !/^Zoom/.test(t));
  check(dupes.length === 0 && !visibleLabels.some((t) => /USGS SNAPSHOT|ROUTE DESIGN/.test(t)), `iPhone 393: no duplicated buttons${dupes.length ? ` (${dupes.join(", ")})` : ""}`);
  check(!(await box(page, ".nn-wheel-chip"))?.visible, "iPhone 393: no floating WHEEL chip (WHEEL is in the dock)");
  const zoom = await page.evaluate(() => {
    const a = document.querySelector(".map-panel-body .leaflet-control-zoom-in");
    const r = a.getBoundingClientRect();
    return { color: getComputedStyle(a).color, w: r.width, left: r.left };
  });
  check(zoom.color === "rgb(1, 255, 255)" && Math.round(zoom.w) === 32, `iPhone 393: dark-cyan 32 px zoom buttons (${Math.round(zoom.w)} px)`);
  const dockButtons = await page.$$eval(".nn-dock button", (els) => els.map((e) => e.getBoundingClientRect()).map((r) => Math.min(r.width, r.height)));
  check(dockButtons.length === 5 && dockButtons.every((s) => s >= 44), "iPhone 393: five dock tabs, each at least 44 x 44");
  await shot(page, "mobile-console-ios.png");

  // SOL pill opens the sol scrubber popover.
  await page.click(".nn-solpill-btn");
  const sol = await box(page, "[data-testid=sol-popover]");
  check(sol?.visible && sol.left >= 0 && sol.right <= 393 && (await box(page, ".nn-solpill-pop .nn-solscrub"))?.visible, `iPhone 393: SOL card opens inside the screen (${Math.round(sol?.left ?? -1)} to ${Math.round(sol?.right ?? -1)} px)`);
  await shot(page, "mobile-sol-card.png");
  await page.keyboard.press("Escape");
  check(!(await box(page, "[data-testid=sol-popover]")), "iPhone 393: Esc closes the SOL card");

  // Sheets: blurred full-screen backdrop, 2-column KPI grid, compact source pills.
  await page.click('[data-dock="intel"]');
  await page.waitForTimeout(450);
  const sheet = await box(page, ".left-column");
  const sheetStyle = await page.evaluate(() => {
    const bd = getComputedStyle(document.querySelector(".nn-sheet-backdrop"));
    const grid = getComputedStyle(document.querySelector(".left-column .panel-body")).gridTemplateColumns.split(" ").length;
    const tag = getComputedStyle(document.querySelector(".left-column .nn-tag")).fontSize;
    return { blur: bd.backdropFilter || bd.webkitBackdropFilter, top: document.querySelector(".nn-sheet-backdrop").getBoundingClientRect().top, grid, tag };
  });
  check(sheet.visible && sheet.left === 0 && sheet.right === 393 && sheet.height <= 852 * 0.78 + 1, "iPhone 393: INTEL bottom sheet, at most 78% of the height");
  check(/blur\(5px\)/.test(sheetStyle.blur) && sheetStyle.top === 0, "iPhone 393: full-screen blurred backdrop behind the sheet");
  check(sheetStyle.grid === 2 && sheetStyle.tag === "12px", "iPhone 393: 2-column KPI grid and 12 px source pills");
  await shot(page, "mobile-intel-sheet-ios.png");
  await page.click(".left-column .nn-sheet-close");
  await page.waitForTimeout(400);
  check(!(await box(page, ".left-column")).visible, "iPhone 393: [CLOSE] hides the sheet");

  // Wheel: long-press on the map, then the right-hand TERRAIN LADDER sector; everything stays 12 px inside.
  const cdp = await context.newCDPSession(page);
  const point = { x: Math.round(map.left + map.width / 2), y: Math.round(map.top + map.height / 2) };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForSelector("[data-testid=radial-wheel]", { timeout: 3000 });
  check(true, "iPhone 393: long-press on the map opens the wheel");
  await page.click(".nn-wheel-sector >> nth=2");
  await page.waitForTimeout(500);
  const wheel = await page.evaluate(() => {
    const rects = [...document.querySelectorAll(".nn-wheel-sub, .nn-wheel-sub text, .nn-wheel-svg")].map((e) => e.getBoundingClientRect());
    return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)), label: document.querySelector(".nn-wheel-hub-title")?.textContent };
  });
  check(wheel.left >= 12 && wheel.right <= 393 - 12, `iPhone 393: wheel + ${wheel.label} sub-wheel inside the screen (${Math.round(wheel.left)} to ${Math.round(wheel.right)} px)`);
  await shot(page, "mobile-radial-wheel.png");
  await page.keyboard.press("Escape");

  // USGS view: a tap on the LAYERED (ArcGIS) map selects there while the 2D map is hidden (0 x 0). The hidden 2D
  // map's fly-to used to throw "Invalid LatLng (NaN, NaN)" and stop the console. Back on 2D, the selection is centered.
  {
    const before = errors.length;
    const center2d = () => page.evaluate(() => document.querySelector(".map-panel-body .leaflet-container")?.dataset.center);
    const c0 = await center2d();
    await page.click('.nn-mapview-toggle button:has-text("USGS")');
    await page.waitForSelector("[data-testid=arcgis-layered] canvas", { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector(".nn-arcgis-view")?.dataset.center, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const ab = await page.locator("[data-testid=arcgis-layered]").boundingBox();
    let c1 = c0;
    for (let i = 0; i < 3 && c1 === c0; i += 1) {
      await page.touchscreen.tap(Math.round(ab.x + ab.width * (0.62 + 0.04 * i)), Math.round(ab.y + ab.height * 0.6));
      await page.waitForTimeout(2500);
      c1 = await center2d();
    }
    const stopped = await page.evaluate(() => [...document.querySelectorAll(".nn-error-card")].map((e) => e.innerText).filter((t) => /STOPPED/.test(t)));
    check(!stopped.length && errors.length === before, `iPhone 393: a tap on the USGS LAYERED map raises no error and no CONSOLE STOPPED card${stopped.length ? ` (${stopped[0]})` : ""}`);
    check(c1 !== c0, `iPhone 393: the USGS tap moves the hidden 2D map to the new selection (${c0} -> ${c1})`);
    await shot(page, "mobile-usgs-layered-tap.png");
    await page.click('.nn-mapview-toggle button:has-text("2D")');
    await page.waitForTimeout(1500);
    const sel = await selectionMarker(page);
    // Horizontal only: at the focus zoom the planet just fills the phone map, so the max-bounds clamp may shift it vertically.
    check(sel?.visible && sel.inside && Math.abs(sel.dx) <= 3, `iPhone 393: back on 2D, the USGS pick is centered under the selection marker (${Math.round(sel?.dx ?? NaN)} px off)`);
  }

  // 3D globe from the [2D | USGS | 3D] switch: one-row bar, no banners, 2x canvas.
  await page.click('.nn-mapview-toggle button:has-text("3D")');
  await page.waitForSelector(".m3d-view canvas, [data-testid=globe-2d-fallback] canvas", { timeout: 120000 });
  await page.waitForTimeout(15000);
  const globe = await page.evaluate(() => {
    const c = document.querySelector(".m3d-view canvas") ?? document.querySelector("[data-testid=globe-2d-fallback] canvas");
    const bar = document.querySelector(".m3d-bar").getBoundingClientRect();
    return {
      error: Boolean(document.querySelector(".m3d-error")), banner: /SOFTWARE WEBGL/.test(document.querySelector(".m3d-shell").innerText),
      width: c?.width ?? 0, css: c?.getBoundingClientRect().width ?? 0, bar: bar.height, hint: document.querySelector(".m3d-readout")?.innerText ?? "",
    };
  });
  check(!globe.error && !globe.banner && globe.width > 0, "iPhone 393: 3D globe renders with no error box and no software-WebGL banner");
  check(globe.bar <= 48, `iPhone 393: one-row 3D bar (${Math.round(globe.bar)} px)`);
  check(globe.width <= Math.round(globe.css * 2) + 1, `iPhone 393 at 3x: globe canvas ${globe.width} px for ${Math.round(globe.css)} css px (capped at 2x)`);
  check(/TAP SURFACE FOR COORDINATES/.test(globe.hint), "iPhone 393: touch wording on the 3D readout");
  await page.click(".m3d-tools-toggle");
  check((await box(page, ".m3d-tools.is-open"))?.visible, "iPhone 393: 3D TOOLS opens the tools menu");
  await shot(page, "mobile-globe-ios.png");
  await page.click(".m3d-tools-toggle");
  await page.click(".m3d-close");
  await page.waitForSelector(".m3d-shell", { state: "detached", timeout: 10000 });

  await page.click("button.burger-button");
  await page.click('[data-quickstart="demo-gale"]');
  await page.waitForSelector("[data-testid=decision-at-sol]", { state: "attached", timeout: 240000 });
  await page.waitForTimeout(2500);
  check(await noOverflow(page), "iPhone 393: MARSWALK without overflow");
  const note = await box(page, "[data-testid=mw-note]");
  check(!note || note.height <= 34, "iPhone 393: MARSWALK limitation note is one line");
  if (note) check((await box(page, "[data-testid=mw-note] .mw-note-x"))?.visible && (await box(page, "[data-testid=mw-note] .mw-note-i"))?.visible, "iPhone 393: the note has [i] and × controls");
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
  const clipped = await clippedButtons(page);
  check(clipped.length === 0, `Android 360: no clipped buttons${clipped.length ? ` (${clipped.join(", ")})` : ""}`);
  const sub = await box(page, ".field-header");
  check(sub.bottom <= 88, `Android 360: 2-row HUD is ${Math.round(sub.bottom)} px tall`);
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
