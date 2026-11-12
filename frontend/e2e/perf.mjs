/*
 * Browser performance, Browser Optimization OFF (default) vs ON (LOW-RAM), on the same running console:
 * time to SYSTEM ONLINE, UI frame rate over 5 s (requestAnimationFrame count) in the global console and
 * in MARSWALK, and the JS heap (performance.memory, Chromium only). Prints a JSON summary.
 *   node frontend/e2e/perf.mjs   # BASE_URL defaults to http://localhost:7860
 */

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:7860";

async function fps(page, seconds = 5) {
  return page.evaluate(
    (s) =>
      new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - t0 < s * 1000) requestAnimationFrame(tick);
          else resolve(frames / ((performance.now() - t0) / 1000));
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );
}
const heapMb = (page) => page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 2 ** 20 : null));

async function run(preset) {
  const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript((p) => localStorage.setItem("nn.browserOptimization.v2", JSON.stringify({ preset: p, custom: {} })), preset);
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("SYSTEM ONLINE"), null, { timeout: 120000 });
  await page.waitForSelector("[data-testid=thermal-sol-readout]", { timeout: 120000 });
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  const globalFps = await fps(page);
  const globalHeap = await heapMb(page);
  await page.click("button.burger-button");
  await page.click('[data-quickstart="demo-gale"]');
  await page.waitForSelector("[data-testid=decision-at-sol]", { timeout: 240000 });
  await page.waitForTimeout(3000);
  const marswalkFps = await fps(page);
  const marswalkHeap = await heapMb(page);
  await browser.close();
  const r = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  return { preset, ready_ms: readyMs, global: { fps: r(globalFps), heap_mb: r(globalHeap) }, marswalk: { fps: r(marswalkFps), heap_mb: r(marswalkHeap) } };
}

const results = [await run("MAX_FIDELITY"), await run("LOW_RAM")];
console.log(JSON.stringify({ base: BASE, measured_at: new Date().toISOString(), note: "headless Chromium, software WebGL; relative numbers", results }, null, 2));
