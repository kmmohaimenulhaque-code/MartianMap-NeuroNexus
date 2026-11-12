/* Interactive canvas effects for the dark mission theme.
   streams:  cyan flow lines that bend away from the pointer (statement and approach).
   terrain:  a wireframe of Gale crater drawn from real NASA MOLA elevations (data/gale-mola.json), colored by
             height, slowly turning; drag to turn it, the pointer tilts it.
   sparks:   drifting light particles behind the proof number.
   wave:     a field of cyan points rippling under the pointer (principles).
   Cards:    pointer-following tilt and glow on the Core Features cards.
   network:  drifting linked nodes that reach for the pointer (challenge, team); stars: the finale's sky.
   Storm:    a dust storm on scroll that carries the page from the monochrome hero into the colored sections.
   Every canvas pauses off screen and when the tab is hidden. Reduced motion or Save-Data draw one still frame. */

import gale from "../data/gale-mola.json";
import { finePointer, reducedMotion, saveData } from "./env.js";

const CYAN = [1, 255, 255];
const still = () => reducedMotion() || saveData();

/* Canvas sized to its box at device pixel ratio, a pointer in -1..1 over `area`, and a frame loop that only
   runs while visible. draw(ctx, w, h, t, pointer) gets CSS pixels and seconds. */
function stage(canvas, draw, area = canvas.parentElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false };
  let w = 0;
  let h = 0;
  let visible = false;
  let raf = 0;
  const t0 = performance.now();
  const size = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (still()) render(0);
  };
  const render = (t) => {
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, t, pointer);
  };
  const frame = (now) => {
    raf = 0;
    if (!visible || document.hidden) return;
    render((now - t0) / 1000);
    raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && visible && !still()) raf = requestAnimationFrame(frame);
  };
  area.addEventListener("pointermove", (e) => {
    const r = area.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    pointer.active = true;
  });
  area.addEventListener("pointerleave", () => {
    pointer.tx = 0;
    pointer.ty = 0;
    pointer.active = false;
  });
  new ResizeObserver(size).observe(canvas);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) (still() ? render(0) : kick());
  }, { rootMargin: "120px 0px" }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  size();
  return { pointer };
}

/* ------------------------------------------------------------------ streams */

