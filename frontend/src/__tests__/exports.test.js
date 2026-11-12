import { describe, expect, it } from "vitest";

import { evaBriefBundle, planProfileCsv, planToGeoJson, provenance, thermalCsv, thermalSnapshot, validationMarkdown } from "../exports/exporters";

const NOW = new Date("2026-10-20T12:00:00Z");
const plan = {
  plan_id: "abc123",
  engine_version: "marswalk-1",
  config_hash: "cfg",
  data_versions: [{ product_id: "DTEEC_X", family: "HIRISE", ledger_id: "HIRISE_STAC_DTM" }],
  source_ids: ["HIRISE_STAC_DTM"],
  status: { value: "REVIEW REQUIRED", reasons: ["r"] },
  geometry: { type: "LineString", coordinates: [[137.1, -4.7], [137.2, -4.8]] },
  summary: { length_m: { value: 120 } },
  budget: { eva_h: 4, outbound_h: 1, return_h: 1, margin_h: 1 },
  turnaround: { lat: -4.75, lon: 137.15, distance_m: 60 },
  segments: [
    { from_m: 0, to_m: 50, class: "WITHIN PLANNING LIMITS", source: "HIRISE", ledger_id: "HIRISE_STAC_DTM" },
    { from_m: 50, to_m: 120, class: "REVIEW REQUIRED", source: "CTX", ledger_id: "CTX_STAC_DTM" },
  ],
  profile: { rows: 3, decimated_from: 3, distance_m: [0, 60, 120], elevation_m: [1, 2, 3], lat: [-4.7, -4.75, -4.8], lon: [137.1, 137.15, 137.2], class: [1, 2, 2], source: ["HIRISE", "CTX", "CTX"] },
};

describe("universal exports carry full provenance", () => {
  it("stamps plan_id, activeSol, data_versions, retrieved_at", () => {
    const p = provenance({ plan, sol: 400, seasonLs: 196.34, retrievedAt: "2026-10-20" }, NOW);
    expect(p).toMatchObject({ plan_id: "abc123", active_sol: 400, season_ls: 196.34, retrieved_at: "2026-10-20", exported_at: NOW.toISOString() });
    expect(p.data_versions[0].product_id).toBe("DTEEC_X");
  });

  it("GeoJSON: route LineString, per-segment LineStrings with attributes, turnaround point", () => {
    const gj = planToGeoJson(plan, { sol: 400 }, NOW);
    expect(gj.type).toBe("FeatureCollection");
    expect(gj.features[0].geometry.type).toBe("LineString");
    const segs = gj.features.filter((f) => f.properties.kind === "segment");
    expect(segs).toHaveLength(2);
    expect(segs[1].properties.class).toBe("REVIEW REQUIRED");
    expect(segs[1].geometry.coordinates).toEqual([[137.15, -4.75], [137.2, -4.8]]);
    expect(gj.features.at(-1).properties.kind).toBe("turnaround");
    expect(gj.provenance.active_sol).toBe(400);
  });

  it("CSV profile has a provenance header and one row per profile sample", () => {
    const csv = planProfileCsv(plan, { sol: 12 }, NOW);
    expect(csv).toContain("# plan_id=abc123");
    expect(csv).toContain("# active_sol=12");
    const body = csv.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(body[0].startsWith("distance_m,elevation_m")).toBe(true);
    expect(body).toHaveLength(4);
  });

  it("EVA brief bundle embeds the server brief, conditions at the sol and the plan", () => {
    const b = evaBriefBundle({ schema: "neuronexus.eva-brief.v1" }, plan, { season: { sol: 400 }, solar: { dust_class: "EXCEED" } }, { sol: 400 }, NOW);
    expect(b.schema).toBe("neuronexus.eva-brief.v4");
    expect(b.conditions_at_active_sol.solar.dust_class).toBe("EXCEED");
    expect(b.provenance.plan_id).toBe("abc123");
  });

  it("validation Markdown and thermal snapshot CSV", () => {
    const md = validationMarkdown({ run_id: "r1", generated_at: "g", sites: { gale: { headline: [{ id: "V3", label: "L", value: "0.99×", ci95: [0.9, 1.1], n: 5, meaning: "m" }], figures: ["validation/reports/gale/r1/figures/a.png"] } } }, NOW);
    expect(md).toContain("| V3 | L | 0.99× | 0.9–1.1 | 5 | m |");
    expect(md).toContain("![gale figure]");
    const snap = thermalSnapshot({ heatmap: { mean_k: [[200, null]], counts: [[2, 0]], row_bin_h: 6, col_bin_deg: 180 }, count: 2 }, { latitude_deg: 1, longitude_deg: 2 }, { sol: 3 }, { sol: 3 }, NOW);
    const csv = thermalCsv(snap);
    expect(csv).toContain("# active_sol=3");
    expect(csv).toContain("0,6,0,180,200,2");
  });
});
