import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildIndex, filterEntries, isToggleKey, ledgerToCsv, resolveIn, seedLedger, tagText } from "../sources/ledgerStore";
import SourceTag from "../sources/SourceTag";

const ledger = JSON.parse(readFileSync(new URL("../../../data/manifests/source_ledger.json", import.meta.url), "utf8"));
const index = buildIndex(ledger.entries);
const SRC = new URL("../", import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : walk(path);
    return /\.(jsx?|ts)$/.test(name) ? [path] : [];
  });
}

describe("canonical ledger resolution", () => {
  it("resolves ids and aliases case-insensitively", () => {
    expect(resolveIn(index, "MOLA").id).toBe("MOLA_MEGDR");
    expect(resolveIn(index, "nasa_themis").id).toBe("THEMIS");
    expect(resolveIn(index, "NOT_A_SOURCE")).toBeNull();
  });

  it("every ledger id used in frontend/src resolves (unknown ids fail CI)", () => {
    const pattern = /(?:ledgerId|ledger_id)\s*[:=]\s*\{?\s*["']([A-Za-z0-9_]+)["']/g;
    const used = new Map();
    for (const file of walk(SRC)) {
      for (const match of readFileSync(file, "utf8").matchAll(pattern)) used.set(match[1], file.replace(SRC, ""));
    }
    const missing = [...used].filter(([id]) => !resolveIn(index, id));
    expect(used.size).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it("every App panel declares the sources it shows", () => {
    const app = readFileSync(join(SRC, "App.jsx"), "utf8");
    const panels = [...app.matchAll(/<Panel\s[^>]*>/g)].map((m) => m[0]);
    expect(panels.length).toBeGreaterThan(8);
    const ids = panels.flatMap((p) => [...(p.match(/sources=\{\[([^\]]*)\]\}/)?.[1] ?? "").matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]));
    expect(panels.filter((p) => !/sources=\{\[/.test(p))).toEqual([]);
    expect(ids.filter((id) => !resolveIn(index, id))).toEqual([]);
  });
});

describe("SourceTag", () => {
  it("writes the evidence class as visible text", () => {
    const entry = resolveIn(index, "HIRISE_STAC_DTM");
    expect(tagText({ entry, ledgerId: "HIRISE_STAC_DTM", detail: "DTEEC_024234 · 1.01 m" })).toBe("OBSERVED · MRO HiRISE · DTEEC_024234 · 1.01 m");
    expect(tagText({ entry, ledgerId: "HIRISE_STAC_DTM", compact: true })).toBe("MRO HiRISE");
  });

  it("marks unknown ids as UNREGISTERED once the ledger is loaded", () => {
    expect(tagText({ entry: null, ledgerId: "NOPE", status: "ready" })).toBe("UNREGISTERED SOURCE · NOPE");
    expect(tagText({ entry: null, ledgerId: "NOPE", status: "loading", evidence: "DERIVED" })).toBe("DERIVED · NOPE");
  });

  it("opens from the keyboard with Enter or Space", () => {
    expect(isToggleKey({ key: "Enter" })).toBe(true);
    expect(isToggleKey({ key: " " })).toBe(true);
    expect(isToggleKey({ key: "Tab" })).toBe(false);
  });

  it("renders a visible, focusable chip (not a hover tooltip)", () => {
    seedLedger(ledger.entries);
    const html = renderToStaticMarkup(createElement(SourceTag, { ledgerId: "THEMIS", evidence: "OBSERVED", detail: "HISTORICAL" }));
    expect(html).toContain("<button");
    expect(html).toContain("OBSERVED · THEMIS · HISTORICAL");
    expect(html).toContain('aria-haspopup="dialog"');
    const bad = renderToStaticMarkup(createElement(SourceTag, { ledgerId: "NOT_IN_LEDGER" }));
    expect(bad).toContain("UNREGISTERED SOURCE");
    expect(bad).toContain("nn-tag--unregistered");
  });

  it("filters and exports the ledger", () => {
    expect(filterEntries(ledger.entries, { cls: "MODELED" }).every((e) => e.evidence_class === "MODELED")).toBe(true);
    expect(filterEntries(ledger.entries, { q: "hirise" }).length).toBeGreaterThan(1);
    const csv = ledgerToCsv(ledger.entries.slice(0, 2));
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv.split("\n")[0]).toContain("evidence_class");
  });
});