function streams(canvas) {
  const lines = Array.from({ length: 38 }, (_, i) => ({
    y: 0.18 + (i / 38) * 0.64,
    a: 18 + Math.random() * 46,
    f: 1.2 + Math.random() * 1.8,
    s: 0.12 + Math.random() * 0.25,
    p: Math.random() * Math.PI * 2,
    o: 0.08 + Math.random() * 0.32,
  }));
  stage(canvas, (ctx, w, h, t, ptr) => {
    ctx.globalCompositeOperation = "lighter";
    const px = (ptr.x + 1) * 0.5 * w;
    const py = (ptr.y + 1) * 0.5 * h;
    for (const l of lines) {
      ctx.beginPath();
      for (let i = 0; i <= 64; i += 1) {
        const x = (i / 64) * w * 1.1 - w * 0.05;
        let y = l.y * h + Math.sin((x / w) * Math.PI * l.f + t * l.s + l.p) * l.a + Math.sin((x / w) * 9 + t * 0.6 + l.p) * 4;
        if (ptr.active) {
          const d = Math.hypot(x - px, y - py);
          y += Math.sign(y - py || 1) * 70 * Math.exp(-(d * d) / 16000);
        }
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${CYAN},${l.o * 0.35})`;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${CYAN},${l.o})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  });
}

/* ------------------------------------------------------------------ terrain */

const RAMP = [
  [0.0, [40, 90, 255]],
  [0.3, [1, 220, 255]],
  [0.55, [60, 235, 140]],
  [0.78, [255, 220, 70]],
  [1.0, [255, 70, 60]],
];
function ramp(v) {
  for (let i = 1; i < RAMP.length; i += 1) {
    const [b, cb] = RAMP[i];
    const [a, ca] = RAMP[i - 1];
    if (v <= b) {
      const k = (v - a) / (b - a);
      return ca.map((c, j) => Math.round(c + (cb[j] - c) * k));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function terrain(canvas, { rings = true, sparks = 0 } = {}) {
  const rows = gale.rows;
  const cols = gale.cols;
  const flat = gale.elevation_m.flat();
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const n = gale.elevation_m.map((r) => r.map((e) => (e - lo) / (hi - lo)));
  const motes = Array.from({ length: sparks }, () => ({ x: Math.random(), y: Math.random(), v: 0.02 + Math.random() * 0.05, r: 0.6 + Math.random() * 1.6 }));
  let spin = 0.6;
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, spin };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) spin = drag.spin + (e.clientX - drag.x) * 0.01;
  });
  const end = () => (drag = null);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  stage(canvas, (ctx, w, h, t, ptr) => {
    if (!drag && !still()) spin += 0.0025;
    const yaw = spin + ptr.x * 0.25;
    const pitch = 0.95 + ptr.y * 0.12;
    const scale = Math.min(w, h * 1.5) * 0.36;
    const cx = w / 2;
    const cy = h * 0.56;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    // Vertical exaggeration 0.42 of the grid width: the mound reads as a mound. Heights are MOLA, only scaled.
    const project = (x, y, z) => {
      const rx = x * cosY - z * sinY;
      const rz = x * sinY + z * cosY;
      const ry = y * cosP - rz * sinP;
      const d = 3.2 / (3.2 + (y * sinP + rz * cosP));
      return [cx + rx * scale * d, cy - ry * scale * d];
    };
    const pt = (r, c) => project((c / (cols - 1)) * 2 - 1, n[r][c] * 0.42 - 0.12, (r / (rows - 1)) * 2 - 1);

    ctx.globalCompositeOperation = "lighter";
    if (rings) {
      for (let k = 0; k < 3; k += 1) {
        ctx.beginPath();
        const R = 1.25 + k * 0.22;
        for (let i = 0; i <= 96; i += 1) {
          const a = (i / 96) * Math.PI * 2 + t * (0.15 + k * 0.05) * (k % 2 ? -1 : 1);
          const [x, y] = project(Math.cos(a) * R, -0.16, Math.sin(a) * R);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.setLineDash(k === 1 ? [4, 10] : []);
        ctx.strokeStyle = `rgba(${CYAN},${0.32 - k * 0.08})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    for (let pass = 0; pass < 2; pass += 1) {
      ctx.lineWidth = pass ? 1 : 3.5;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const [x0, y0] = pt(r, c);
          if (c + 1 < cols) {
            const [x1, y1] = pt(r, c + 1);
            ctx.strokeStyle = `rgba(${ramp((n[r][c] + n[r][c + 1]) / 2)},${pass ? 0.85 : 0.12})`;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
          if (r + 1 < rows) {
            const [x1, y1] = pt(r + 1, c);
            ctx.strokeStyle = `rgba(${ramp((n[r][c] + n[r + 1][c]) / 2)},${pass ? 0.85 : 0.12})`;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
        }
      }
    }
    for (const m of motes) {
      const y = ((m.y - t * m.v) % 1 + 1) % 1;
      ctx.fillStyle = `rgba(${m.x > 0.5 ? CYAN : [255, 214, 120]},${0.25 + 0.6 * Math.sin(y * Math.PI)})`;
      ctx.beginPath();
      ctx.arc(m.x * w, y * h, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }, canvas.closest("section") ?? canvas.parentElement);
}

/* ------------------------------------------------------------------ wave */

function wave(canvas) {
  const NX = 72;
  const NZ = 22;
  stage(canvas, (ctx, w, h, t, ptr) => {
    ctx.globalCompositeOperation = "lighter";
    const px = ptr.x;
    for (let z = 0; z < NZ; z += 1) {
      const depth = z / (NZ - 1);
      const persp = 0.35 + depth * 0.65;
      for (let x = 0; x < NX; x += 1) {
        const u = x / (NX - 1) - 0.5;
        let y = Math.sin(u * 9 + t * 0.9 + depth * 3) * 0.5 + Math.cos(u * 4 - t * 0.6 + depth * 5) * 0.5;
        if (ptr.active) y += Math.exp(-((u * 2 - px) ** 2) * 6) * Math.sin(t * 3 - depth * 6) * 0.9;
        const sx = w / 2 + u * w * 1.1 * persp;
        const sy = h * 0.22 + depth * h * 0.7 + y * 34 * persp;
        ctx.fillStyle = `rgba(${CYAN},${0.2 + depth * 0.7})`;
        ctx.fillRect(sx, sy, 1.6 + depth * 2.4, 1.6 + depth * 2.4);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  });
}

/* ------------------------------------------------------------------ cards */

function tiltCards(list) {
  if (!list || !finePointer() || still()) return;
  list.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".lp-card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    card.style.setProperty("--rx", `${(0.5 - y) * 6}deg`);
    card.style.setProperty("--ry", `${(x - 0.5) * 8}deg`);
    card.style.setProperty("--mx", `${x * 100}%`);
    card.style.setProperty("--my", `${y * 100}%`);
  });
  list.addEventListener("pointerout", (e) => {
    const card = e.target.closest(".lp-card");
    if (card && !card.contains(e.relatedTarget)) ["--rx", "--ry"].forEach((p) => card.style.setProperty(p, "0deg"));
  });
}

/* ------------------------------------------------------------------ dust storm transition */

/* Scrolling out of the monochrome hero, a dust storm sweeps across the screen while the page color moves
   charcoal -> rust dust -> navy; it clears as the next sections arrive. Reduced motion keeps only the color. */
const SKY = [
  [0, [18, 20, 22]],
  [0.55, [58, 34, 22]],
  [1, [6, 12, 20]],
];
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
function skyAt(p) {
  for (let i = 1; i < SKY.length; i += 1) {
    if (p <= SKY[i][0]) return mix(SKY[i - 1][1], SKY[i][1], (p - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]));
  }
  return SKY[SKY.length - 1][1];
}

function puff(rgb) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, `rgba(${rgb},0.55)`);
  r.addColorStop(0.5, `rgba(${rgb},0.22)`);
  r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function dustStorm(doc) {
  const hero = doc.querySelector(".lp-hero");
  if (!hero) return;
  const body = doc.body;
  const canvas = doc.createElement("canvas");
  canvas.className = "lp-dust";
  canvas.setAttribute("aria-hidden", "true");
  body.append(canvas);
  const ctx = canvas.getContext("2d");
  const sprites = [puff("196,120,74"), puff("150,88,56"), puff("222,170,120")];
  const puffs = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: 120 + Math.random() * 420, v: 0.04 + Math.random() * 0.12, k: (Math.random() * 3) | 0, w: Math.random() * 6 }));
  const grains = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), v: 0.25 + Math.random() * 0.6, l: 6 + Math.random() * 22 }));
  let w = 0;
  let h = 0;
  let level = 0;
  let raf = 0;
  const size = () => {
    w = canvas.width = innerWidth; // soft dust needs no device-pixel detail
    h = canvas.height = innerHeight;
  };
  const progress = () => {
    const r = hero.getBoundingClientRect();
    return Math.min(1, Math.max(0, -r.top / (r.height * 1.25)));
  };
  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    if (level < 0.01) return;
    ctx.globalAlpha = level * 0.55;
    ctx.fillStyle = "rgb(120,72,44)";
    ctx.fillRect(0, 0, w, h);
    for (const q of puffs) {
      const x = (((q.x + t * q.v) % 1.4) - 0.2) * w;
      const y = (q.y + Math.sin(t * 0.4 + q.w) * 0.04) * h;
      ctx.globalAlpha = level * 0.9;
      ctx.drawImage(sprites[q.k], x - q.s / 2, y - q.s / 2, q.s * 1.6, q.s);
    }
    ctx.globalAlpha = level * 0.5;
    ctx.strokeStyle = "rgb(236,196,150)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const g of grains) {
      const x = ((g.x + t * g.v) % 1.1) * w;
      const y = g.y * h + Math.sin(t * 2 + g.x * 20) * 6;
      ctx.moveTo(x, y);
      ctx.lineTo(x - g.l, y + g.l * 0.12);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const t0 = performance.now();
  const loop = (now) => {
    raf = 0;
    draw((now - t0) / 1000);
    if (level >= 0.01 && !document.hidden) raf = requestAnimationFrame(loop);
  };
  const onScroll = () => {
    const p = progress();
    body.style.backgroundColor = `rgb(${skyAt(p)})`;
    body.classList.toggle("is-colored", p > 0.75);
    // Storm strength: a bell between the hero's lower half and the next section, zero before and after.
    const k = Math.min(1, Math.max(0, (p - 0.12) / 0.86));
    level = still() ? 0 : Math.sin(k * Math.PI) ** 1.5;
    if (level >= 0.01 && !raf) raf = requestAnimationFrame(loop);
    if (level < 0.01) ctx.clearRect(0, 0, w, h);
  };
  addEventListener("resize", () => {
    size();
    onScroll();
  });
  addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onScroll);
  size();
  onScroll();
}

