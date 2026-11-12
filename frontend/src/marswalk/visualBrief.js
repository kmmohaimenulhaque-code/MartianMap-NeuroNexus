/*
 * Visual printable EVA brief: the server brief (schema neuronexus.eva-brief.v1: values with evidence and ledger ids,
 * dose screening, segments, limitations, sources) laid out with three figures built in the browser from data the
 * console already has: the site hillshade (the same /terrain/hires/image the site map shows) with the route and
 * numbered stops drawn on it, the elevation and slope profile, and the status-by-sol strip. Nothing is
 * re-computed here; every number comes from the plan or the brief.
 */
import { toLocal } from "./marswalkMath";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? "n/a" : Number(v).toFixed(d));
const hm = (h) => (h == null || !Number.isFinite(h) ? "n/a" : `${h < 0 ? "−" : ""}${Math.floor(Math.abs(h))} h ${String(Math.round((Math.abs(h) % 1) * 60)).padStart(2, "0")} min`);
const STATUS_COLORS = { "WITHIN PLANNING LIMITS": "#1f9d5a", "REVIEW REQUIRED": "#c98a12", "EXCEEDS PLANNING LIMIT": "#c43a52", UNAVAILABLE: "#8a979c" };

/* Route and stops over the hillshade: the image spans [-halfWidth, halfWidth] m around the frame centre. */
export function routeOverlaySvg(plan, frame, stops, size = 600) {
  const ext = frame.halfWidth;
  const px = ([x, y]) => [((x + ext) / (2 * ext)) * size, ((ext - y) / (2 * ext)) * size];
  const coords = plan?.geometry?.coordinates ?? [];
  const step = Math.max(1, Math.ceil(coords.length / 800));
  const pts = coords.filter((_, i) => i % step === 0 || i === coords.length - 1).map(([lon, lat]) => px(toLocal(lat, lon, frame)).map((v) => v.toFixed(1)).join(","));
  const pins = stops
    .map((s, i) => {
      const [x, y] = px(toLocal(s.lat, s.lon, frame));
      const label = i === 0 ? "B" : String(i);
      return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="#ffffff" stroke="#0b5566" stroke-width="2.5"/><text x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#0b5566">${label}</text></g>`;
    })
    .join("");
  const tp = plan?.turnaround;
  const pnr = tp && !tp.reached_target && tp.lat != null ? (() => {
    const [x, y] = px(toLocal(tp.lat, tp.lon, frame));
    return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" stroke="#c43a52" stroke-width="3"/><text x="${(x + 13).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="12" font-weight="700" fill="#c43a52">PNR</text></g>`;
  })() : "";
  return `<svg class="overlay" viewBox="0 0 ${size} ${size}" preserveAspectRatio="none" aria-hidden="true">
<polyline points="${pts.join(" ")}" fill="none" stroke="#ffffff" stroke-width="7" stroke-linejoin="round" opacity="0.9"/>
<polyline points="${pts.join(" ")}" fill="none" stroke="#0a8fb0" stroke-width="3.5" stroke-linejoin="round"/>${pnr}${pins}</svg>`;
}

/* Elevation (line) and slope at 3 m (bars) along the track. */
export function profileSvg(profile, width = 720, height = 170) {
  const d = profile?.distance_m ?? [];
  if (d.length < 2) return "<p>Profile unavailable.</p>";
  const pad = { l: 46, r: 40, t: 10, b: 24 };
  const L = d[d.length - 1] || 1;
  const z = (profile.elevation_m ?? []).filter((v) => v != null);
  const zmin = Math.min(...z);
  const zmax = Math.max(...z);
  const smax = Math.max(30, ...(profile.slope_3m_deg ?? []).filter((v) => v != null));
  const sx = (v) => pad.l + (v / L) * (width - pad.l - pad.r);
  const sz = (v) => pad.t + (1 - (v - zmin) / Math.max(1, zmax - zmin)) * (height - pad.t - pad.b);
  const ss = (v) => pad.t + (1 - v / smax) * (height - pad.t - pad.b);
  const step = Math.max(1, Math.ceil(d.length / 700));
  let elev = "";
  let slope = "";
  for (let i = 0; i < d.length; i += step) {
    if (profile.elevation_m[i] != null) elev += `${elev ? "L" : "M"}${sx(d[i]).toFixed(1)},${sz(profile.elevation_m[i]).toFixed(1)}`;
    if (profile.slope_3m_deg?.[i] != null) slope += `M${sx(d[i]).toFixed(1)},${ss(0).toFixed(1)}V${ss(profile.slope_3m_deg[i]).toFixed(1)}`;
  }
  const pnr = profile.pnr_distance_m != null && profile.pnr_distance_m < L ? `<line x1="${sx(profile.pnr_distance_m)}" x2="${sx(profile.pnr_distance_m)}" y1="${pad.t}" y2="${height - pad.b}" stroke="#c43a52" stroke-width="2" stroke-dasharray="5 3"/>` : "";
  return `<svg class="profile" viewBox="0 0 ${width} ${height}" role="img" aria-label="Elevation and slope profile">
<path d="${slope}" stroke="#7fc3d4" stroke-width="1"/>
<path d="${elev}" fill="none" stroke="#11262d" stroke-width="2"/>${pnr}
<text x="4" y="${pad.t + 10}" font-size="11">${num(zmax, 0)} m</text><text x="4" y="${height - pad.b}" font-size="11">${num(zmin, 0)} m</text>
<text x="${width - pad.r + 4}" y="${pad.t + 10}" font-size="11" fill="#2b7d91">${num(smax, 0)}°</text>
<text x="${pad.l}" y="${height - 6}" font-size="11">0 m</text><text x="${width - pad.r}" y="${height - 6}" font-size="11" text-anchor="end">${num(L, 0)} m along track</text></svg>`;
}

