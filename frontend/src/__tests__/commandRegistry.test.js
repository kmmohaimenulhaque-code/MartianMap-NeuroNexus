import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import catalogue from "../features/commands.json";
import { buildRegistry, missingHandlers, searchCommands, SHORTCUTS } from "../features/registry";

const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const consoleHandlers = readFileSync(new URL("../features/consoleHandlers.js", import.meta.url), "utf8");
const handlerBlock =
  app.slice(app.indexOf("const commandHandlers = {"), app.indexOf("const commandRegistry = buildRegistry")) +
  consoleHandlers.slice(consoleHandlers.indexOf("return {"));

describe("command index coverage", () => {
  it("every catalogue command has a handler (App.jsx or features/consoleHandlers.js)", () => {
    const missing = catalogue.commands.filter((c) => !new RegExp(`(["']${c.id}["']|\\b${c.id})\\s*:`).test(handlerBlock)).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it("ids are unique and every command has a known category", () => {
    const ids = catalogue.commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(catalogue.categories.map((c) => c.id));
    expect(catalogue.commands.every((c) => categories.has(c.category))).toBe(true);
  });

  it("single-key shortcuts are unique", () => {
    const keys = catalogue.commands.filter((c) => c.shortcut?.length === 1).map((c) => c.shortcut.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(SHORTCUTS.c).toBe("compare-routes");
  });

  it("unavailable commands carry a reason, and Meet the Team links to Space Apps", () => {
    const registry = buildRegistry({ "compare-routes": { run: () => {}, available: () => "Save at least 2 routes" } });
    const compare = registry.find((c) => c.id === "compare-routes");
    expect(compare).toMatchObject({ ok: false, reason: "Save at least 2 routes" });
    expect(missingHandlers({})).toHaveLength(catalogue.commands.length);
    expect(registry.find((c) => c.id === "meet-the-team").url).toBe("https://www.spaceappschallenge.org/2026/find-a-team/neuronexus1/");
    expect(searchCommands(registry, "dust").length).toBeGreaterThan(2);
  });
});
