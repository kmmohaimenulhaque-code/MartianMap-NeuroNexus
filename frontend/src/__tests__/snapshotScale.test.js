import { describe, expect, it } from "vitest";
import { snapshotMarkScale } from "../utils/snapshotScale";

describe("snapshotMarkScale", () => {
  it("keeps the original mark sizes up to 900 px", () => {
    expect(snapshotMarkScale(650, 650)).toBe(1);
    expect(snapshotMarkScale(900, 600)).toBe(1);
    expect(snapshotMarkScale(undefined, null)).toBe(1);
  });
  it("grows marks with sharper, larger snapshots", () => {
    expect(snapshotMarkScale(1800, 1800)).toBe(2);
    expect(snapshotMarkScale(1621, 1200)).toBeCloseTo(1621 / 900);
  });
});
