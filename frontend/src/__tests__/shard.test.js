import { describe, expect, it } from "vitest";
import { pickShard } from "../shard.js";

describe("pickShard", () => {
  it("keeps a valid shard from the cookie", () => {
    expect(pickShard("a=1; nn_shard=4; b=2", 6)).toEqual({ shard: 4, fresh: false });
    expect(pickShard("nn_shard=6", 6)).toEqual({ shard: 6, fresh: false });
  });
  it("replaces a missing or out-of-range shard", () => {
    expect(pickShard("", 6, () => 0)).toEqual({ shard: 1, fresh: true });
    expect(pickShard("nn_shard=9", 6, () => 0.5)).toEqual({ shard: 4, fresh: true });
    expect(pickShard("nn_shard=0", 6, () => 0.999999)).toEqual({ shard: 6, fresh: true });
    expect(pickShard("xnn_shard=3", 6, () => 0)).toEqual({ shard: 1, fresh: true });
  });
  it("stays in range for any random value", () => {
    for (const r of [0, 0.1, 0.5, 0.9, 0.9999999, 1]) {
      const { shard } = pickShard(undefined, 6, () => r);
      expect(shard).toBeGreaterThanOrEqual(1);
      expect(shard).toBeLessThanOrEqual(6);
    }
  });
});
