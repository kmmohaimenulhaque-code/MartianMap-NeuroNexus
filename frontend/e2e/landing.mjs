/* Landing page checks across device classes (Chromium device emulation, WebKit where installed).
 *
 *   cd frontend && npm run build && npx vite preview --port 4173 &
 *   node e2e/landing.mjs                      # BASE defaults to http://127.0.0.1:4173
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.js node e2e/landing.mjs   # same convention as devices.mjs
 *   BASE=https://your.app node e2e/landing.mjs
 *   SHOTS=1 node e2e/landing.mjs              # also writes assets/screenshots/landing/<device>-*.png
 *
 * Checks per device: zero page errors, no horizontal overflow, hero lens live, menu opens and closes by keyboard
 * and returns focus, every tutorial card renders, the player opens, steps and closes with Escape, legacy console
 * links redirect to /console/, and the gallery page renders. Exit code 1 on any failure.
 */
import { mkdirSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { chromium, webkit } = pw.default ?? pw;
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const touch = (width, height, deviceScaleFactor, userAgent) => ({ viewport: { width, height }, deviceScaleFactor, isMobile: true, hasTouch: true, userAgent });

const BASE = (process.env.BASE || "http://127.0.0.1:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS === "1";
const OUT = new URL("../../assets/screenshots/landing/", import.meta.url).pathname;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const DEVICES = [
  { name: "desktop-1920", viewport: { width: 1920, height: 1080 } },
  { name: "laptop-1366", viewport: { width: 1366, height: 768 } },
  { name: "mac-1512", viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 },
  { name: "ipad-820", ...touch(820, 1180, 2, IPAD_UA) },
  { name: "ipad-landscape-1180", ...touch(1180, 820, 2, IPAD_UA) },
  { name: "ipad-mini-744", ...touch(744, 1133, 2, IPAD_UA) },
  { name: "android-tablet-800", ...touch(800, 1280, 2, ANDROID_UA) },
  { name: "foldable-673", ...touch(673, 841, 2.6, ANDROID_UA) },
  { name: "iphone-393", ...touch(393, 852, 3, IOS_UA) },
  { name: "iphone-430", ...touch(430, 932, 3, IOS_UA) },
  { name: "android-412", ...touch(412, 915, 2.6, ANDROID_UA) },
  { name: "android-360", ...touch(360, 780, 3, ANDROID_UA) },
  { name: "small-320", ...touch(320, 640, 2, IOS_UA) },
];

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures += 1;
};

async function run(browserType, label) {
  let browser;
  try {
    browser = await browserType.launch();
  } catch {
    console.log(`SKIP  ${label} is not installed`);
    return;
  }
  for (const d of DEVICES) {
    const { name, ...opts } = d;
    const ctx = await browser.newContext({ ...opts, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const tag = `${label} ${name}`;

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${tag}: no horizontal overflow (${overflow}px)`);
    check(await page.locator("[data-lens].is-live").count() === 1, `${tag}: hero lens is live`);
    if (SHOTS) await page.screenshot({ path: `${OUT}${name}-hero.png` });

    const cards = await page.locator(".lp-card").count();
    check(cards === 12, `${tag}: 12 tutorial cards (${cards})`);

    await page.locator("[data-menu-open]").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(450);
    check(await page.locator("[data-menu]").evaluate((m) => !m.hidden && m.classList.contains("is-open")), `${tag}: menu opens`);
    const consoleLink = await page.locator('.lp-menu__primary a[href="/console/"]').count();
    check(consoleLink === 1, `${tag}: menu links to the console`);
    if (SHOTS) await page.screenshot({ path: `${OUT}${name}-menu.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check(await page.evaluate(() => document.activeElement?.hasAttribute("data-menu-open")), `${tag}: Escape closes the menu and returns focus`);

    await page.locator(".lp-card").nth(2).scrollIntoViewIfNeeded();
    await page.locator('.lp-card__media[data-open="active-sol"]').click();
    await page.waitForTimeout(700);
    check(await page.locator("[data-player].is-open .tt-stage").count() === 1, `${tag}: tutorial player opens`);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1600);
    const current = await page.locator('[data-pl-step][aria-current="step"]').getAttribute("data-pl-step");
    check(current === "1", `${tag}: ArrowRight moves to step 2 (${current})`);
    if (SHOTS) await page.screenshot({ path: `${OUT}${name}-player.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check(await page.locator("[data-player]").evaluate((p) => p.hidden), `${tag}: Escape closes the player`);

    await page.locator("#finale").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    if (SHOTS) await page.screenshot({ path: `${OUT}${name}-finale.png` });

    check(errors.length === 0, `${tag}: zero page errors${errors.length ? ` (${errors.join(" | ")})` : ""}`);
    await ctx.close();
  }

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const legacy of ["/?tour=judge", "/?site=gale&sol=400", "/#mw=abc"]) {
    await page.goto(`${BASE}${legacy}`);
    await page.waitForLoadState("domcontentloaded");
    const u = new URL(page.url());
    check(u.pathname === "/console/", `${label}: ${legacy} redirects to /console/ (${u.pathname}${u.search}${u.hash})`);
  }
  await page.goto(`${BASE}/#features`);
  check(new URL(page.url()).pathname === "/", `${label}: landing anchors stay on the landing page`);
  await page.goto(`${BASE}/tutorials/`, { waitUntil: "networkidle" });
  check((await page.locator(".lp-card").count()) === 12, `${label}: gallery lists 12 tutorials`);
  await ctx.close();
  await browser.close();
}

await run(chromium, "chromium");
if (process.env.WEBKIT !== "0") await run(webkit, "webkit");
console.log(failures ? `\n${failures} check(s) failed` : "\nAll landing checks passed");
process.exit(failures ? 1 : 0);
