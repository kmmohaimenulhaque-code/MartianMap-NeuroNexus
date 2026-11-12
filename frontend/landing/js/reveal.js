/* Scroll reveals: word-split headlines, fade-ups, the self-drawing brush strokes and count-up numbers. */

import { reducedMotion } from "./env.js";
import { formatValue, getPath } from "./content.js";

export function splitWords(root) {
  root.querySelectorAll("[data-split]").forEach((el) => {
    if (el.dataset.splitDone) return;
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute("aria-label", el.textContent.trim());
    el.innerHTML = words
      .map((w, i) => `<span class="lp-word" aria-hidden="true" style="--w:${i}"><span>${w}</span></span>`)
      .join(" ");
    el.dataset.splitDone = "1";
  });
}

export function observeReveals(root) {
  const targets = root.querySelectorAll("[data-reveal], [data-split], .lp-card");
  if (!("IntersectionObserver" in window) || reducedMotion()) {
    targets.forEach((t) => t.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
  );
  targets.forEach((t) => io.observe(t));
}

/* Brush strokes draw with scroll progress through their section. */
export function initBrushes(root) {
  const brushes = [...root.querySelectorAll("[data-brush]")];
  if (!brushes.length) return;
  if (reducedMotion()) {
    brushes.forEach((b) => b.style.setProperty("--draw", "1"));
    return;
  }
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;
    brushes.forEach((b) => {
      const r = b.parentElement.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.9 + r.height * 0.35)));
      b.style.setProperty("--draw", p.toFixed(3));
    });
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
}

/* Count a number up from 0 when it first enters the view. */
export function initCounters(root, headline) {
  const els = [...root.querySelectorAll("[data-count]")];
  const run = (el) => {
    const target = Number(getPath(headline.sites, el.dataset.count));
    const decimals = Number(el.dataset.decimals || 0);
    if (!Number.isFinite(target)) {
      el.textContent = "n/a";
      return;
    }
    if (reducedMotion()) {
      el.textContent = formatValue(target, decimals);
      return;
    }
    const start = performance.now();
    const dur = 1600;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = formatValue(target * eased, decimals);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (!("IntersectionObserver" in window)) return els.forEach(run);
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        run(e.target);
        io.unobserve(e.target);
      });
    },
    { threshold: 0.4 },
  );
  els.forEach((el) => io.observe(el));
}
