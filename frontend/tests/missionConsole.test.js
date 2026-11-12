import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MISSION_PROFILE, buildMissionConsoleState, haversineKm, nearestSafeHaven, safeHavenRelationship } from "../src/utils/missionConsole.js";
import { buildMissionFixture } from "./missionFixture.js";

const mission = buildMissionFixture();
const state = buildMissionConsoleState({
  profile: DEFAULT_MISSION_PROFILE,
  sol: 100,
  selection: mission.selection,
  environment: mission.environment,
  route: mission.route,
  routeCandidates: mission.route_candidates,
  selectedCandidateId: "cand-balanced",
  savedRoutes: mission.saved_routes,
  safeHavens: mission.safe_havens,
  customPlaces: mission.custom_places,
  orbitalTracking: mission.orbital_tracking,
  backendConnected: true,
});

test("the simulation banner is always present", () => {
  assert.equal(state.mode, "SIMULATION / RESEARCH MODEL");
  assert.equal(state.banner, "NOT A LIVE CREW, VEHICLE OR MISSION CONTROL FEED");
});

test("mission tab is derived from live application state", () => {
  assert.equal(state.mission.sol.value, 100);
  assert.equal(state.mission.site.value, "Curiosity landing");
  assert.equal(state.mission.route_distance_km.value, 9.22);
  assert.equal(state.mission.selected_candidate.value, "Balanced");
  assert.equal(state.mission.candidate_count.value, 2);
  assert.equal(state.mission.route_status.value, "DRAFT");
});

test("mission timeline is configurable rather than fictional", () => {
  for (const entry of Object.values(state.mission.timeline)) {
    assert.ok(["CONFIGURABLE", "UNAVAILABLE"].includes(entry.status));
  }
});

test("crew biometrics are never fabricated", () => {
  assert.equal(state.crew.biometrics.status, "NOT CONNECTED");
  assert.equal(state.crew.dosimeters.status, "NOT CONNECTED");
  assert.equal(state.crew.manifest.length, 4);
  assert.equal(state.crew.manifest[0].estimated_eva_hours, 4.19);
  assert.equal(state.crew.manifest[3].estimated_eva_hours, null);
});

test("vehicles report NOT MODELED instead of fictional 100% values", () => {
  const json = JSON.stringify(state.vehicles);
  assert.ok(!json.includes("100%"));
  for (const vehicle of state.vehicles) {
    assert.equal(vehicle.communications.status, "NOT MODELED");
    assert.equal(vehicle.thermal_control.status, "NOT MODELED");
    assert.equal(vehicle.power.status, "NOT MODELED");
  }
  const rover = state.vehicles.find((v) => v.class === "PRESSURISED ROVER");
  assert.equal(rover.route_assignment, "Traverse A");
  assert.equal(rover.route_distance_km, 9.22);
  assert.ok(rover.link.startsWith("https://www.nasa.gov/"));
});

test("EVA tab uses current route state and labels derivation", () => {
  assert.equal(state.eva.route_distance_km.value, 9.22);
  assert.equal(state.eva.estimated_eva_hours.value, 4.19);
  assert.equal(state.eva.estimated_eva_hours.status, "DERIVED");
  assert.equal(state.eva.terrain_risk_proxy.value, 32.95);
  assert.ok(state.eva.dust_context.value.includes("Opacity"));
  assert.equal(state.eva.dust_context.status, "MODELED");
  assert.equal(state.eva.safe_haven_relationship.status, "COMPUTED");
  assert.ok(state.eva.safe_haven_relationship.nearest_safe_haven.distance_km >= 0);
});

test("radiation keeps a historical reference and no live feed claim", () => {
  assert.equal(state.radiation.surface_reference.status, "NASA OBSERVED");
  assert.ok(state.radiation.surface_reference.url.includes("nasa.gov"));
  assert.equal(state.radiation.solar_particle_events.status, "NO LIVE FEED");
  assert.equal(state.radiation.crew_dosimeters.status, "NOT CONNECTED");
  assert.equal(state.radiation.route_radiation_context.status, "NO LIVE FEED");
});

test("life support is configurable and unset values stay unavailable", () => {
  assert.equal(state.life_support.cabin_pressure_kpa.status, "UNAVAILABLE");
  const configured = buildMissionConsoleState({
    profile: { ...DEFAULT_MISSION_PROFILE, lifeSupport: { ...DEFAULT_MISSION_PROFILE.lifeSupport, cabinPressureKpa: 70 } },
  });
  assert.equal(configured.life_support.cabin_pressure_kpa.value, 70);
  assert.equal(configured.life_support.cabin_pressure_kpa.status, "CONFIGURABLE");
});

test("resources come from the environment data model with provenance", () => {
  assert.equal(state.resources.atmosphere[0].name, "CO₂");
  assert.equal(state.resources.atmosphere[0].volume_percent, 95.1);
  assert.equal(state.resources.minerals.value, "NOT INGESTED");
  assert.equal(state.resources.dust_opacity.status, "MODELED");
  assert.equal(state.resources.thermal_reference.status, "NASA OBSERVED");
});

test("every console section carries a NASA or partner link where one exists", () => {
  const json = JSON.stringify(state);
  for (const domain of ["nasa.gov", "usgs.gov", "jpl.nasa.gov", "asu.edu"]) {
    assert.ok(json.includes(domain), `missing link domain ${domain}`);
  }
  for (const entry of Object.values(state.provenance)) {
    assert.ok(entry.source);
  }
});

test("empty application state yields unavailable rather than invented values", () => {
  const empty = buildMissionConsoleState({});
  assert.equal(empty.mission.route_distance_km.status, "UNAVAILABLE");
  assert.equal(empty.eva.estimated_eva_hours.status, "UNAVAILABLE");
  assert.equal(empty.eva.safe_haven_relationship.status, "UNAVAILABLE");
  assert.equal(empty.resources.atmosphere[0].status, "UNAVAILABLE");
  assert.equal(empty.orbital_tracking.tracking_status, "DATA SOURCE NOT QUERIED");
});

test("geometry helpers agree with the backend Mars radius", () => {
  const km = haversineKm({ latitude_deg: 0, longitude_deg: 0 }, { latitude_deg: 0, longitude_deg: 1 });
  assert.ok(Math.abs(km - (3396.0 * Math.PI) / 180) < 1e-6);
  assert.equal(haversineKm({ latitude_deg: 0, longitude_deg: 359 }, { latitude_deg: 0, longitude_deg: 1 }) < 120, true);
  assert.equal(nearestSafeHaven(null, []), null);
  assert.equal(safeHavenRelationship(null, []).status, "UNAVAILABLE");
});
