import assert from "node:assert/strict";
import test from "node:test";

import { CSV_COLUMNS, csvField, exportFilename, flattenMission, missionToCsv, routeToCsv, unitFor } from "../src/utils/missionExport.js";
import { buildMissionFixture } from "./missionFixture.js";

const mission = buildMissionFixture();
const rows = flattenMission(mission);
const csv = missionToCsv(mission);

function findValue(field, predicate = () => true) {
  const row = rows.find((r) => r.field === field && predicate(r));
  return row ? row.value : undefined;
}

/* ------------------------------------------------------------ escaping */

test("csv escaping: quotes, commas, newlines, nulls, arrays, unicode", () => {
  assert.equal(csvField('He said "go"'), '"He said ""go"""');
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField("line1\nline2"), '"line1\nline2"');
  assert.equal(csvField("line1\r\nline2"), '"line1\r\nline2"');
  assert.equal(csvField(null), "");
  assert.equal(csvField(undefined), "");
  assert.equal(csvField(["a", "b"]), "a; b");
  assert.equal(csvField(["a,1", "b"]), '"a,1; b"');
  assert.equal(csvField(0), "0");
  assert.equal(csvField(false), "FALSE");
  assert.equal(csvField(NaN), "UNAVAILABLE");
  assert.equal(csvField("CO₂ 95.1 % — µGy"), "CO₂ 95.1 % — µGy");
  assert.equal(csvField({ a: 1 }), '"{""a"":1}"');
});

test("csv has a UTF-8 BOM and CRLF line endings for spreadsheet compatibility", () => {
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("\r\n"));
  assert.equal(csv.slice(1).split("\r\n")[0], CSV_COLUMNS.join(","));
});

test("every CSV row has exactly the declared number of columns", () => {
  // naive split is unsafe; parse with a minimal RFC 4180 reader
  const parse = (text) => {
    const out = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
        else if (c === '"') { quoted = false; }
        else { field += c; }
      } else if (c === '"') { quoted = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r" && text[i + 1] === "\n") { row.push(field); out.push(row); row = []; field = ""; i += 1; }
      else { field += c; }
    }
    row.push(field);
    out.push(row);
    return out;
  };
  const parsed = parse(csv.slice(1));
  assert.ok(parsed.length > 100);
  for (const line of parsed) {
    assert.equal(line.length, CSV_COLUMNS.length);
  }
  assert.deepEqual(parsed[0], CSV_COLUMNS);
});

/* ------------------------------------------------- completeness (the bug) */

test("export is NOT limited to route waypoint analysis", () => {
  const types = new Set(rows.map((r) => r.record_type));
  for (const expected of ["SELECTION", "ENVIRONMENT", "ROUTE", "ROUTE_CANDIDATES", "ORBITAL_TRACKING", "MISSION_CONSOLE", "PROVENANCE", "SAFE_HAVENS", "CUSTOM_PLACES", "MEDIA"]) {
    assert.ok([...types].some((t) => t.startsWith(expected)), `missing record type ${expected}`);
  }
});

test("EVERY thermal observation is exported, not only the nearest", () => {
  const thermalRows = rows.filter((r) => r.record_type.includes("observations"));
  const ids = new Set(thermalRows.map((r) => r.record_id));
  assert.ok(ids.has("i99827002pbt"));
  assert.ok(ids.has("i12345002pbt"), "the second THEMIS observation must not be dropped");
  for (const field of ["brightness_temperature_k", "brightness_temperature_c", "latitude_deg", "longitude_deg", "spatial_distance_km", "observation_start", "solar_longitude_deg", "local_solar_time_hours", "resolution_m", "status", "product_id"]) {
    assert.ok(thermalRows.some((r) => r.field === field), `thermal field ${field} missing`);
  }
  assert.ok(thermalRows.some((r) => r.field === "evidence.score" && r.value === 18.5), "nested evidence object must be flattened");
});

test("atmospheric gases, percentages, status and provenance are exported", () => {
  const gasRows = rows.filter((r) => r.record_type.includes("gases"));
  const names = gasRows.filter((r) => r.field === "name").map((r) => r.value);
  assert.deepEqual(names, ["CO₂", "N₂", "Ar"]);
  assert.ok(gasRows.some((r) => r.field === "volume_percent" && r.value === 95.1));
  assert.ok(gasRows.every((r) => r.status === "NASA REFERENCE"));
});

test("site science, soil, minerals, water, bioavailability and vegetation are exported", () => {
  for (const field of ["site_science.soil.value", "site_science.minerals.value", "site_science.water.value", "site_science.bioavailability.value", "site_science.vegetation.value", "site_science.notes"]) {
    assert.ok(rows.some((r) => r.field === field), `${field} missing`);
  }
  assert.equal(findValue("site_science.minerals.value"), "NOT INGESTED");
});

test("rover media metadata and URLs are exported (no binary images)", () => {
  const mediaRows = rows.filter((r) => r.record_type.startsWith("MEDIA"));
  assert.ok(mediaRows.some((r) => r.field === "title" && r.value === "Curiosity's view"));
  assert.ok(mediaRows.some((r) => r.field === "nasa_url"));
  assert.ok(mediaRows.some((r) => r.field === "camera" && r.value === "MASTCAM"));
});

test("dust, solar and terrain environment scalars are exported", () => {
  assert.equal(findValue("dust.opacity"), 0.312);
  assert.equal(findValue("dust.height_km"), 11.4);
  assert.equal(findValue("solar.areocentric_longitude_deg"), 275.52);
  assert.equal(findValue("terrain.elevation_m"), -4503);
  assert.equal(findValue("terrain.roughness_m"), 7.4);
});

