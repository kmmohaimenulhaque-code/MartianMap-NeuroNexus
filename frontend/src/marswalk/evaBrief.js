/* EVA brief export: JSON (schema neuronexus.eva-brief.v1) plus the server's printable HTML page. */

import { fetchDustSeries } from "../services/marsEnvironmentApi";
import { seasonStatuses, statusAtSol } from "./decision";
import { marswalkApi } from "./marswalkApi";
import { buildVisualBriefHtml } from "./visualBrief";

export const BRIEF_SCHEMA = "neuronexus.eva-brief.v1";

/* Every value in the brief must carry a unit, an evidence class and a ledger id. */
export function validateBrief(brief) {
  const problems = [];
  if (brief?.schema !== BRIEF_SCHEMA) problems.push("schema");
  for (const [key, v] of Object.entries(brief?.values ?? {})) {
    if (!v.ledger_id) problems.push(`${key}: ledger_id`);
    if (!v.unit) problems.push(`${key}: unit`);
    if (!v.evidence) problems.push(`${key}: evidence`);
  }
  if (!brief?.sources?.length) problems.push("sources");
  return problems;
}

export async function downloadBrief(planId) {
  const brief = await marswalkApi.brief(planId);
  const problems = validateBrief(brief);
  if (problems.length) throw new Error(`EVA brief failed its schema check: ${problems.join(", ")}`);
  const url = URL.createObjectURL(new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `neuronexus_eva_brief_${planId}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return brief;
}

export function openPrintableBrief(planId) {
  window.open(marswalkApi.briefHtmlUrl(planId), "_blank", "noopener");
}

/* The site hillshade as an embedded JPEG data URL (about 900 px), so the brief is self-contained when saved or printed. */
async function embeddedImage(url, side = 900) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, side, side);
  return canvas.toDataURL("image/jpeg", 0.86);
}

/*
 * Visual printable brief in a new window: site image with the route, profile, status-by-sol strip and the full
 * server brief. The window opens immediately (inside the click, so pop-up blockers allow it) and fills in once
 * the brief and the dust series arrive; if a pop-up is blocked the plain server page opens instead.
 */
export async function openVisualBrief({ plan, frame, mode, conditions, siteLabel, activeSol }) {
  const w = window.open("", "_blank");
  if (!w) return openPrintableBrief(plan.plan_id);
  w.document.write('<p style="font:14px system-ui;padding:20px">Building the visual EVA brief…</p>');
  const cell = conditions?.dust?.cell;
  const [brief, series, image] = await Promise.all([
    marswalkApi.brief(plan.plan_id).catch(() => null),
    cell ? fetchDustSeries(cell.latitude_deg, cell.longitude_deg).catch(() => null) : Promise.resolve(null),
    embeddedImage(marswalkApi.imageUrl(frame, mode, "hillshade", 1500)).catch(() => ""),
  ]);
  const html = buildVisualBriefHtml({
    brief,
    plan,
    frame,
    imageUrl: image,
    stops: plan.points ?? [],
    season: series?.tau ? seasonStatuses(plan.status.value, series.tau) : null,
    activeSol,
    siteLabel,
    statusAtSol: conditions?.solar?.dust_class ? statusAtSol(plan.status.value, conditions.solar.dust_class) : null,
  });
  w.document.open();
  w.document.write(html);
  w.document.close();
  return undefined;
}
