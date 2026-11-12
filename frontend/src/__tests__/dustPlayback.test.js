import { describe, expect, it } from "vitest";
import { SCENARIO_SOLS, nextPlaybackSol } from "../state/dustFrames.js";

describe("nextPlaybackSol", () => {
  it("never steps past the last scenario sol", () => {
    for (let s = 1; s <= SCENARIO_SOLS; s += 1) {
      const n = nextPlaybackSol(s);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(SCENARIO_SOLS);
    }
  });
  it("wraps odd and even runs back to sol 1", () => {
    expect(nextPlaybackSol(667)).toBe(1); // used to give 669 (HTTP 400)
    expect(nextPlaybackSol(668)).toBe(1);
    expect(nextPlaybackSol(666)).toBe(668);
    expect(nextPlaybackSol(1)).toBe(3);
  });
});
