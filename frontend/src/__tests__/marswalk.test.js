import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_VISIBILITY, LAYER_CATEGORIES, LEGEND, activeLayers } from "../components/layers/layerCatalog";
import { DEMOS, GUIDES, QUICK_STARTS } from "../components/manualContent";
import { buildIndex, resolveIn } from "../sources/ledgerStore";
import { validateBrief } from "../marswalk/evaBrief";
import { lttb, rdp, sampleGrid, toLatLon, toLocal } from "../marswalk/marswalkMath";
import { CLASS_TOKENS, RAMP_TOKENS, luminance, rampColor } from "../marswalk/walkabilityRamp";

const css = readFileSync(new URL("../ui/tokens.css", import.meta.url), "utf8");
const token = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
const ledger = JSON.parse(readFileSync(new URL("../../../data/manifests/source_ledger.json", import.meta.url), "utf8"));
const index = buildIndex(ledger.entries);

describe("walkability ramp", () => {
  it("runs ice-cyan -> gold -> coral-red with falling luminance (reads in grayscale)", () => {
    const stops = RAMP_TOKENS.map(token);
    expect(stops.every(Boolean)).toBe(true);
    const hi = luminance(rampColor(100, stops));
    const mid = luminance(rampColor(50, stops));
    const lo = luminance(rampColor(0, stops));
    expect(hi - mid).toBeGreaterThan(0.15);
    expect(mid - lo).toBeGreaterThan(0.15);
  });

  it("every class color is a token", () => {
    for (const t of Object.values(CLASS_TOKENS)) expect(css).toContain(`${t}:`);
  });
});

describe("local metric frame", () => {
  it("round-trips lat/lon", () => {
    const frame = { lat: 18.4, lon: 77.4 };
    const [x, y] = toLocal(18.41, 77.38, frame);
    const [lat, lon] = toLatLon(x, y, frame);
    expect(lat).toBeCloseTo(18.41, 9);
    expect(lon).toBeCloseTo(77.38, 9);
  });

  it("samples display grids bilinearly, by nearest for classes, and never fills nodata", () => {
    const grid = { values: new Float32Array([0, 10, 20, 30]), rows: 2, cols: 2, x0: -5, y0: 5, step: 10 };
    expect(sampleGrid(grid, 0, 0)).toBeCloseTo(15);
    expect(sampleGrid(grid, 5, 5, true)).toBe(10);
    expect(Number.isNaN(sampleGrid(grid, 100, 0))).toBe(true);
    const gap = { ...grid, values: new Float32Array([0, NaN, 20, 30]) };
    expect(Number.isNaN(sampleGrid(gap, 0, 0))).toBe(true);
  });

  it("decimates for display only and keeps endpoints", () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const ys = xs.map((x) => Math.sin(x / 30));
    const idx = lttb(xs, ys, 100);
    expect(idx).toHaveLength(100);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(999);
    expect(rdp([[0, 0], [1, 0.01], [2, 0], [2, 1], [2, 2]], 0.1)).toEqual([0, 2, 4]);
  });
});

describe("EVA brief", () => {
  it("requires schema, units, evidence and ledger ids on every value", () => {
    const brief = { schema: "neuronexus.eva-brief.v1", values: { length: { value: 1, unit: "m", evidence: "COMPUTED", ledger_id: "NEURONEXUS_MARSWALK_PLANNER" } }, sources: [{ ledger_id: "X" }] };
    expect(validateBrief(brief)).toEqual([]);
    expect(validateBrief({ ...brief, values: { length: { value: 1 } } })).toEqual(["length: ledger_id", "length: unit", "length: evidence"]);
  });
});

describe("categorized layers and legend", () => {
  it("has the four categories and a legend entry for every map layer", () => {
    expect(LAYER_CATEGORIES.map((c) => c.label)).toEqual(["Topography and Elevation", "Geology and Science Context", "Atmosphere and Environment", "Missions and Ground Truth"]);
    for (const c of LAYER_CATEGORIES) {
      for (const layer of c.layers) {
        expect(resolveIn(index, layer.ledgerId)).not.toBeNull();
        if (layer.kind === "map") expect(LEGEND[layer.id]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("the legend lists active layers only", () => {
    const active = activeLayers({ ...DEFAULT_VISIBILITY, dust: true, mola: false });
    expect(active.map((l) => l.id)).toContain("dust");
    expect(active.map((l) => l.id)).not.toContain("mola");
    for (const items of Object.values(LEGEND)) for (const item of items) if (item.token) expect(css).toContain(`${item.token}:`);
  });
});

describe("Mission Operations Manual", () => {
  it("every quick start launches a defined demo with a target", () => {
    for (const q of QUICK_STARTS) {
      expect(DEMOS[q.demo]).toBeTruthy();
      expect(DEMOS[q.demo].targets.length).toBeGreaterThan(0);
    }
    expect(GUIDES.map((g) => g.id)).toEqual(["ladder", "eva", "limits", "layers", "tags"]);
    expect(JSON.stringify(GUIDES)).not.toMatch(/\b(is|are|looks) safe\b|\bsafe (route|path|to)\b/i);
  });
});
