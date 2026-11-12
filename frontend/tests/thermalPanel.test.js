import assert from "node:assert/strict";
import test from "node:test";

import { buildThermalPanel, formatThermalNumber } from "../src/utils/thermalPanel.js";

function summary(overrides = {}) {
  return {
    min_k: "180.25", max_k: "280.25", mean_k: "230.25",
    min_c: "-92.9", max_c: "7.1", mean_c: "-42.9",
    coverage: {
      sample_count: "8", valid_sample_count: "6", search_radius_km: "50",
      observation_years: [2005, 2007], seasonal_bins: "3", seasonal_bins_total: "12",
      seasonal_coverage_fraction: "0.25",
    },
    ...overrides,
  };
}

const nearest = {
  brightness_temperature_k: "250.25", brightness_temperature_c: "-22.9",
  spatial_distance_km: "750.5",
  evidence: { label: "STRONG", score: "0.85", observation_count: 14, years: 4 },
};

test("missing, nonnumeric and nonfinite temperatures never become zero or NaN", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, "NaN", "Infinity", "", "  ", "unknown", false, true, [], {}]) {
    assert.equal(formatThermalNumber(value, "K"), "—");
    const panel = buildThermalPanel({
      observations: [{ brightness_temperature_k: value, brightness_temperature_c: value }],
      historical_summary: summary({ min_k: value, max_k: value, mean_k: value, min_c: value, max_c: value, mean_c: value }),
    });
    assert.equal(panel.nearest.value, "—");
    assert.equal(panel.hasHistorical, false);
    assert.ok(panel.stats.every((stat) => stat.value === "—" && stat.detail === "—"));
  }
});

test("numeric strings are formatted with the supplied K and Celsius units; actual zero remains zero", () => {
  assert.equal(formatThermalNumber(" 273.15 ", "K"), "273.1 K");
  assert.equal(formatThermalNumber(0, "°C"), "0.0 °C");
  const panel = buildThermalPanel({ observations: [nearest], historical_summary: summary() });
  assert.equal(panel.hasHistorical, true);
  assert.equal(panel.nearest.value, "250.3 K");
  assert.match(panel.nearest.detail, /-22\.9 °C/);
  assert.deepEqual(panel.stats, [
    { key: "min", label: "Minimum recorded", value: "180.3 K", detail: "-92.9 °C" },
    { key: "max", label: "Maximum recorded", value: "280.3 K", detail: "7.1 °C" },
    { key: "mean", label: "Mean recorded", value: "230.3 K", detail: "-42.9 °C" },
  ]);
  assert.deepEqual(panel.coverage, {
    sampleCount: "8", validSampleCount: "6", searchRadius: "50 km", years: "2005, 2007",
    seasonalCoverage: "25.0%", seasonalBins: "3/12 Ls bins",
  });
});

test("empty radius summary preserves a distant nearest reference without using it for aggregates", () => {
  const panel = buildThermalPanel({
    observations: [nearest],
    historical_summary: summary({ coverage: { sample_count: 0, valid_sample_count: 0, search_radius_km: 50 } }),
  });
  assert.equal(panel.hasHistorical, false);
  assert.match(panel.unavailableDetail, /No usable historical temperature observations within the search radius/);
  assert.equal(panel.nearest.value, "250.3 K");
  assert.match(panel.nearest.label, /outside-radius reference/);
  assert.match(panel.nearest.detail, /not matching radius data/);
  assert.match(panel.nearest.detail, /750\.5 km away/);
  assert.ok(panel.stats.every((stat) => stat.value === "—" && stat.detail === "—"));
  assert.deepEqual(panel.conditions, []);
});

test("valid_sample_count takes precedence over total rows and suppresses unusable aggregate values", () => {
  const panel = buildThermalPanel({
    historical_summary: summary({ coverage: { sample_count: 8, valid_sample_count: 0 } }),
  });
  assert.equal(panel.hasHistorical, false);
  assert.equal(panel.coverage.sampleCount, "8");
  assert.equal(panel.coverage.validSampleCount, "0");
  assert.ok(panel.stats.every((stat) => stat.value === "—"));
});

test("older summaries without valid_sample_count still use their valid available statistics", () => {
  const panel = buildThermalPanel({ historical_summary: summary({ coverage: { sample_count: "3" } }) });
  assert.equal(panel.hasHistorical, true);
  assert.equal(panel.stats[2].value, "230.3 K");
  assert.equal(panel.coverage.validSampleCount, "—");
});

