import { describe, expect, it } from "vitest";
import { modelBadge, safeHttpUrl } from "../components/mission/intelligenceUi.js";

const answer = (extra = {}) => ({ role: "assistant", content: "x", model: "gemini-3.8-flash", fallback: [], ...extra });

describe("modelBadge", () => {
  it("shows the model resolved by the server before any answer", () => {
    expect(modelBadge([], { configured: true, model: "gemini-3.6-flash" }).text).toBe("MODEL: AUTO (gemini-3.6-flash)");
  });

  it("shows the live model that answered last", () => {
    const badge = modelBadge([answer({ model: "gemini-3.6-flash" }), answer()], { model: "other" });
    expect(badge.text).toBe("MODEL: AUTO (gemini-3.8-flash)");
    expect(badge.fallback).toBe(false);
  });

  it("flags a fallback and names what failed", () => {
    const badge = modelBadge([answer({ fallback: [{ model: "gemini-3.8-flash", reason: "429 quota/rate limit" }] })], null);
    expect(badge.fallback).toBe(true);
    expect(badge.title).toContain("gemini-3.8-flash (429 quota/rate limit)");
  });

  it("ignores error messages and reports an unconfigured server", () => {
    expect(modelBadge([{ role: "assistant", error: true, content: "x" }], { configured: false }).text).toBe("MODEL: AUTO (NOT CONFIGURED)");
    expect(modelBadge([], null).text).toBe("MODEL: AUTO (RESOLVING)");
  });
});

describe("safeHttpUrl", () => {
  it("allows only http and https links", () => {
    expect(safeHttpUrl("https://en.wikipedia.org/wiki/Mars")).toBe("https://en.wikipedia.org/wiki/Mars");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});
