import { describe, expect, it } from "vitest";

import { activeLayers, LAYER_BY_ID } from "../components/layers/layerCatalog";
import { layerOpacity, layerStore } from "../components/layers/layerStore";
import { routePolyline } from "../marswalk/decision";
import { buildVisualBriefHtml } from "../marswalk/visualBrief";

describe("shared layer store", () => {
  it("one toggle reaches every map that can draw the layer", () => {
    layerStore.setMany({ slope: false });
    layerStore.toggle("slope");
    const v = layerStore.get().visibility;
    expect(v.slope).toBe(true);
    for (const map of LAYER_BY_ID.slope.maps) expect(activeLayers(v, map).map((l) => l.id)).toContain("slope");
  });

  it("clamps opacity and ignores non-numbers", () => {
    layerStore.setOpacity("slope", 4);
    expect(layerOpacity("slope")).toBe(1);
    layerStore.setOpacity("slope", 0);
    expect(layerOpacity("slope")).toBe(0.05);
    layerStore.setOpacity("slope", "x");
    expect(layerOpacity("slope")).toBe(0.05);
  });
});

describe("routePolyline", () => {
  const zigzag = Array.from({ length: 2000 }, (_, i) => [137.38 + i * 1e-5, -4.82 + (i % 2) * 2e-5]);

  it("keeps the endpoints and fits the 500-vertex evaluate cap", () => {
    const line = routePolyline({ geometry: { coordinates: zigzag } });
    expect(line.length).toBeLessThanOrEqual(480);
    expect(line[0]).toEqual([-4.82, 137.38]);
    expect(line.at(-1)).toEqual([Math.round(zigzag.at(-1)[1] * 1e6) / 1e6, Math.round(zigzag.at(-1)[0] * 1e6) / 1e6]);
  });

  it("keeps every vertex of a short route and drops a straight run to its ends", () => {
    const short = [[137.38, -4.82], [137.381, -4.821], [137.382, -4.82]];
    expect(routePolyline({ geometry: { coordinates: short } })).toHaveLength(3);
    const straight = Array.from({ length: 900 }, (_, i) => [137.38 + i * 1e-5, -4.82]);
    expect(routePolyline({ geometry: { coordinates: straight } })).toHaveLength(2);
  });
});

describe("visual brief", () => {
  it("escapes text from the plan and the brief", () => {
    const html = buildVisualBriefHtml({
      brief: { values: { "<b>x</b>": { value: "<script>", unit: "m" } }, sources: [] },
      plan: { status: { value: "REVIEW REQUIRED", reasons: ["<img src=x onerror=1>"] }, geometry: { coordinates: [] }, segments: [] },
      frame: { lat: -4.82, lon: 137.38, halfWidth: 1000, res: 2 },
      siteLabel: "<Gale>",
      stops: [],
    });
    expect(html).not.toMatch(/<script>|<img src=x/);
    expect(html).toContain("&lt;Gale&gt;");
    expect(html).not.toMatch(/\bSAFE\b/);
  });
});
