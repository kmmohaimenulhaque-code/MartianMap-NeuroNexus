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

describe("snapshotCacheKey", () => {
  it("ties cached compare snapshots to the current image quality", async () => {
    const { SNAPSHOT_CACHE_VERSION, snapshotCacheKey } = await import("../utils/savedRoutes");
    expect(snapshotCacheKey("route", "ab12")).toBe(`route:${SNAPSHOT_CACHE_VERSION}:ab12`);
    expect(snapshotCacheKey("combined", "ab12+cd34")).not.toBe("combined:ab12+cd34"); // pre-fix keys are never read
  });
});