/* The status-by-sol strip (statuses from seasonStatuses in decision.js). */
export function statusStripSvg(statuses, activeSol, width = 720, height = 26) {
  if (!statuses?.length) return "<p>Status by sol unavailable (dust scenario not loaded).</p>";
  const n = statuses.length;
  const w = width / n;
  const cells = statuses.map((s, i) => `<rect x="${(i * w).toFixed(2)}" y="0" width="${(w + 0.3).toFixed(2)}" height="${height}" fill="${STATUS_COLORS[s] ?? "#ffffff"}"/>`).join("");
  const cursor = activeSol ? `<rect x="${((activeSol - 1) * w).toFixed(2)}" y="0" width="2" height="${height}" fill="#11262d"/>` : "";
  return `<svg class="strip" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Status at each sol of MY34">${cells}${cursor}</svg>`;
}

export function buildVisualBriefHtml({ brief, plan, frame, imageUrl, stops, season, activeSol, siteLabel, statusAtSol }) {
  const b = plan.budget ?? {};
  const s = plan.summary ?? {};
  const status = plan.status?.value ?? "UNAVAILABLE";
  const dose = brief?.dose;
  const doseLine = dose?.value != null
    ? `${num(dose.value, 1)} ${esc(dose.unit)} for ${num(dose.eva_h, 0)} h (IQR ${num(dose.band?.[0], 1)} to ${num(dose.band?.[1], 1)}) · RAD sol ${esc(dose.input?.latest_sol)}, archive lag ${esc(dose.input?.lag_days)} days`
    : `${esc(dose?.status ?? "UNAVAILABLE")}${dose?.reason ? `: ${esc(dose.reason)}` : ""}`;
  const counts = season?.counts ?? {};
  const best = season?.longestWithin;
  const segCounts = {};
  for (const seg of plan.segments ?? []) segCounts[seg.class] = (segCounts[seg.class] ?? 0) + 1;
  const rows = Object.entries(brief?.values ?? {})
    .map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, " "))}</td><td>${esc(typeof v.value === "number" ? num(v.value, 2) : v.value)} ${esc(v.unit)}</td><td>${esc(v.evidence)}</td><td>${esc(v.ledger_id)}</td></tr>`)
    .join("");
  const sources = (brief?.sources ?? []).map((src) => `<li><b>${esc(src.ledger_id)}</b>: ${esc(src.title)} (${esc(src.organization)}; ${esc(src.evidence_class)})${src.url ? ` · ${esc(src.url)}` : ""}</li>`).join("");
  const key = [
    ["Length", `${num(s.length_m?.value, 0)} m (straight line ${num(plan.method?.straight_line_m, 0)} m)`],
    ["Gain / loss", `+${num(s.elevation_gain_m?.value, 0)} / −${num(s.elevation_loss_m?.value, 0)} m`],
    ["Max slope", `${num(s.max_slope_3m_deg?.value)}° @3 m · ${num(s.max_slope_1m_deg?.value)}° @1 m`],
    ["Outbound / return", `${hm(b.outbound_h)} / ${hm(b.return_h)}`],
    ["Walk-back margin", `${hm(b.margin_h)} (usable ${hm(b.usable_h)} of ${num(b.eva_h, 0)} h)`],
    ["Turnaround (PNR)", plan.turnaround?.reached_target ? "all stops within budget" : `${num(plan.turnaround?.distance_m, 0)} m along track`],
    ["Stops", `${Math.max(0, stops.length - 1)} (visited in order)`],
    ["Radiation screening", doseLine],
  ]
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EVA brief ${esc(plan.plan_id)}</title>
<style>
body{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;margin:20px auto;max-width:980px;padding:0 14px;color:#11262d}
h1{font-size:19px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px;letter-spacing:.04em;text-transform:uppercase}
.meta{color:#4b6168;font-size:12px}.status{display:inline-block;margin:8px 0 2px;padding:6px 10px;border:2px solid currentColor;font-weight:700;letter-spacing:.06em}
.grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:16px;align-items:start}
figure{margin:0}.site{position:relative;width:100%;aspect-ratio:1/1;background:#d9d9d9;border:1px solid #9fb0b5}.site img,.site .overlay{position:absolute;inset:0;width:100%;height:100%}
.noimg{position:absolute;inset:auto 8px 8px 8px;margin:0;color:#4b6168;font-size:12px}figcaption{color:#4b6168;font-size:11.5px;margin-top:4px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #b9c6ca;padding:4px 6px;text-align:left;vertical-align:top}th{width:34%;background:#eef3f4}
svg.profile,svg.strip{width:100%;height:auto;display:block;border:1px solid #b9c6ca}.strip{height:26px}.counts span{margin-right:14px;font-weight:600}
.legend i{display:inline-block;width:10px;height:10px;margin:0 4px 0 10px;vertical-align:middle}.toolbar{position:sticky;top:0;background:#fff;padding:6px 0;border-bottom:1px solid #d7e0e2;margin-bottom:10px}
.toolbar button{font:600 13px system-ui;padding:6px 12px;border:1px solid #0a8fb0;background:#e9f6f9;color:#0b5566;cursor:pointer}
@media (max-width:720px){.grid{grid-template-columns:1fr}}@media print{.toolbar{display:none}body{margin:0}h2{break-after:avoid}figure,svg{break-inside:avoid}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">PRINT / SAVE AS PDF</button></div>
<h1>NeuroNexus EVA brief · ${esc(siteLabel)}</h1>
<div class="meta">plan ${esc(plan.plan_id)} · engine ${esc(plan.engine_version)} · config ${esc(plan.config_hash)} · generated ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC</div>
<div class="status" style="color:${STATUS_COLORS[status] ?? "#11262d"}">${esc(status)}</div>
<div>${esc((plan.status?.reasons ?? []).join("; ") || "No review triggers.")}${statusAtSol ? ` · at the active sol: <b>${esc(statusAtSol)}</b>` : ""}</div>
<div class="grid">
<figure><div class="site">${imageUrl ? `<img src="${esc(imageUrl)}" alt="HiRISE/CTX/MOLA hillshade of the 3 x 3 km planning frame">` : '<p class="noimg">Terrain image unavailable; the route is drawn to scale.</p>'}${routeOverlaySvg(plan, frame, stops)}</div>
<figcaption>Planned route (blue) on the terrain-ladder hillshade of the ${num(frame.halfWidth * 2 / 1000, 0)} × ${num(frame.halfWidth * 2 / 1000, 0)} km frame; B = base (rover stand-in habitat), numbers = stops in order${plan.turnaround?.reached_target ? "" : ", PNR = turnaround point"}. North is up.</figcaption></figure>
<div><table>${key}</table></div>
</div>
<h2>Elevation and slope profile</h2>${profileSvg(plan.profile)}
<div class="meta">Line: elevation (m, MOLA areoid). Bars: slope at the 3 m baseline. Dashed red: turnaround point (PNR).</div>
<h2>Status by sol · MY34 (modeled dust)</h2>${statusStripSvg(season?.statuses, activeSol)}
<div class="legend"><i style="background:${STATUS_COLORS["WITHIN PLANNING LIMITS"]}"></i>WITHIN <i style="background:${STATUS_COLORS["REVIEW REQUIRED"]}"></i>REVIEW <i style="background:${STATUS_COLORS["EXCEEDS PLANNING LIMIT"]}"></i>EXCEEDS · dark line = active sol ${esc(activeSol ?? "")}</div>
<div class="counts"><span>WITHIN ${counts["WITHIN PLANNING LIMITS"] ?? 0} sols</span><span>REVIEW ${counts["REVIEW REQUIRED"] ?? 0}</span><span>EXCEEDS ${counts["EXCEEDS PLANNING LIMIT"] ?? 0}</span>${best ? `<span>longest WITHIN window: sol ${best.start} to ${best.end}</span>` : ""}</div>
<div class="meta">Route status combined with the NASA Ames MGCM MY34 dust class at each sol: a modeled year, not a forecast.</div>
<h2>Segments</h2><div>${Object.entries(segCounts).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ") || "n/a"}</div>
<h2>All values</h2><table><tr><th>Quantity</th><th>Value</th><th>Evidence</th><th>Source</th></tr>${rows}</table>
<h2>Radiation screening</h2><div>${doseLine}</div><div class="meta">${esc(dose?.rule ?? "")}. ${esc(dose?.note ?? "")}</div>
<h2>Limitations</h2><ul>${(brief?.limitations ?? plan.limitations ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<h2>Sources used</h2><ul>${sources}</ul>
<p class="meta">${esc(brief?.disclaimer ?? "Screening plan from NASA mission data. Planning limits are not safety limits. Not endorsed by NASA.")}</p>
</body></html>`;
}