test("route geometry, all waypoint metrics and warnings are exported", () => {
  const routeRows = rows.filter((r) => r.record_type.startsWith("ROUTE"));
  assert.ok(routeRows.some((r) => r.field === "metrics.distance_km" && r.value === 9.2174));
  assert.ok(routeRows.some((r) => r.field === "metrics.terrain_risk_proxy" && r.value === 32.95));
  assert.ok(routeRows.some((r) => r.field === "metrics.elevation_gain_m"));
  assert.ok(routeRows.some((r) => String(r.value).includes("5° local slope")));
  const waypointRows = rows.filter((r) => r.record_type.includes("waypoint_analysis"));
  assert.ok(waypointRows.some((r) => r.field === "aspect_deg"));
  assert.ok(waypointRows.some((r) => r.field === "local_elevation_max_m"));
  const coordinateRows = rows.filter((r) => r.record_type.includes("coordinates"));
  assert.equal(coordinateRows.filter((r) => r.field === "latitude_deg").length >= 5, true);
});

test("AI candidates export metrics, weights, method, uncertainties and provenance", () => {
  const candidateRows = rows.filter((r) => r.record_type.includes("candidates"));
  const ids = new Set(candidateRows.map((r) => r.record_id));
  assert.ok(ids.has("cand-balanced") && ids.has("cand-low-eva"));
  for (const field of ["objective_weights.eva", "generation_method", "algorithm_version", "pareto_label", "metrics.distance_km", "metrics.route_generation_time_ms", "ai_explanation", "provenance.terrain"]) {
    assert.ok(candidateRows.some((r) => r.field === field), `candidate field ${field} missing`);
  }
  assert.ok(candidateRows.some((r) => r.field.startsWith("uncertainties[")));
});

test("orbital tracking records are exported with distances and uncertainty", () => {
  const trackingRows = rows.filter((r) => r.record_type.startsWith("ORBITAL_TRACKING"));
  for (const field of ["distance_au", "distance_km", "distance_min_au", "distance_max_au", "relative_velocity_km_s", "time_sigma_raw", "tracking_status", "close_approach_tdb"]) {
    assert.ok(trackingRows.some((r) => r.field === field), `tracking field ${field} missing`);
  }
});

test("mission console, notes, safe havens, custom places and provenance are exported", () => {
  assert.ok(rows.some((r) => r.record_type.startsWith("MISSION_CONSOLE")));
  assert.ok(rows.some((r) => r.field === "todo" && String(r.value).includes("Check ramp")));
  assert.ok(rows.some((r) => r.record_type.startsWith("SAFE_HAVENS") && r.field === "name"));
  assert.ok(rows.some((r) => r.record_type.startsWith("CUSTOM_PLACES") && r.field === "name"));
  assert.ok(rows.some((r) => r.record_type === "PROVENANCE" && r.field === "gemini.status" && r.value === "AI INTERPRETATION"));
  assert.ok(rows.some((r) => r.field === "app_version"));
});

test("nested values with commas, quotes and newlines survive a CSV round trip", () => {
  assert.ok(csv.includes('"Safe Haven 1, north"'));
  assert.ok(csv.includes('"Outcrop\nsample"'));
  assert.ok(csv.includes('"Context only, ""not"" a measurement at this coordinate"'));
});

test("units, status, source and coordinates are attached to rows", () => {
  assert.equal(unitFor("distance_km"), "km");
  assert.equal(unitFor("relative_velocity_km_s"), "km/s");
  assert.equal(unitFor("elevation_m"), "m");
  assert.equal(unitFor("slope_deg"), "deg");
  assert.equal(unitFor("brightness_temperature_k"), "K");
  assert.equal(unitFor("estimated_eva_hours"), "h");
  assert.equal(unitFor("terrain_risk_proxy"), "");
  const thermal = rows.find((r) => r.record_id === "i99827002pbt" && r.field === "brightness_temperature_k");
  assert.equal(thermal.unit, "K");
  assert.equal(thermal.source, "NASA THEMIS IR-PBT");
  assert.equal(thermal.latitude_deg, -4.59);
  assert.equal(thermal.timestamp, "2024-06-16T00:48:01.020");
});

test("unavailable values stay unavailable and are never coerced to zero", () => {
  const nullScience = rows.find((r) => r.record_id === "cand-low-eva" && r.field === "metrics.science_opportunity_score");
  assert.equal(nullScience.value, null);
  assert.equal(csvField(nullScience.value), "");
  assert.ok(!rows.some((r) => r.field === "metrics.science_opportunity_score" && r.value === 0 && r.record_id === "cand-low-eva"));
});

test("empty and missing sections do not crash the exporter", () => {
  const empty = missionToCsv({ selection: null, route: null, saved_routes: [], environment: {} });
  assert.ok(empty.includes("record_type"));
  assert.equal(flattenMission({}).length, 0);
  assert.ok(missionToCsv(undefined).startsWith("\uFEFF"));
});

test("human-readable route CSV still works alongside the complete export", () => {
  const routeCsv = routeToCsv(mission.route);
  const lines = routeCsv.slice(1).split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("route_name,route_id,index,label"));
  assert.ok(lines[1].includes("-4.5895"));
});

test("filenames are stable and extension-correct", () => {
  assert.match(exportFilename("mission", "csv"), /^neuronexus-mission-\d{4}-\d{2}-\d{2}T[\d-]+\.csv$/);
});
