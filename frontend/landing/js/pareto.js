import { finePointer, reducedMotion } from "./env.js";

const DETAILS = [
  { title: "Low distance", status: "Dominated in this set", summary: "The shortest line is the trap in this set. It saves only 0.03% versus the low-EVA route while adding 8,735 m of climb.", values: [94, 100, 92, 54], metrics: ["1,464.7 km", "31,332 m", "630.1 h", "94.3"] },
  { title: "Low EVA", status: "Pareto / non-dominated", summary: "An extra 480 m buys 6.37 hours less estimated EVA time and 8,735 m less climb.", values: [94, 72, 91, 52], metrics: ["1,465.2 km", "22,597 m", "623.7 h", "93.1"] },
  { title: "Low terrain-risk proxy", status: "Pareto / non-dominated", summary: "This candidate spends distance to reduce the risk proxy from 94.3 to 79.5.", values: [97, 68, 94, 18], metrics: ["1,510.3 km", "21,416 m", "639.8 h", "79.5"] },
  { title: "Low terrain burden", status: "Pareto / non-dominated", summary: "The lowest cumulative climb and terrain burden come with the longest estimated EVA time.", values: [100, 64, 100, 27], metrics: ["1,620.6 km", "20,099 m", "681.7 h", "82.1"] },
  { title: "Science first", status: "Pareto / non-dominated", summary: "Science weighting keeps the route near cataloged USGS, IAU and THEMIS evidence while preserving a non-dominated trade-off.", values: [95, 73, 92, 36], metrics: ["1,471.8 km", "22,815 m", "626.7 h", "85.9"] },
  { title: "Balanced", status: "Pareto / non-dominated", summary: "Equal weights across EVA, terrain, science and operations produce a stable middle trade-off.", values: [95, 72, 92, 36], metrics: ["1,474.4 km", "22,652 m", "627.6 h", "85.9"] },
];

export function initPareto(root = document) {
  const section = root.querySelector("[data-pareto-detail]");
  const rows = [...root.querySelectorAll("[data-pareto-row]")];
  const filters = [...root.querySelectorAll("[data-pareto-filter]")];
  if (!section || !rows.length) return;
  // Status cells become pills: coral for the dominated route, cyan for the non-dominated frontier.
  rows.forEach((row) => {
    const cell = row.cells[1];
    const dominated = row.dataset.paretoStatus === "dominated";
    cell.innerHTML = `<span class="lp-status lp-status--${dominated ? "dominated" : "pareto"}">${cell.textContent.trim()}</span>`;
  });

  const select = (index) => {
    rows.forEach((row) => {
      const active = Number(row.dataset.paretoRow) === index;
      row.classList.toggle("is-selected", active);
      row.setAttribute("aria-selected", String(active));
    });
    const item = DETAILS[index];
    section.dataset.status = index === 0 ? "dominated" : "pareto";
    section.innerHTML = `<div><span class="lp-eyebrow"><span class="lp-dot" aria-hidden="true"></span>Selected candidate</span><h3>${item.title}</h3><p>${item.status}. ${item.summary} The <button class="lp-term" type="button" data-term="edge-cost-model">edge cost model</button> keeps the trade-off deterministic.</p></div><div class="lp-pareto-bars">${item.values.map((value, i) => `<span><small>${["Distance", "Climb", "EVA time", "Risk proxy"][i]}</small><i><b data-w="${value}"></b></i><em>${item.metrics?.[i] || ""}</em></span>`).join("")}</div>`;
    section.dispatchEvent(new CustomEvent("nn:terms-refresh", { bubbles: true }));
    // Bars grow from zero and the numbers count up, so every selection reads as a change.
    requestAnimationFrame(() => section.querySelectorAll("b[data-w]").forEach((b) => (b.style.width = `${b.dataset.w}%`)));
    section.querySelectorAll(".lp-pareto-bars em").forEach((em) => {
      const [, num, unit] = em.textContent.match(/^([\d,.]+)(.*)$/) || [];
      if (!num) return;
      const target = Number(num.replace(/,/g, ""));
      const decimals = (num.split(".")[1] || "").length;
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / 700);
        const v = target * (1 - (1 - k) ** 3);
        em.textContent = `${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${unit}`;
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };

  const filter = (value) => {
    rows.forEach((row) => {
      row.hidden = value !== "all" && row.dataset.paretoStatus !== value;
    });
    filters.forEach((button) => button.classList.toggle("is-active", button.dataset.paretoFilter === value));
    const first = rows.find((row) => !row.hidden);
    if (first) select(Number(first.dataset.paretoRow));
    section.closest("#pareto")?.dispatchEvent(new CustomEvent("nn:pareto-layout"));
  };

  rows.forEach((row) => {
    row.addEventListener("click", () => select(Number(row.dataset.paretoRow)));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(Number(row.dataset.paretoRow));
      }
    });
  });
  filters.forEach((button) => button.addEventListener("click", () => filter(button.dataset.paretoFilter)));
  select(0);
}

