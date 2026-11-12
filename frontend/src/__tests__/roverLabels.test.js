import { describe, expect, it } from "vitest";

import {
  curiosityAtSolRecord,
  declutterLabels,
  labelBox,
  landingSiteDetail,
  landingSiteLabel,
  latestWaypoint,
  perseveranceLatestRecord,
  roverLabelRecords,
} from "../components/mars/useContextLayerData";

describe("rover position labels", () => {
  it("Curiosity is labelled at the MY34 scenario sol from its last localized waypoint", () => {
    const w = latestWaypoint([
      { sol: 1700, lat: -4.7, lon: 137.38 },
      { sol: 1712, lat: -4.71, lon: 137.37 },
      { sol: 1712, lat: -4.72, lon: -222.6 },
    ]);
    const r = curiosityAtSolRecord(w, 1712, 60);
    expect(r.label).toBe("CURIOSITY @ SOL 60");
    expect(r.lon).toBeCloseTo(137.4, 6); // east 0-360
    expect(r.detail).toMatch(/MY34 sol 60/);
    expect(r.ledgerId).toBe("MMGIS_MSL_WAYPOINTS");
  });

  it("Perseverance is labelled at its latest mission sol and never claims a MY34 position", () => {
    const r = perseveranceLatestRecord({ sol: 2009, lat: 18.4356, lon: 77.2329 }, "2026-10-22T00:27:02+00:00");
    expect(r.label).toBe("PERSEVERANCE @ SOL 2009");
    expect(r.detail).toMatch(/latest NASA MMGIS localization/);
    expect(r.detail).toMatch(/Mars Year 36/);
    expect(r.detail).toMatch(/not part of the MY34 scenario/);
    expect(r.ledgerId).toBe("MMGIS_M2020_WAYPOINTS");
    expect(perseveranceLatestRecord({ sol: null, lat: 18, lon: 77 }).label).toBe("PERSEVERANCE @ SOL n/a");
    expect(perseveranceLatestRecord(null)).toBe(null);
  });

  it("records come back in a fixed order and skip missing rovers", () => {
    expect(roverLabelRecords({ m2020: { rover: "m2020" }, msl: { rover: "msl" } }).map((r) => r.rover)).toEqual(["msl", "m2020"]);
    expect(roverLabelRecords({ msl: null })).toEqual([]);
  });
});

describe("landing-site labels", () => {
  it("uses the manifest label, then the spacecraft", () => {
    expect(landingSiteLabel({ label: "Beagle 2", spacecraft: "Beagle 2 lander" })).toBe("Beagle 2");
    expect(landingSiteLabel({ spacecraft: "Phoenix Lander" })).toBe("Phoenix Lander");
    const detail = landingSiteDetail({ mission: "ExoMars 2016", spacecraft: "Schiaparelli EDM", agency: "ESA", landing_date: "2016-10-19", region: "Meridiani Planum", site_status: "crash_site" });
    expect(detail).toMatch(/impact site of a failed landing/);
    expect(detail).not.toMatch(/safe/i);
  });
});

describe("label declutter", () => {
  it("places far-apart labels and moves or drops colliding ones", () => {
    const placement = declutterLabels(
      [
        { id: "rover", x: 100, y: 100, text: "CURIOSITY @ SOL 60", priority: 0 },
        { id: "site", x: 104, y: 100, text: "Curiosity landing", priority: 1 },
        { id: "far", x: 600, y: 300, text: "PERSEVERANCE @ SOL 2009", priority: 0 },
      ],
      { width: 900, height: 500 },
    );
    expect(placement.get("rover")).toBe("right");
    expect(placement.get("far")).toBe("right");
    expect(placement.get("site")).not.toBe("right"); // the rover label owns the right side
  });

  it("a rover label near the edge may cover a landing marker rather than disappear", () => {
    const placement = declutterLabels(
      [
        { id: "rover", x: 62, y: 264, text: "PERSEVERANCE @ SOL 2009", priority: 0 },
        { id: "site", x: 101, y: 264, text: "Perseverance landing", priority: 1 },
      ],
      { width: 290, height: 530 },
    );
    expect(placement.get("rover")).toBe("right");
    expect(placement.get("site")).toBe("top");
  });

  it("keeps labels inside the view and leaves off-screen anchors unlabelled", () => {
    const placement = declutterLabels(
      [
        { id: "edge", x: 890, y: 50, text: "Schiaparelli" },
        { id: "off", x: -40, y: 50, text: "Viking 1" },
      ],
      { width: 900, height: 500 },
    );
    expect(placement.get("edge")).toBe("left");
    expect(placement.get("off")).toBe(null);
    const box = labelBox(890, 50, 80, 22, "left", 12);
    expect(box.x1).toBeLessThanOrEqual(890);
  });
});
