/* Export actions shared by MARSWALK, the validation panel, the Command Index and the Radial Feature Wheel. */

import { validateBrief } from "../marswalk/evaBrief";
import { marswalkApi } from "../marswalk/marswalkApi";
import { planStore } from "../marswalk/planStore";
import { downloadText, evaBriefBundle, planProfileCsv, planToGeoJson, validationJson, validationMarkdown } from "./exporters";

const NO_PLAN = "Plan a Marswalk first (MARSWALK mode → PLAN); exports need a plan_id.";

function current() {
  const { plan, conditions } = planStore.get();
  if (!plan?.plan_id) throw new Error(NO_PLAN);
  return { plan, conditions };
}

export async function exportEvaBrief(sol) {
  const { plan, conditions } = current();
  const brief = await marswalkApi.brief(plan.plan_id);
  const problems = validateBrief(brief);
  if (problems.length) throw new Error(`EVA brief failed its schema check: ${problems.join(", ")}`);
  const bundle = evaBriefBundle(brief, plan, conditions, { sol: sol?.sol, seasonLs: sol?.seasonLs });
  downloadText(`neuronexus_eva_brief_${plan.plan_id}_sol${sol?.sol ?? "na"}.json`, JSON.stringify(bundle, null, 2));
  return `EVA brief ${plan.plan_id} exported (JSON v4, sol ${sol?.sol ?? "n/a"}).`;
}

export function exportGeoJson(sol) {
  const { plan } = current();
  const gj = planToGeoJson(plan, { sol: sol?.sol, seasonLs: sol?.seasonLs });
  downloadText(`neuronexus_route_${plan.plan_id}.geojson`, JSON.stringify(gj, null, 2), "application/geo+json");
  return `Route ${plan.plan_id} exported as GeoJSON (${gj.features.length} features).`;
}

export function exportProfileCsv(sol) {
  const { plan } = current();
  downloadText(`neuronexus_profile_${plan.plan_id}.csv`, planProfileCsv(plan, { sol: sol?.sol, seasonLs: sol?.seasonLs }), "text/csv;charset=utf-8");
  return `Profile of ${plan.plan_id} exported as CSV (${plan.profile?.rows ?? 0} rows).`;
}

export async function exportValidation(site = null) {
  const r = await fetch("/api/validation/latest");
  if (!r.ok) throw new Error(`validation report unavailable (HTTP ${r.status})`);
  const latest = await r.json();
  const scoped = site ? { ...latest, sites: { [site]: latest.sites?.[site] } } : latest;
  const tag = site ?? "all";
  downloadText(`neuronexus_validation_${tag}_${latest.run_id}.json`, JSON.stringify(validationJson(scoped), null, 2));
  downloadText(`neuronexus_validation_${tag}_${latest.run_id}.md`, validationMarkdown(scoped), "text/markdown;charset=utf-8");
  for (const [s, entry] of Object.entries(scoped.sites ?? {})) {
    for (const f of entry?.figures ?? []) {
      const a = document.createElement("a");
      a.href = `/api/${f.replace(/^validation\/reports\//, "validation/figure/")}`;
      a.download = `neuronexus_validation_${s}_${f.split("/").pop()}`;
      a.click();
    }
  }
  return `Validation ${latest.run_id} exported (JSON, Markdown and chart PNGs).`;
}