/* ------------------------------------------------------------------ Pareto scene */


/* Panorama behind the proof: pans with the cursor, and the cursor wipes a clear window through the dust frost. */
function panorama(section) {
  const pano = section.querySelector("[data-pano]");
  if (!pano) return;
  const imgs = [...pano.querySelectorAll("img")];
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  let raf = 0;
  const apply = () => {
    raf = 0;
    cur.x += (target.x - cur.x) * 0.08;
    cur.y += (target.y - cur.y) * 0.08;
    const iw = imgs[0].offsetWidth;
    const shift = Math.max(0, iw - pano.clientWidth);
    const r = section.getBoundingClientRect();
    const scrollY = Math.max(-1, Math.min(1, r.top / innerHeight));
    const tf = `translate3d(${(-shift / 2) * (1 + cur.x * 0.9)}px, ${cur.y * -10 + scrollY * 30}px, 0) scale(1.06)`;
    imgs.forEach((im) => (im.style.transform = tf));
    if (Math.abs(target.x - cur.x) > 0.001 || Math.abs(target.y - cur.y) > 0.001) raf = requestAnimationFrame(apply);
  };
  const kick = () => (raf ||= requestAnimationFrame(apply));
  section.addEventListener("pointermove", (e) => {
    const r = pano.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    target.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    pano.style.setProperty("--fx", `${e.clientX - r.left}px`);
    pano.style.setProperty("--fy", `${e.clientY - r.top}px`);
    pano.classList.add("is-wiping");
    kick();
  });
  section.addEventListener("pointerleave", () => {
    target.x = 0;
    target.y = 0;
    pano.classList.remove("is-wiping");
    kick();
  });
  addEventListener("scroll", kick, { passive: true });
  imgs[0].addEventListener("load", kick);
  kick();
}

/* Neurons: glowing somas with dendrites at the table's edges, axons to every row. Signals travel to the selected
   row on a rhythm and to any row the pointer reaches; the row flashes when a signal arrives. */
