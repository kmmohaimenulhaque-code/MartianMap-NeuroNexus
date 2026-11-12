import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import catalogue from "../features/commands.json";
import { WheelSvg } from "../components/RadialFeatureWheel";
import { WHEEL, WHEEL_ACTION_IDS, clampCenter, createDoubleRightClickDetector, initialWheel, wheelReducer, wrapLabel } from "../components/wheel/wheelModel";

describe("Radial Feature Wheel: trigger", () => {
  it("opens on two right-clicks within 300 ms, not on one or on slow pairs", () => {
    const isDouble = createDoubleRightClickDetector(300);
    expect(isDouble(1000)).toBe(false);
    expect(isDouble(1250)).toBe(true);
    expect(isDouble(1300)).toBe(false); // a third click starts a new pair
    expect(isDouble(1700)).toBe(false); // 400 ms later: too slow
    expect(isDouble(1900)).toBe(true);
  });

  it("opens centered at the cursor, clamped to the viewport", () => {
    expect(clampCenter(10, 10, 1920, 1080)).toEqual({ x: 300, y: 300 });
    expect(clampCenter(1900, 1000, 1920, 1080)).toEqual({ x: 1620, y: 780 });
    expect(clampCenter(900, 500, 1920, 1080)).toEqual({ x: 900, y: 500 });
  });
});

describe("Radial Feature Wheel: model", () => {
  it("has eight sectors with the specified sub-features, every one a registered command", () => {
    expect(WHEEL).toHaveLength(8);
    expect(WHEEL.map((s) => s.label.join(" "))).toEqual([
      "MODE & VIEWS", "ROUTE & EVA", "TERRAIN LADDER", "LAYERS & LEGEND", "ENVIRONMENT & SOL", "VALIDATION & DATA", "EXPORT & BRIEF", "SYSTEM & PERF",
    ]);
    const ids = new Set(catalogue.commands.map((c) => c.id));
    for (const id of WHEEL_ACTION_IDS) expect(ids.has(id), id).toBe(true);
    expect(ids.has("radial-wheel")).toBe(true);
    expect(WHEEL[7].items.map((i) => i.label)).toContain("BROWSER OPTIMIZATION");
  });

  it("hover expands the sub-wheel; select dispatches the action and closes", () => {
    let s = wheelReducer(initialWheel, { type: "open", x: 400, y: 300 });
    expect(s.open).toBe(true);
    s = wheelReducer(s, { type: "hover", index: 2 });
    expect(s.active).toBe(2);
    s = wheelReducer(s, { type: "hoverSub", index: 2 });
    s = wheelReducer(s, { type: "select" });
    expect(s).toMatchObject({ open: false, lastAction: "ladder-mola" });
    expect(wheelReducer({ ...initialWheel, open: true, active: 7 }, { type: "rotate", step: 1 }).active).toBe(0);
    expect(wheelReducer({ ...initialWheel, open: true }, { type: "close" }).open).toBe(false);
  });

  it("wraps long labels without truncating them", () => {
    expect(wrapLabel("[ATMOSPHERE / DUST]", 13)).toEqual(["[ATMOSPHERE /", "DUST]"]);
    expect(wrapLabel("[BROWSER OPTIMIZATION]", 13).join(" ")).toBe("[BROWSER OPTIMIZATION]");
  });
});

describe("Radial Feature Wheel: render", () => {
  it("renders the ring and, for the active sector, the outer sub-feature arc with its actions", () => {
    const state = { ...initialWheel, open: true, active: 6, sub: 1 };
    const html = renderToStaticMarkup(createElement(WheelSvg, { state, dispatch: vi.fn(), availability: () => true, solLabel: "MY34 SOL 400" }));
    expect(html).toContain('role="menu"');
    for (const item of WHEEL[6].items) expect(html).toContain(`data-action="${item.id}"`);
    expect(html).toContain("EXPORT GEOJSON");
    expect(html.match(/nn-wheel-sector/g)).toHaveLength(8);
    expect(html).not.toContain('data-action="ladder-full"');
  });
});
