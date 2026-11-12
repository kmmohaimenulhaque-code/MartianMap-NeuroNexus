import { describe, expect, it } from "vitest";
import { seasonStatuses } from "../marswalk/decision";
import { decodePlanLink, encodePlanLink } from "../marswalk/planLink";
import { mobileUi } from "../components/mobile/mobileStore";

describe("season status ribbon", () => {
  it("takes the worse of route status and dust class at each sol", () => {
    const r = seasonStatuses("WITHIN PLANNING LIMITS", [0.1, 0.3, 0.7, 2.0, 0.4, 0.45, 0.1]);
    expect(r.statuses).toEqual([
      "WITHIN PLANNING LIMITS",
      "WITHIN PLANNING LIMITS",
      "REVIEW REQUIRED",
      "EXCEEDS PLANNING LIMIT",
      "WITHIN PLANNING LIMITS",
      "WITHIN PLANNING LIMITS",
      "WITHIN PLANNING LIMITS",
    ]);
    expect(r.counts).toEqual({ "WITHIN PLANNING LIMITS": 5, "REVIEW REQUIRED": 1, "EXCEEDS PLANNING LIMIT": 1 });
    expect(r.longestWithin).toEqual({ start: 5, end: 7 });
  });

  it("never improves a route that already needs review, and skips missing tau", () => {
    const r = seasonStatuses("REVIEW REQUIRED", [0.1, null, 3]);
    expect(r.statuses).toEqual(["REVIEW REQUIRED", null, "EXCEEDS PLANNING LIMIT"]);
    expect(r.longestWithin).toBeNull();
  });
});

describe("shareable plan link", () => {
  const state = { site: "gale", targets: [{ lat: -4.8246651, lon: 137.3672973 }], evaHours: 8, mode: "ctx_mola", overrides: { slope_limit_deg: 25 }, sol: 411, planId: "pl_abc123" };

  it("round-trips the plan request", () => {
    const decoded = decodePlanLink(encodePlanLink(state));
    expect(decoded).toMatchObject({ site: "gale", evaHours: 8, mode: "ctx_mola", overrides: { slope_limit_deg: 25 }, sol: 411, sharedPlanId: "pl_abc123" });
    expect(decoded.targets).toEqual([{ lat: -4.824665, lon: 137.367297 }]);
  });

  it("rejects malformed or out-of-range links instead of guessing", () => {
    expect(decodePlanLink("#mw=not-base64!")).toBeNull();
    expect(decodePlanLink("#other")).toBeNull();
    expect(decodePlanLink(encodePlanLink({ ...state, evaHours: 6 }))).toBeNull();
    expect(decodePlanLink(encodePlanLink({ ...state, site: "olympus" }))).toBeNull();
    expect(decodePlanLink(encodePlanLink({ ...state, targets: [] }))).toBeNull();
    const extra = decodePlanLink(encodePlanLink({ ...state, overrides: { slope_limit_deg: 25, evil: 1 } }));
    expect(extra.overrides).toEqual({ slope_limit_deg: 25 });
  });
});

describe("mobile sheet store", () => {
  it("toggles one sheet at a time and validates names", () => {
    mobileUi.setSheet("intel");
    expect(mobileUi.get().sheet).toBe("intel");
    mobileUi.toggleSheet("mission");
    expect(mobileUi.get().sheet).toBe("mission");
    mobileUi.toggleSheet("mission");
    expect(mobileUi.get().sheet).toBeNull();
    mobileUi.setSheet("bogus");
    expect(mobileUi.get().sheet).toBeNull();
    mobileUi.setMapView("split");
    mobileUi.setMapView("nope");
    expect(mobileUi.get().mapView).toBe("split");
  });
});
