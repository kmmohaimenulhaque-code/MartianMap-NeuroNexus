import { describe, expect, it } from "vitest";
import { routeLabel } from "../components/mission/routeLabel.js";

describe("routeLabel", () => {
  it("names the fine-tuned model and the routing reason", () => {
    expect(routeLabel({ provider: "qwen", route_reason: "explain from mission data: terrain" }).text)
      .toBe("Answered by NeuroNexus Qwen (fine-tuned) · reason: explain from mission data: terrain");
  });
  it("shows a fallback without the raw error", () => {
    const label = routeLabel({ provider: "gemini", model: "gemini-3.6-flash", route_reason: "explain", fallback_from: "qwen: guard:banned_safety_term" });
    expect(label.text).toBe("Answered by Gemini gemini-3.6-flash · reason: explain · fallback from qwen");
    expect(label.title).toBe("qwen: guard:banned_safety_term");
  });
  it("is empty when the router did not answer", () => {
    expect(routeLabel({ provider: "none" })).toBeNull();
    expect(routeLabel({})).toBeNull();
  });
});