test("legacy responses show nearest values and evidence but unavailable radius aggregates", () => {
  const panel = buildThermalPanel({ observations: [nearest] });
  assert.equal(panel.nearest.value, "250.3 K");
  assert.match(panel.nearest.detail, /Legacy nearest THEMIS reference; radius aggregate unavailable/);
  assert.equal(panel.hasHistorical, false);
  assert.ok(panel.stats.every((stat) => stat.value === "—" && stat.detail === "—"));
  assert.equal(panel.coverage.sampleCount, "—");
  assert.deepEqual(panel.evidence, { label: "STRONG", score: "0.8", observationCount: "14", years: 4 });
});

test("evidence observation count and years stay independent of historical radius coverage", () => {
  const panel = buildThermalPanel({ observations: [nearest], historical_summary: summary() });
  assert.equal(panel.evidence.observationCount, "14");
  assert.equal(panel.evidence.years, 4);
  assert.equal(panel.coverage.sampleCount, "8");
  assert.equal(panel.coverage.years, "2005, 2007");
});

test("missing individual stats remain unavailable without hiding other supplied units", () => {
  const panel = buildThermalPanel({
    observations: [{ brightness_temperature_k: null, brightness_temperature_c: "0" }],
    historical_summary: summary({ min_k: null, mean_k: "not a number", mean_c: null }),
  });
  assert.equal(panel.nearest.value, "0.0 °C");
  assert.equal(panel.stats[0].value, "—");
  assert.equal(panel.stats[0].detail, "-92.9 °C");
  assert.equal(panel.stats[1].value, "280.3 K");
  assert.equal(panel.stats[2].value, "—");
  assert.equal(panel.stats[2].detail, "—");
});

test("day/night conditions expose all six supplied statistics and actual sample counts", () => {
  const panel = buildThermalPanel({ historical_summary: summary({
    day_night: {
      day: { sample_count: "2", min_k: "250", max_k: "280", mean_k: "265", min_c: "-23.15", max_c: "6.85", mean_c: "-8.15" },
      night: { sample_count: 1, min_k: 180, max_k: 180, mean_k: 180, min_c: -93.15, max_c: -93.15, mean_c: -93.15 },
    },
    condition_note: "Day and night labels are provided by the source.",
  }) });
  assert.deepEqual(panel.conditions.map((condition) => condition.label), ["Day observations (2)", "Night observations (1)"]);
  assert.deepEqual(panel.conditions[0].stats.map(({ value, detail }) => [value, detail]), [
    ["250.0 K", "-23.1 °C"], ["280.0 K", "6.8 °C"], ["265.0 K", "-8.2 °C"],
  ]);
  assert.deepEqual(panel.conditions[1].stats.map(({ value, detail }) => [value, detail]), [
    ["180.0 K", "-93.2 °C"], ["180.0 K", "-93.2 °C"], ["180.0 K", "-93.2 °C"],
  ]);
  assert.equal(panel.conditionNote, "Day and night labels are provided by the source.");
});

test("condition note is retained without day/night data, including an empty summary", () => {
  for (const historical of [summary(), { coverage: { sample_count: 0 } }]) {
    const panel = buildThermalPanel({ historical_summary: { ...historical, condition_note: "Local-time metadata is not present in this source." } });
    assert.equal(panel.conditionNote, "Local-time metadata is not present in this source.");
    assert.deepEqual(panel.conditions, []);
  }
});

test("missing or unusable conditions never imply day/night classification", () => {
  for (const dayNight of [undefined, null, {}, { day: null, night: {} }, { day: { sample_count: 0, mean_k: 250 } }, { day: { sample_count: 2, mean_k: null } }]) {
    const panel = buildThermalPanel({ historical_summary: summary({ day_night: dayNight }) });
    assert.deepEqual(panel.conditions, []);
    assert.match(panel.conditionNote, /Day\/night classification unavailable/);
    assert.match(panel.conditionNote, /differing seasons and local times/);
  }
});

test("absent response and null summaries produce unavailable states safely", () => {
  for (const response of [undefined, null, {}, { historical_summary: null, observations: [null] }]) {
    const panel = buildThermalPanel(response);
    assert.equal(panel.hasHistorical, false);
    assert.equal(panel.nearest.value, "—");
    assert.equal(panel.coverage.seasonalCoverage, "—");
    assert.deepEqual(panel.conditions, []);
    assert.match(panel.conditionNote, /Day\/night classification unavailable/);
  }
});
