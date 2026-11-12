import { describe, expect, it } from "vitest";
import { snapshotMetrics } from "../utils/savedRoutes";

describe("snapshotMetrics", () => {
  it("uses the along-track evaluation when present", () => {
    const route = { evaluation: { status: "ok", distanceKm: 30.6, evaHours: 14.5, terrainBurden: 48.9, terrainRisk: 100 } };
    expect(snapshotMetrics(route)).toMatchObject({ distance_km: 30.6, estimated_eva_hours: 14.5, terrain_burden_score: 48.9, terrain_risk_proxy: 100 });
  });

  it("falls back to the metrics saved from Route Design, and leaves missing values null", () => {
    const route = { generation: { metrics_at_save: { distance_km: 34.4, estimated_eva_hours: 14.6, science_evidence_count: 17 } } };
    expect(snapshotMetrics(route)).toEqual({ distance_km: 34.4, estimated_eva_hours: 14.6, terrain_burden_score: null, terrain_risk_proxy: null, science_evidence_count: 17 });
    expect(snapshotMetrics({}).distance_km).toBeNull();
  });
});
