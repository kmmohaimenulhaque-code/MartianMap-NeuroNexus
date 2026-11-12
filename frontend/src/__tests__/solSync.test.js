import { describe, expect, it } from "vitest";

import { lsAt, lsBin, missionSolAt, my34SolToUtc, seasonName } from "../state/solMath";

describe("activeSol helpers", () => {
  it("reads Ls from the MGCM table and clamps the sol", () => {
    const table = [0, 0.77, 1.29];
    expect(lsAt(table, 2)).toBe(0.77);
    expect(lsAt(table, 99)).toBe(1.29);
    expect(lsAt(null, 2)).toBe(null);
  });

  it("bins seasons for the THEMIS heatmap columns", () => {
    expect(lsBin(196.3, 15)).toBe(13);
    expect(lsBin(-10, 90)).toBe(3);
    expect(seasonName(196)).toBe("northern autumn");
  });

  it("places the rovers in time: Curiosity in MY34, Perseverance not yet landed", () => {
    expect(my34SolToUtc(1).toISOString().slice(0, 10)).toBe("2017-03-23");
    const msl = missionSolAt("msl", 1);
    expect(msl).toBeGreaterThan(1640);
    expect(msl).toBeLessThan(1650);
    expect(missionSolAt("msl", 401) - msl).toBe(400);
    expect(missionSolAt("m2020", 668)).toBe(null);
  });
});

describe("solar geometry parity with science/conditions/solar.py", () => {
  it("matches the backend values for Gale at MY34 sol 100 and 400", async () => {
    const { solarGeometry } = await import("../state/solMath");
    const clear = solarGeometry(-4.72, 47.97, 0.3);
    expect(clear.declinationDeg).toBeCloseTo(18.43, 2);
    expect(clear.noonElevationDeg).toBeCloseTo(66.85, 2);
    expect(clear.daylightH).toBeCloseTo(11.79, 2);
    expect(clear.dustClass).toBe("WITHIN");
    const storm = solarGeometry(-4.72, 196.34, 4.6181);
    expect(storm.noonElevationDeg).toBeCloseTo(87.84, 2);
    expect(storm.directBeam).toBeCloseTo(0.01, 2);
    expect(storm.dustClass).toBe("EXCEED");
  });
});

describe("THEMIS heatmap follows the active sol", () => {
  it("reads the Ls column the slider points at (count-weighted, nothing interpolated)", async () => {
    const { columnStats } = await import("../state/thermalStats");
    const { lsBin } = await import("../state/solMath");
    const heatmap = { mean_k: [[200, null], [220, 240]], counts: [[1, 0], [3, 2]] };
    expect(columnStats(heatmap, lsBin(10, 180)).meanK).toBeCloseTo(215, 6);
    expect(columnStats(heatmap, lsBin(196, 180))).toEqual({ meanK: 240, n: 2, cells: 1 });
    expect(columnStats({ mean_k: [[null]], counts: [[0]] }, 0)).toEqual({ meanK: null, n: 0, cells: 0 });
  });
});

describe("MARSWALK decision at the active sol", () => {
  it("takes the worse of the route status and the dust class", async () => {
    const { statusAtSol } = await import("../marswalk/decision");
    expect(statusAtSol("WITHIN PLANNING LIMITS", "EXCEED")).toBe("EXCEEDS PLANNING LIMIT");
    expect(statusAtSol("REVIEW REQUIRED", "WITHIN")).toBe("REVIEW REQUIRED");
    expect(statusAtSol("WITHIN PLANNING LIMITS", undefined)).toBe("WITHIN PLANNING LIMITS");
  });
});
