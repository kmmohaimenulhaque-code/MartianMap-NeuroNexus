import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.(jsx?|json|css)$/.test(name) ? [p] : [];
  });

/* Emoji and emoji-presentation pictographs; arrows and plain geometric swatches stay allowed. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{25B6}\u{25C0}]|\u{FE0F}/u;

describe("UI guards", () => {
  it("ships zero emoji in the UI source", () => {
    const offenders = files(SRC).filter((p) => EMOJI.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("icons", () => {
  it("every command category icon is a geometric SVG icon", async () => {
    const { ICON_PATHS } = await import("../ui/iconPaths");
    const catalogue = (await import("../features/commands.json")).default;
    for (const cat of catalogue.categories) expect(ICON_PATHS[cat.icon], cat.id).toBeTruthy();
  });
});

describe("backend status probe", () => {
  const res = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k] ?? null }, json: async () => body });
  it("is ONLINE only for a real health reply", async () => {
    const { probeBackend } = await import("../utils/appHelpers");
    expect(await probeBackend(async () => res(200, { status: "ok" }))).toBe(true);
    expect(await probeBackend(async () => res(502, {}))).toBe(false);
    expect(await probeBackend(async () => res(200, null))).toBe(false);
    expect(await probeBackend(async () => { throw new TypeError("Failed to fetch"); })).toBe(false);
  });
  it("times out instead of hanging on a stalled backend", async () => {
    const { probeBackend } = await import("../utils/appHelpers");
    const stalled = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    expect(await probeBackend(stalled, 20)).toBe(false);
  });
});
