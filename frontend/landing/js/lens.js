/* Hero "resolution lens". The card shows the Gale demo walk rendered by the console on 1 m HiRISE terrain.
   Outside the lens the same image is averaged to MOLA's 463 m pixels (about 97 screenshot pixels each, scale from
   the planner's own 1200 m straight-line reading) and smoothly resampled, which is what the global map can see.
   Inside the lens the 1 m detail comes back. Mouse: hover. Touch: tap or drag (vertical drags still scroll).
   Idle: the lens drifts on its own. Reduced motion or no canvas: the static image stays. */

import { clamp, finePointer, lerp, reducedMotion } from "./env.js";

export function initLens(hero) {
  const fig = document.querySelector("[data-lens]");
  const card = fig?.querySelector("[data-tilt]");
  const canvas = fig?.querySelector("[data-lens-canvas]");
  const chip = fig?.querySelector("[data-lens-chip-in]");
  if (!fig || !card || !canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const img = new Image();
  img.decoding = "async";
  img.src = hero.image;

  const coarse = document.createElement("canvas");
  let dpr = 1;
  let W = 0;
  let H = 0;
  let draw = { x: 0, y: 0, w: 0, h: 0 };
  const lens = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, r: 0.2 };
  let lastInput = 0;
  let running = false;
  let visible = true;
  let raf = 0;

  const buildCoarse = () => {
    // One MOLA pixel covers hero.mola_pixel_px source pixels. Average down to that grid, then let the browser
    // smooth it back up when drawing (bilinear), like an interpolated elevation model.
    const cols = Math.max(2, Math.round(img.naturalWidth / hero.mola_pixel_px));
    const rows = Math.max(2, Math.round(img.naturalHeight / hero.mola_pixel_px));
    coarse.width = cols;
    coarse.height = rows;
    const c = coarse.getContext("2d");
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(img, 0, 0, cols, rows);
  };

  const resize = () => {
    const r = card.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // cover-fit the image
    const ar = img.naturalWidth / img.naturalHeight || 1;
    let w = W;
    let h = W / ar;
    if (h < H) {
      h = H;
      w = H * ar;
    }
    draw = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    lens.r = Math.min(W, H) * (W < 600 ? 0.3 : 0.24);
    render();
  };

  const render = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = "saturate(0.75) contrast(0.92)";
    ctx.drawImage(coarse, draw.x, draw.y, draw.w, draw.h);
    ctx.filter = "none";
    const px = lens.x * W;
    const py = lens.y * H;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, lens.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, draw.x, draw.y, draw.w, draw.h);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(px, py, lens.r, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(1, 255, 255, 0.95)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, lens.r + 7, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(1, 255, 255, 0.35)";
    ctx.stroke();
    if (chip) chip.style.transform = `translate(${px - chip.offsetWidth / 2}px, ${py - lens.r - 30}px)`;
  };

  const loop = (now) => {
    raf = 0;
    if (!running || !visible) return;
    if (now - lastInput > 2600) {
      const t = now / 1000;
      lens.tx = 0.5 + 0.28 * Math.sin(t * 0.37);
      lens.ty = 0.5 + 0.22 * Math.sin(t * 0.53 + 1.1);
    }
    lens.x = lerp(lens.x, lens.tx, 0.09);
    lens.y = lerp(lens.y, lens.ty, 0.09);
    render();
    raf = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (!raf && running && visible) raf = requestAnimationFrame(loop);
  };

  const point = (e) => {
    const r = card.getBoundingClientRect();
    lens.tx = clamp((e.clientX - r.left) / r.width, 0.02, 0.98);
    lens.ty = clamp((e.clientY - r.top) / r.height, 0.02, 0.98);
    lastInput = performance.now();
    kick();
  };

  const tilt = (e) => {
    if (!finePointer() || reducedMotion()) return;
    const r = card.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `rotateY(${(nx * 6).toFixed(2)}deg) rotateX(${(-ny * 6).toFixed(2)}deg)`;
  };

  card.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || e.pressure > 0 || e.buttons) point(e);
    tilt(e);
  });
  card.addEventListener("pointerdown", point);
  card.addEventListener("pointerleave", () => {
    card.style.transform = "";
  });

  img.addEventListener("load", () => {
    buildCoarse();
    fig.classList.add("is-live");
    running = !reducedMotion();
    resize();
    new ResizeObserver(resize).observe(card);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        kick();
      }).observe(card);
    }
    document.addEventListener("visibilitychange", () => {
      visible = !document.hidden;
      kick();
    });
    if (!running) {
      // Reduced motion: no drift, but tapping still moves the lens.
      card.addEventListener("pointerdown", () => {
        lens.x = lens.tx;
        lens.y = lens.ty;
        render();
      });
    }
    kick();
  });
}