function neurons(section, rows) {
  const canvas = section.querySelector("[data-neurons]");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let W = 0;
  let H = 0;
  let somas = [];
  let paths = [];
  const pulses = [];
  let visible = false;
  let raf = 0;
  let lastSpawn = 0;

  const branch = (x, y, a, len, depth) => {
    const pts = [[x, y]];
    let cx = x;
    let cy = y;
    for (let i = 0; i < 6; i += 1) {
      a += (rnd() - 0.5) * 0.6;
      cx += Math.cos(a) * (len / 6);
      cy += Math.sin(a) * (len / 6);
      pts.push([cx, cy]);
    }
    const kids = depth > 0 ? [branch(cx, cy, a - 0.5, len * 0.55, depth - 1), branch(cx, cy, a + 0.5, len * 0.5, depth - 1)] : [];
    return { pts, kids, w: 0.6 + depth * 0.7 };
  };

  const layout = () => {
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    W = section.clientWidth;
    H = section.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sr = section.getBoundingClientRect();
    const shown = rows.filter((r) => !r.hidden);
    if (!shown.length) return;
    const first = shown[0].getBoundingClientRect();
    const last = shown[shown.length - 1].getBoundingClientRect();
    const midY = (first.top + last.bottom) / 2 - sr.top;
    seed = 23;
    const place = [
      [8, midY - 140, 0.2],
      [W - 8, midY + 60, Math.PI + 0.2],
      [W * 0.22, last.bottom - sr.top + 250, -1.9],
      [W * 0.78, last.bottom - sr.top + 290, -1.2],
    ];
    somas = place.map(([x, y, a]) => ({ x, y, r: 7 + rnd() * 5, phase: rnd() * 6, dendrites: Array.from({ length: 6 }, (_, i) => branch(x, y, a + (i - 2.5) * 0.55, 70 + rnd() * 90, 2)) }));
    paths = shown.map((row) => {
      const b = row.getBoundingClientRect();
      const y = b.top - sr.top + b.height / 2;
      const left = b.left - sr.left;
      const right = b.right - sr.left;
      const fromRight = rows.indexOf(row) % 2 === 1;
      const s = fromRight ? somas[1] : somas[0];
      const ex = fromRight ? right - 2 : left + 2;
      return { row, p0: [s.x, s.y], p1: [s.x + (fromRight ? -1 : 1) * 160, s.y], p2: [ex + (fromRight ? 1 : -1) * 120, y], p3: [ex, y] };
    });
    if (reducedMotion()) draw(0);
  };

  const bez = (p, u) => {
    const v = 1 - u;
    return [0, 1].map((i) => v * v * v * p.p0[i] + 3 * v * v * u * p.p1[i] + 3 * v * u * u * p.p2[i] + u * u * u * p.p3[i]);
  };
  const fire = (row) => {
    const path = paths.find((q) => q.row === row);
    if (path) pulses.push({ path, t0: performance.now(), dur: 900 + rnd() * 300 });
  };

  const drawBranch = (b, alpha) => {
    ctx.strokeStyle = `rgba(1,255,255,${alpha})`;
    ctx.lineWidth = b.w;
    ctx.beginPath();
    b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    b.kids.forEach((k) => drawBranch(k, alpha * 0.8));
  };

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const t = now / 1000;
    for (const p of paths) {
      const sel = p.row.classList.contains("is-selected");
      ctx.strokeStyle = `rgba(1,255,255,${sel ? 0.3 : 0.1})`;
      ctx.lineWidth = sel ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(...p.p0);
      ctx.bezierCurveTo(...p.p1, ...p.p2, ...p.p3);
      ctx.stroke();
    }
    for (const s of somas) {
      const glow = 0.6 + 0.4 * Math.sin(t * 1.6 + s.phase);
      s.dendrites.forEach((d) => drawBranch(d, 0.32 * glow));
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 7);
      g.addColorStop(0, `rgba(220,255,255,${0.9 * glow})`);
      g.addColorStop(0.18, `rgba(1,255,255,${0.55 * glow})`);
      g.addColorStop(1, "rgba(1,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
      const q = pulses[i];
      const u = (now - q.t0) / q.dur;
      if (u >= 1) {
        q.path.row.classList.add("is-zap");
        setTimeout(() => q.path.row.classList.remove("is-zap"), 450);
        pulses.splice(i, 1);
        continue;
      }
      for (let k = 0; k < 10; k += 1) {
        const [x, y] = bez(q.path, Math.max(0, u - k * 0.012));
        ctx.fillStyle = `rgba(${k ? "1,255,255" : "235,255,255"},${(1 - k / 10) * 0.9})`;
        ctx.beginPath();
        ctx.arc(x, y, k ? 2.4 - k * 0.18 : 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  const loop = (now) => {
    raf = 0;
    if (!visible || document.hidden) return;
    if (now - lastSpawn > 1400) {
      lastSpawn = now;
      const sel = rows.find((r) => r.classList.contains("is-selected") && !r.hidden);
      if (sel) fire(sel);
    }
    draw(now);
    raf = requestAnimationFrame(loop);
  };

  rows.forEach((row) => row.addEventListener("pointerenter", () => fire(row)));
  new ResizeObserver(layout).observe(section);
  section.addEventListener("nn:pareto-layout", layout);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !reducedMotion()) raf ||= requestAnimationFrame(loop);
  }).observe(section);
  layout();
}

/* Column scan: the column under the pointer lights up across every row. */
function columnScan(table) {
  if (!table || !finePointer()) return;
  let col = -1;
  const set = (i) => {
    if (i === col) return;
    col = i;
    table.querySelectorAll(".is-col").forEach((c) => c.classList.remove("is-col"));
    if (i < 0) return;
    table.querySelectorAll("tr").forEach((tr) => tr.children[i]?.classList.add("is-col"));
  };
  table.addEventListener("pointerover", (e) => set(e.target.closest("td, th")?.cellIndex ?? -1));
  table.addEventListener("pointerleave", () => set(-1));
}

export function initParetoScene(root = document) {
  const section = root.querySelector("#pareto");
  if (!section) return;
  panorama(section);
  neurons(section, [...section.querySelectorAll("[data-pareto-row]")]);
  columnScan(section.querySelector(".lp-pareto-table"));
}
