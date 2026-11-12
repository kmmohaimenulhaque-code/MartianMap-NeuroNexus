/* Tutorial stage: plays a tutorial from tutorials.json over real console screenshots.
   Per step: the camera eases to the step's focus region, a spotlight frames it, an optional cursor travels to a
   control and taps it (with a ripple and a haptic tick), and the caption changes. Progress bars show the timing.
   The same engine drives the small looping previews on feature cards and the full-screen player. */

import { clamp, haptic, reducedMotion } from "./env.js";
import { fillTokens } from "./content.js";

const CURSOR_SVG =
  '<svg class="tt-cursor" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 2l17 9.5-7.4 1.6L9.2 21z" fill="#f2f0ec" stroke="#05090b" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export class TutorialStage {
  constructor(host, tutorial, { sizes, tokens, mode = "card", onStep, onEnd, loop = mode === "card" } = {}) {
    this.host = host;
    this.t = tutorial;
    this.sizes = sizes;
    this.tokens = tokens;
    this.mode = mode;
    this.onStep = onStep;
    this.onEnd = onEnd;
    this.loop = loop;
    this.index = -1;
    this.playing = false;
    this.elapsed = 0;
    this.timers = [];
    this.build();
    this.ro = new ResizeObserver(() => this.layout(false));
    this.ro.observe(this.stage);
  }

  build() {
    const media = [...new Set(this.t.steps.map((s) => s.media))];
    const stage = document.createElement("div");
    stage.className = `tt-stage tt-stage--${this.mode}`;
    stage.innerHTML = `
      <div class="tt-bars" aria-hidden="true">${this.t.steps.map(() => "<i></i>").join("")}</div>
      ${media
        .map((key) => {
          const [w, h] = this.sizes[key] || [1600, 900];
          return `<div class="tt-frame" data-media="${key}"><div class="tt-cam" style="width:${w}px;height:${h}px">
            <img src="/landing/media/${key}.webp" width="${w}" height="${h}" alt="" loading="lazy" decoding="async" draggable="false" />
            <div class="tt-spot"></div></div></div>`;
        })
        .join("")}
      <span class="tt-ripple"></span>
      ${CURSOR_SVG}
      <p class="tt-caption" aria-live="${this.mode === "player" ? "polite" : "off"}"></p>`;
    this.host.replaceChildren(stage);
    this.stage = stage;
    this.frames = Object.fromEntries([...stage.querySelectorAll(".tt-frame")].map((f) => [f.dataset.media, f]));
    this.bars = [...stage.querySelectorAll(".tt-bars i")];
    this.caption = stage.querySelector(".tt-caption");
    this.cursor = stage.querySelector(".tt-cursor");
    this.ripple = stage.querySelector(".tt-ripple");
  }

  stepDuration(step) {
    const words = step.caption.split(/\s+/).length;
    return Math.max(3400, 1500 + words * 230 + (step.cursor ? 1500 : 0));
  }

  /* Camera transform that fits the focus region inside the stage. Units are CSS px of the cam element. */
  cameraFor(step) {
    const [iw, ih] = this.sizes[step.media] || [1600, 900];
    const W = this.stage.clientWidth || 1;
    const H = this.stage.clientHeight || 1;
    const [fx, fy, fw, fh] = step.focus;
    const pad = fw >= 0.95 && fh >= 0.95 ? 1 : 1.22;
    const contain = Math.min(W / iw, H / ih);
    const s = clamp(Math.min(W / (fw * iw * pad), H / (fh * ih * pad)), contain, contain * 5);
    const cx = (fx + fw / 2) * iw;
    const cy = (fy + fh / 2) * ih;
    let tx = W / 2 - cx * s;
    let ty = H / 2 - cy * s;
    tx = iw * s >= W ? clamp(tx, W - iw * s, 0) : (W - iw * s) / 2;
    ty = ih * s >= H ? clamp(ty, H - ih * s, 0) : (H - ih * s) / 2;
    return { s, tx, ty, iw, ih };
  }

  layout(animate = true) {
    const step = this.t.steps[this.index];
    if (!step) return;
    const frame = this.frames[step.media];
    const cam = frame.querySelector(".tt-cam");
    const c = this.cameraFor(step);
    if (!animate || reducedMotion()) cam.style.transition = "none";
    cam.style.transform = `translate(${c.tx}px, ${c.ty}px) scale(${c.s})`;
    const spot = frame.querySelector(".tt-spot");
    const [fx, fy, fw, fh] = step.focus;
    const full = fw >= 0.95 && fh >= 0.95;
    spot.classList.toggle("is-full", full);
    spot.style.left = `${fx * c.iw}px`;
    spot.style.top = `${fy * c.ih}px`;
    spot.style.width = `${fw * c.iw}px`;
    spot.style.height = `${fh * c.ih}px`;
    spot.style.borderRadius = `${10 / c.s}px`;
    if (!animate || reducedMotion()) {
      cam.getBoundingClientRect();
      cam.style.transition = "";
    }
    this.cam = c;
  }

  cursorPoint(step) {
    const c = this.cam;
    return { x: c.tx + step.cursor[0] * c.iw * c.s, y: c.ty + step.cursor[1] * c.ih * c.s };
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }

  go(i, { autoplay = this.playing } = {}) {
    const n = this.t.steps.length;
    if (i >= n) {
      if (this.loop) i = 0;
      else {
        this.pause();
        this.onEnd?.();
        return;
      }
    }
    i = clamp(i, 0, n - 1);
    this.clearTimers();
    const prev = this.t.steps[this.index];
    this.index = i;
    const step = this.t.steps[i];
    Object.entries(this.frames).forEach(([k, f]) => f.classList.toggle("is-on", k === step.media));
    this.layout(Boolean(prev && prev.media === step.media));
    this.bars.forEach((b, k) => b.style.setProperty("--p", k < i ? "1" : "0"));

    this.caption.classList.add("is-swap");
    this.later(() => {
      this.caption.textContent = fillTokens(step.caption, this.tokens);
      this.caption.classList.remove("is-swap");
    }, 180);

    this.cursor.classList.remove("is-on", "is-press");
    if (step.cursor) {
      const camDelay = reducedMotion() ? 0 : 1250;
      this.later(() => {
        const p = this.cursorPoint(step);
        const W = this.stage.clientWidth;
        const H = this.stage.clientHeight;
        this.cursor.style.transition = "none";
        this.cursor.style.left = `${p.x + W * 0.12}px`;
        this.cursor.style.top = `${p.y + H * 0.16}px`;
        this.cursor.getBoundingClientRect();
        this.cursor.style.transition = "";
        this.cursor.classList.add("is-on");
        this.cursor.style.left = `${p.x}px`;
        this.cursor.style.top = `${p.y}px`;
        this.later(() => {
          this.cursor.classList.add("is-press");
          this.ripple.style.left = `${p.x}px`;
          this.ripple.style.top = `${p.y}px`;
          this.ripple.classList.remove("is-on");
          this.ripple.getBoundingClientRect();
          this.ripple.classList.add("is-on");
          if (this.mode === "player") haptic(8);
          this.later(() => this.cursor.classList.remove("is-press"), 160);
        }, reducedMotion() ? 0 : 950);
      }, camDelay);
    }
    this.onStep?.(i, step);
    this.duration = this.stepDuration(step);
    this.elapsed = 0;
    if (autoplay) this.play();
  }

  play() {
    if (this.index < 0) return this.go(0, { autoplay: true });
    this.playing = true;
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const bar = this.bars[this.index];
    const tick = (now) => {
      if (!this.playing) return;
      this.elapsed += now - last;
      last = now;
      bar?.style.setProperty("--p", Math.min(1, this.elapsed / this.duration).toFixed(3));
      if (this.elapsed >= this.duration) {
        this.go(this.index + 1, { autoplay: true });
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  next() {
    this.go(this.index + 1);
  }

  prev() {
    this.go(Math.max(0, this.index - 1));
  }

  destroy() {
    this.pause();
    this.clearTimers();
    this.ro.disconnect();
    this.host.replaceChildren();
  }
}
