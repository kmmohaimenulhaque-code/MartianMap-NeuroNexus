/* EVA brief export: JSON (schema neuronexus.eva-brief.v1) plus the server's printable HTML page. */

import { marswalkApi } from "./marswalkApi";

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
