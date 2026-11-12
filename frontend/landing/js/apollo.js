/* Apollo 14 scene: a pinned section whose scroll progress drives a shattering pane of frosted glass in front of the
   animated NASA photo (AS14-64-9089). 0 to 0.2: frosted and whole. 0.15 to 0.35: cracks run from the impact point.
   0.3 to 0.8: shards fly apart and the scene sharpens. The copy rises in front from 0.35. The HUD chips retell the
   story. Reduced motion: no glass, the scene and copy show at once. The video only plays while on screen. */

import { reducedMotion } from "./env.js";

const PIN_COPY = {
  crater: "Cone Crater was the science target. Its rim was close enough to see, but the remaining climb still had a mission cost.",
  turnaround: "The approximate thirty-meter turnaround is the lesson: a small distance can represent a large change in terrain burden, time and evidence.",
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => 1 - (1 - v) ** 3;

/* Shards: polygons between jittered rays and rings around an impact point, in percent of the stage. */
function shardPolygons(cx, cy, rays = 9, rings = [9, 30, 160]) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const angles = Array.from({ length: rays }, (_, i) => ((i + 0.25 + rnd() * 0.5) / rays) * Math.PI * 2);
  const point = (a, r) => [cx + Math.cos(a) * r * (0.85 + rnd() * 0.3), cy + Math.sin(a) * r * 1.6 * (0.85 + rnd() * 0.3)];
  const grid = rings.map((r) => angles.map((a) => point(a, r)));
  const shards = [];
  for (let i = 0; i < rays; i += 1) {
    const j = (i + 1) % rays;
    shards.push([[cx, cy], grid[0][i], grid[0][j]]);
    for (let k = 0; k < rings.length - 1; k += 1) shards.push([grid[k][i], grid[k + 1][i], grid[k + 1][j], grid[k][j]]);
  }
  return shards;
}

export function initApolloStory(root = document) {
  const card = root.querySelector("[data-apollo-card]");
  if (!card) return;
  const copy = card.querySelector("[data-apollo-copy]");
  const original = copy?.textContent || "";
  const video = card.querySelector("[data-moon-video]");
  const glass = card.querySelector("[data-glass]");
  const stage = card.querySelector(".lp-moon__stage");
  const bg = card.querySelector(".lp-moon__bg");

  card.querySelectorAll("[data-apollo-pin]").forEach((chip) =>
    chip.addEventListener("click", () => {
      const on = !chip.classList.contains("is-selected");
      card.querySelectorAll("[data-apollo-pin]").forEach((c) => c.classList.remove("is-selected"));
      chip.classList.toggle("is-selected", on);
      chip.setAttribute("aria-pressed", String(on));
      if (copy) copy.textContent = on ? PIN_COPY[chip.dataset.apolloPin] : original;
    }),
  );

  // Play only while visible (battery, and a hidden decode costs nothing).
  if (video) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reducedMotion()) video.play().catch(() => {});
      else video.pause();
    }).observe(card);
    if (reducedMotion()) video.removeAttribute("autoplay");
  }

  if (reducedMotion() || !glass) {
    card.classList.add("is-still");
    return;
  }

  const cx = 62;
  const cy = 44;
  const shards = shardPolygons(cx, cy).map((poly) => {
    const el = document.createElement("span");
    el.className = "lp-moon__shard";
    el.style.clipPath = `polygon(${poly.map(([x, y]) => `${x}% ${y}%`).join(",")})`;
    const mx = poly.reduce((s, p) => s + p[0], 0) / poly.length - cx;
    const my = poly.reduce((s, p) => s + p[1], 0) / poly.length - cy;
    const d = Math.hypot(mx, my) || 1;
    glass.append(el);
    return { el, dx: (mx / d) * (40 + d * 2.2), dy: (my / d) * (30 + d * 1.6), rot: (mx > 0 ? 1 : -1) * (8 + d * 0.35), delay: Math.min(0.25, d / 400) };
  });
  // Crack lines: the shard edges, drawn as one SVG over the glass.
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("lp-moon__cracks");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", shardPolygons(cx, cy).map((poly) => `M${poly.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L")} Z`).join(" "));
  path.setAttribute("pathLength", "1");
  svg.append(path);
  glass.append(svg);

  let raf = 0;
  const update = () => {
    raf = 0;
    // Pinned (wide screens): progress through the section. Unpinned (phones): progress of the scene band itself,
    // so the glass clears while the band is still on screen.
    let p;
    if (getComputedStyle(stage).position === "sticky") {
      const r = card.getBoundingClientRect();
      p = clamp01(-r.top / Math.max(1, r.height - innerHeight));
    } else {
      const r = bg.getBoundingClientRect();
      p = clamp01((innerHeight - r.top) / (innerHeight * 1.05));
    }
    const crack = clamp01((p - 0.12) / 0.22);
    const burst = clamp01((p - 0.3) / 0.5);
    card.style.setProperty("--crack", crack.toFixed(3));
    card.style.setProperty("--burst", burst.toFixed(3));
    card.style.setProperty("--copy", ease(clamp01((p - 0.32) / 0.3)).toFixed(3));
    for (const s of shards) {
      const k = ease(clamp01((burst - s.delay) / (1 - s.delay)));
      s.el.style.transform = `translate(${(s.dx * k).toFixed(1)}vw, ${(s.dy * k).toFixed(1)}vh) rotate(${(s.rot * k).toFixed(1)}deg) scale(${(1 + k * 0.15).toFixed(3)})`;
      s.el.style.opacity = (1 - k).toFixed(3);
    }
  };
  addEventListener("scroll", () => (raf ||= requestAnimationFrame(update)), { passive: true });
  addEventListener("resize", update);
  update();
}
