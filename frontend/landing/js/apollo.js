/* Apollo 14 scene: a pinned section whose scroll progress drives a pane of frosted glass in front of the animated
   NASA photo (AS14-64-9089). The pane is ~100 small fragments of a blurred copy of the scene; as a wind front sweeps
   left to right, each fragment lifts, turns, shrinks and dissolves into glass dust (dispersion, no crack web).
   The copy rises in front from 0.35. HUD chips retell the story. Reduced motion: no glass. The video only plays
   while on screen; the canvas only redraws when the scroll position changes. */

import { reducedMotion } from "./env.js";

const PIN_COPY = {
  crater: "Cone Crater was the science target. Its rim was close enough to see, but the remaining climb still had a mission cost.",
  turnaround: "The approximate thirty-meter turnaround is the lesson: a small distance can represent a large change in terrain burden, time and evidence.",
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => 1 - (1 - v) ** 3;

/* Jittered grid split into triangles, in 0..1 stage units, with seeded motion per fragment. */
function fragments(cols = 9, rows = 6) {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts = [];
  for (let r = 0; r <= rows; r += 1)
    for (let c = 0; c <= cols; c += 1) {
      const edge = r === 0 || c === 0 || r === rows || c === cols;
      pts.push([(c + (edge ? 0 : (rnd() - 0.5) * 0.7)) / cols, (r + (edge ? 0 : (rnd() - 0.5) * 0.7)) / rows]);
    }
  const at = (c, r) => pts[r * (cols + 1) + c];
  const out = [];
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      const quad = [at(c, r), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1)];
      const tris = rnd() > 0.5 ? [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]] : [[quad[0], quad[1], quad[3]], [quad[1], quad[2], quad[3]]];
      for (const poly of tris) {
        const cx = (poly[0][0] + poly[1][0] + poly[2][0]) / 3;
        const cy = (poly[0][1] + poly[1][1] + poly[2][1]) / 3;
        out.push({
          poly, cx, cy,
          delay: cx * 0.55 + rnd() * 0.15,
          vx: 0.12 + rnd() * 0.3,
          vy: -0.16 + rnd() * 0.22,
          rot: (rnd() - 0.5) * 2.2,
          specks: Array.from({ length: 4 }, () => [(rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.04, 0.6 + rnd() * 1.4]),
        });
      }
    }
  return out;
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

  const canvas = document.createElement("canvas");
  glass.append(canvas);
  const ctx = canvas.getContext("2d");
  const frost = document.createElement("canvas");
  const frags = fragments();
  const poster = new Image();
  poster.src = video?.getAttribute("poster") || "/landing/media/apollo-poster.webp";
  let w = 0;
  let h = 0;
  let burst = 0;

  /* The frosted pane: the scene's poster frame, cover-fitted like the video, blurred and lifted with a cool frost. */
  const buildFrost = () => {
    w = bg.clientWidth;
    h = bg.clientHeight;
    if (!w || !h) return;
    // Cap the backing store at ~1600 px wide: soft glass needs no more, and 4K screens stay smooth.
    const dpr = Math.min(1.5, devicePixelRatio || 1, 1600 / w);
    canvas.width = frost.width = Math.round(w * dpr);
    canvas.height = frost.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f = frost.getContext("2d");
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (poster.naturalWidth) {
      const s = Math.max(w / poster.naturalWidth, h / poster.naturalHeight) * 1.08;
      const iw = poster.naturalWidth * s;
      const ih = poster.naturalHeight * s;
      // Blur by drawing through a tiny canvas (canvas filter is missing in Safari), then darken.
      const tiny = document.createElement("canvas");
      tiny.width = 48;
      tiny.height = Math.max(1, Math.round((48 * h) / w));
      const k = tiny.width / w;
      const t = tiny.getContext("2d");
      t.imageSmoothingQuality = "high";
      t.drawImage(poster, (w - iw) * 0.3 * k, ((h - ih) / 2) * k, iw * k, ih * k);
      f.imageSmoothingEnabled = true;
      f.imageSmoothingQuality = "high";
      f.drawImage(tiny, 0, 0, w, h);
      f.fillStyle = "rgba(6,12,20,0.38)";
      f.fillRect(0, 0, w, h);
    }
    const g = f.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "rgba(255,255,255,0.10)");
    g.addColorStop(0.6, "rgba(1,255,255,0.04)");
    g.addColorStop(1, "rgba(255,255,255,0.07)");
    f.fillStyle = g;
    f.fillRect(0, 0, w, h);
    draw();
  };

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const fr of frags) {
      const k = ease(clamp01((burst - fr.delay) / (1 - fr.delay) * 1.6));
      if (k >= 1) continue;
      const ox = fr.vx * w * k;
      const oy = (fr.vy * k - 0.12 * k * k) * h;
      const cx = fr.cx * w;
      const cy = fr.cy * h;
      ctx.save();
      ctx.globalAlpha = (1 - k) ** 1.2;
      ctx.translate(cx + ox, cy + oy);
      ctx.rotate(fr.rot * k);
      ctx.scale(1 - 0.55 * k, 1 - 0.55 * k);
      ctx.translate(-cx, -cy);
      ctx.beginPath();
      fr.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.drawImage(frost, 0, 0, w, h);
      ctx.restore();
      if (k > 0) {
        // A glint on the edges only while a fragment is in flight: no crack web on the intact pane.
        ctx.strokeStyle = `rgba(232,250,255,${(4 * k * (1 - k) * 0.5).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
      if (k > 0.04) {
        // Glass dust trailing the fragment.
        for (const [sx, sy, r] of fr.specks) {
          ctx.fillStyle = `rgba(214,250,255,${((1 - k) * 0.85).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(cx + ox * 0.75 + sx * w * (1 + k * 3), cy + oy * 0.75 + sy * h * (1 + k * 3), r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

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
    target = clamp01((p - 0.18) / 0.55);
    copyTarget = ease(clamp01((p - 0.32) / 0.3));
    glide();
  };
  // Smooth scroll: the glass and the copy ease toward the scroll position instead of jumping with each wheel step.
  let target = 0;
  let copyTarget = 0;
  let copyNow = 0;
  let gliding = 0;
  const glide = () => {
    if (gliding) return;
    let last = performance.now();
    const step = (now) => {
      // Time-based easing: the same feel at 30, 60 or 120 frames per second.
      const k = 1 - Math.exp(-Math.min(100, now - last) / 110);
      last = now;
      burst += (target - burst) * k;
      copyNow += (copyTarget - copyNow) * k;
      if (Math.abs(target - burst) < 0.0008) burst = target;
      if (Math.abs(copyTarget - copyNow) < 0.0008) copyNow = copyTarget;
      card.style.setProperty("--burst", burst.toFixed(4));
      card.style.setProperty("--copy", copyNow.toFixed(4));
      draw();
      gliding = burst !== target || copyNow !== copyTarget ? requestAnimationFrame(step) : 0;
    };
    gliding = requestAnimationFrame(step);
  };
  poster.addEventListener("load", buildFrost, { once: true });
  new ResizeObserver(buildFrost).observe(bg);
  addEventListener("scroll", () => (raf ||= requestAnimationFrame(update)), { passive: true });
  update();
}
