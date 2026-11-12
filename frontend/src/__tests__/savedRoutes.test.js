import { describe, expect, it } from "vitest";

import { COMPARISON_METRICS, evaluationFromResponse, geometryHash, loadSavedRoutes, rankMetric, routeStats, upgradeRoute } from "../utils/savedRoutes";

const points = [
  { latitude_deg: -5.4, longitude_deg: 137.8 },
  { latitude_deg: -5.2, longitude_deg: 137.9 },
];

function memoryStorage(entries) {
  return { getItem: (key) => entries[key] ?? null };
}

describe("saved route schema v3", () => {
  it("migrates v2 records and keeps their data", () => {
    const storage = memoryStorage({ "neuronexus.savedRoutes.v2": JSON.stringify([{ id: "r1", name: "A", points }]) });
    const [route] = loadSavedRoutes(storage);
    expect(route).toMatchObject({ id: "r1", name: "A", schema: 3, colourIndex: 0, evaluation: { status: "pending" } });
    expect(route.geometryHash).toBe(geometryHash(points));
  });

  it("re-queues an evaluation interrupted by a reload", () => {
    expect(upgradeRoute({ id: "r", points, evaluation: { status: "running" } }, 0).evaluation.status).toBe("pending");
  });

  it("hash depends on geometry only", () => {
    expect(geometryHash(points)).toBe(geometryHash(points.map((p) => ({ ...p, label: "x" }))));
    expect(geometryHash(points)).not.toBe(geometryHash([...points].reverse()));
  });
});

describe("statistics", () => {
  const response = {
    status: "ok",
    metrics: {
      distance_km: 12, elevation_min_m: -4500, mean_elevation_m: -4400, elevation_max_m: -4100, min_slope_deg: 0.2,
      mean_slope_deg: 3, max_slope_deg: 18, min_roughness_m: 1, mean_roughness_m: 10, max_roughness_m: 60, profile: [[0, -4500, 1]],
    },
  };

  it("maps the along-track evaluation onto MIN/MEAN/MAX triplets", () => {
    const evaluation = evaluationFromResponse(response);
    expect(evaluation.elevation_m).toMatchObject({ min: -4500, mean: -4400, max: -4100 });
    expect(evaluation.slope_deg).toMatchObject({ min: 0.2, mean: 3, max: 18 });
    expect(evaluation.roughness_m).toEqual({ min: 1, mean: 10, max: 60 });
  });

  it("falls back to labelled waypoint-only statistics", () => {
    const route = { plan: { waypoint_analysis: [{ status: "available", slope_deg: 2, roughness_m: 5, elevation_m: 10 }, { status: "available", slope_deg: 4, roughness_m: 7, elevation_m: 20 }] } };
    const stats = routeStats(route);
    expect(stats.status).toBe("waypoints-only");
    expect(stats.slope_deg).toEqual({ min: 2, mean: 3, max: 4 });
  });

  it("marks best and worst by each metric's direction", () => {
    const byKey = Object.fromEntries(COMPARISON_METRICS.map((m) => [m.key, m]));
    const a = { slope_deg: { max: 10 }, dataSupportPct: 90, elevation_m: { mean: 1 } };
    const b = { slope_deg: { max: 20 }, dataSupportPct: 99, elevation_m: { mean: 2 } };
    expect(rankMetric(byKey.slope_max, [a, b])).toEqual({ best: 0, worst: 1 });
    expect(rankMetric(byKey.support, [a, b])).toEqual({ best: 1, worst: 0 });
    expect(rankMetric(byKey.elev_mean, [a, b])).toEqual({ best: null, worst: null });
  });
});
