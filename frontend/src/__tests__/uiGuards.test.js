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
