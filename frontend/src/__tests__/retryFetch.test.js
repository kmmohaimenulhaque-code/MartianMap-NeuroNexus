import { describe, expect, it, vi } from "vitest";
import { retryDelayMs, withRetry } from "../state/retryFetch.js";

const res = (status, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });

describe("withRetry", () => {
  it("retries a GET /api read after 502/503 and returns the first success", async () => {
    vi.useFakeTimers();
    const impl = vi.fn().mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(503, { "retry-after": "1" })).mockResolvedValueOnce(res(200));
    const p = withRetry(impl)("/api/places?limit=10");
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(impl).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
  it("never retries writes or non-API URLs", async () => {
    const impl = vi.fn().mockResolvedValue(res(502));
    expect((await withRetry(impl)("/api/marswalk/plan", { method: "POST" })).status).toBe(502);
    expect((await withRetry(impl)("/assets/app.js")).status).toBe(502);
    expect(impl).toHaveBeenCalledTimes(2);
  });
  it("gives up after two retries and stops when the caller aborts", async () => {
    vi.useFakeTimers();
    const impl = vi.fn().mockResolvedValue(res(504));
    const p = withRetry(impl)("/api/terrain/window");
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(504);
    expect(impl).toHaveBeenCalledTimes(3);
    const controller = new AbortController();
    controller.abort();
    const impl2 = vi.fn().mockResolvedValue(res(502));
    expect((await withRetry(impl2)("/api/places", { signal: controller.signal })).status).toBe(502);
    expect(impl2).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it("honours Retry-After, capped at 20 s", () => {
    expect(retryDelayMs(0, "5")).toBe(5000);
    expect(retryDelayMs(0, "999")).toBe(20000);
    expect(retryDelayMs(1, null)).toBe(8000);
  });
});
