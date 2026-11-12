import { describe, expect, it } from "vitest";
import { routeLabel } from "../components/mission/routeLabel.js";

describe("routeLabel", () => {
  it("names Gemini and its model", () => {
    expect(routeLabel({ provider: "gemini", model: "gemini-3.6-flash" }).text).toBe("Answered by Gemini gemini-3.6-flash");
  });
  it("names the fallback provider and shows the fallback without the raw error", () => {
    const label = routeLabel({ provider: "NVIDIA NIM", model: "nvidia/nemotron-3-ultra-550b-a55b", fallback_from: "gemini: 429 quota" });
    expect(label.text).toBe("Answered by NVIDIA NIM nvidia/nemotron-3-ultra-550b-a55b · fallback from gemini");
    expect(label.title).toBe("gemini: 429 quota");
  });
  it("is empty when the router did not answer", () => {
    expect(routeLabel({ provider: "none" })).toBeNull();
    expect(routeLabel({})).toBeNull();
  });
});
