/* Hero text effects: the headline words arrive out of a blur, and a frosted glass lens drifts across the
   headline (it follows the mouse on desktop, drifts on its own on touch screens). Off under reduced motion. */

import { finePointer, lerp, reducedMotion } from "./env.js";

export function initIntro() {
  const el = document.querySelector("[data-intro]");
  if (!el) return;
  const text = el.textContent.trim();
  el.setAttribute("aria-label", text);
  el.innerHTML = text
    .split(/\s+/)
    .map((w, i) => `<span class="lp-blurword" aria-hidden="true" style="--w:${i}">${w}</span>`)
    .join(" ");
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-in")));
}

export function initGlass() {
  const glass = document.querySelector("[data-glass]");
  const hero = glass?.closest(".lp-hero");
  const intro = document.querySelector("[data-intro]");
  if (!glass || !hero || !intro || reducedMotion()) return;
  const supports = CSS.supports("backdrop-filter", "blur(2px)") || CSS.supports("-webkit-backdrop-filter", "blur(2px)");
  if (!supports) return;

  const pos = { x: 0, y: 0, tx: 0, ty: 0 };
  let lastInput = -1e9;
  let visible = true;
  let raf = 0;

  const bounds = () => {
    const h = hero.getBoundingClientRect();
    const r = intro.getBoundingClientRect();
    return { left: r.left - h.left, top: r.top - h.top, width: r.width, height: r.height, size: glass.offsetWidth };
  };

  const frame = (now) => {
    raf = 0;
    if (!visible || document.hidden) return;
    const b = bounds();
    if (now - lastInput > 2200) {
      const t = now / 1000;
      pos.tx = b.left + b.width * (0.5 + 0.42 * Math.sin(t * 0.31)) - b.size / 2;
      pos.ty = b.top + b.height * (0.5 + 0.38 * Math.sin(t * 0.47 + 0.8)) - b.size / 2;
    }
    pos.x = lerp(pos.x, pos.tx, 0.06);
    pos.y = lerp(pos.y, pos.ty, 0.06);
    glass.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`;
    raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  if (finePointer()) {
    intro.addEventListener("pointermove", (e) => {
      const h = hero.getBoundingClientRect();
      pos.tx = e.clientX - h.left - glass.offsetWidth / 2;
      pos.ty = e.clientY - h.top - glass.offsetWidth / 2;
      lastInput = performance.now();
    });
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      kick();
    }).observe(hero);
  }
  document.addEventListener("visibilitychange", kick);
  const b = bounds();
  pos.x = pos.tx = b.left;
  pos.y = pos.ty = b.top;
  setTimeout(() => glass.classList.add("is-on"), 900);
  kick();
}