/* ------------------------------------------------------------------ network + stars */

/* Drifting nodes linked to their neighbors; the pointer pulls nearby nodes and links to them (challenge, team). */
function network(canvas) {
  const nodes = Array.from({ length: 64 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.02, vy: (Math.random() - 0.5) * 0.02 }));
  let last = 0;
  stage(canvas, (ctx, w, h, t, ptr) => {
    const dt = Math.min(0.05, t - last || 0.016);
    last = t;
    const px = (ptr.x + 1) * 0.5 * w;
    const py = (ptr.y + 1) * 0.5 * h;
    for (const n of nodes) {
      n.x = (n.x + n.vx * dt + 1) % 1;
      n.y = (n.y + n.vy * dt + 1) % 1;
      if (ptr.active) {
        const dx = px - n.x * w;
        const dy = py - n.y * h;
        const d = Math.hypot(dx, dy);
        if (d < 220 && d > 1) {
          n.x += (dx / d) * 0.0006;
          n.y += (dy / d) * 0.0006;
        }
      }
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const d = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
        if (d < 150) {
          ctx.strokeStyle = `rgba(${CYAN},${(1 - d / 150) * 0.28})`;
          ctx.beginPath();
          ctx.moveTo(a.x * w, a.y * h);
          ctx.lineTo(b.x * w, b.y * h);
          ctx.stroke();
        }
      }
      if (ptr.active) {
        const d = Math.hypot(a.x * w - px, a.y * h - py);
        if (d < 220) {
          ctx.strokeStyle = `rgba(255,210,122,${(1 - d / 220) * 0.6})`;
          ctx.beginPath();
          ctx.moveTo(a.x * w, a.y * h);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
      }
      ctx.fillStyle = `rgba(${CYAN},${0.5 + 0.5 * Math.sin(t * 2 + i)})`;
      ctx.beginPath();
      ctx.arc(a.x * w, a.y * h, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  });
}

/* Twinkling stars with pointer parallax and an occasional meteor (finale). */
function stars(canvas) {
  const field = Array.from({ length: 280 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, p: Math.random() * 6 }));
  let meteor = null;
  stage(canvas, (ctx, w, h, t, ptr) => {
    for (const s of field) {
      const x = (s.x * w - ptr.x * 30 * s.z + w) % w;
      const y = (s.y * h - ptr.y * 20 * s.z + h) % h;
      ctx.fillStyle = `rgba(230,246,250,${(0.25 + 0.55 * s.z) * (0.6 + 0.4 * Math.sin(t * 1.5 + s.p))})`;
      ctx.fillRect(x, y, s.z * 1.8, s.z * 1.8);
    }
    if (!meteor && Math.random() < 0.01) meteor = { x: Math.random() * w, y: Math.random() * h * 0.4, t };
    if (meteor) {
      const k = (t - meteor.t) / 0.9;
      if (k > 1) meteor = null;
      else {
        const x = meteor.x + k * 320;
        const y = meteor.y + k * 140;
        const g = ctx.createLinearGradient(x - 120, y - 52, x, y);
        g.addColorStop(0, "rgba(1,255,255,0)");
        g.addColorStop(1, `rgba(230,250,255,${1 - k})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 120, y - 52);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
  });
}

/* ------------------------------------------------------------------ dust motes + spotlight */

/* Drifting dust that scatters from the pointer. moondust: slow, rising lunar dust in the Apollo scene.
   motes: fine cyan and white motes around the Pareto proof. */
function dust(canvas, { count, rgb, rise, size }) {
  const motes = Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, p: Math.random() * 6, ox: 0, oy: 0 }));
  stage(canvas, (ctx, w, h, t, ptr) => {
    const px = (ptr.x + 1) * 0.5 * w;
    const py = (ptr.y + 1) * 0.5 * h;
    for (const m of motes) {
      m.y = (m.y - rise * m.z * 0.0016 + 1) % 1;
      m.x = (m.x + Math.sin(t * 0.3 + m.p) * 0.0004 * m.z + 1) % 1;
      let x = m.x * w + m.ox;
      let y = m.y * h + m.oy;
      if (ptr.active) {
        const dx = x - px;
        const dy = y - py;
        const d = Math.hypot(dx, dy);
        if (d < 140 && d > 0.5) {
          m.ox += (dx / d) * (140 - d) * 0.04;
          m.oy += (dy / d) * (140 - d) * 0.04;
        }
      }
      m.ox *= 0.96;
      m.oy *= 0.96;
      x = m.x * w + m.ox;
      y = m.y * h + m.oy;
      const tw = 0.55 + 0.45 * Math.sin(t * 1.3 + m.p);
      const c = typeof rgb === "function" ? rgb(m) : rgb;
      ctx.fillStyle = `rgba(${c},${(0.15 + 0.6 * m.z) * tw})`;
      ctx.beginPath();
      ctx.arc(x, y, size * m.z, 0, Math.PI * 2);
      ctx.fill();
    }
  }, canvas.closest("section") ?? canvas.parentElement);
}

/* A soft cyan glow that follows the pointer across tables and cards (CSS reads --sx and --sy). */
function spotlight(doc) {
  if (!finePointer()) return;
  doc.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(".lp-table-wrap, .lp-pareto-detail, .lp-impact__grid article, .lp-innovation__grid article");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--sx", `${e.clientX - r.left}px`);
    el.style.setProperty("--sy", `${e.clientY - r.top}px`);
  });
}

const FX = { streams, terrain: (c) => terrain(c), "terrain-sparks": (c) => terrain(c, { rings: false, sparks: 70 }), wave, network, stars,
  moondust: (c) => dust(c, { count: 140, rgb: "232,236,240", rise: 0.5, size: 1.6 }),
  motes: (c) => dust(c, { count: 90, rgb: (m) => (m.p > 3 ? "1,255,255" : "220,236,240"), rise: 0.25, size: 1.3 }),
};

export function initFx(doc = document) {
  doc.querySelectorAll("canvas[data-fx]").forEach((c) => FX[c.dataset.fx]?.(c));
  tiltCards(doc.querySelector("[data-cards]"));
  spotlight(doc);
  dustStorm(doc);
}
