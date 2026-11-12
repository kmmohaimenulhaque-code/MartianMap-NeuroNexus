/*
 * frontend/src/utils/missionConsole.js
 *
 * Derives the Crewed Mars Console from the SAME mission state App.jsx owns.
 * No panel keeps its own copy of anything, so nothing can drift.
 *
 * Every value carries one of:
 *   PROJECT DATA / NASA OBSERVED / NASA REFERENCE / MODELED / DERIVED /
 *   COMPUTED / SIMULATED / CONFIGURABLE / NOT MODELED / NOT CONNECTED /
 *   NO LIVE FEED / UNAVAILABLE
 * and, where one exists, a NASA or partner link.
 */

export const NASA_LINKS = {
  humansToMars: "https://www.nasa.gov/humans-in-space/humans-to-mars/",
  moonToMars: "https://www.nasa.gov/moontomarsarchitecture/",
  marsFacts: "https://science.nasa.gov/mars/facts/",
  marsExploration: "https://science.nasa.gov/mars/",
  mola: "https://pds-geosciences.wustl.edu/missions/mgs/megdr.html",
  themis: "https://themis.asu.edu/",
  odyssey: "https://science.nasa.gov/mission/odyssey/",
  amesGcm: "https://www.nasa.gov/ames/mars-climate-modeling-center/",
  rad: "https://science.nasa.gov/resource/radiation-measurements-on-mars/",
  radInstrument: "https://science.nasa.gov/mission/msl-curiosity/radiation-assessment-detector/",
  spaceWeather: "https://ccmc.gsfc.nasa.gov/",
  donki: "https://ccmc.gsfc.nasa.gov/tools/DONKI/",
  eclss: "https://www.nasa.gov/reference/environmental-control-and-life-support-systems/",
  isru: "https://www.nasa.gov/isru/",
  moxie: "https://science.nasa.gov/mission/mars-2020-perseverance/moxie/",
  eva: "https://www.nasa.gov/exploration-extravehicular-activity-and-human-surface-mobility-program/",
  spacesuits: "https://www.nasa.gov/reference/spacesuits/",
  pressurisedRover: "https://www.nasa.gov/reference/pressurized-rover/",
  curiosity: "https://science.nasa.gov/mission/msl-curiosity/",
  perseverance: "https://science.nasa.gov/mission/mars-2020-perseverance/",
  mro: "https://science.nasa.gov/mission/mars-reconnaissance-orbiter/",
  dustStorms: "https://science.nasa.gov/mars/dust-storms/",
  water: "https://science.nasa.gov/mars/water/",
  usgsNomenclature: "https://planetarynames.wr.usgs.gov/",
  usgsGeology: "https://pubs.usgs.gov/sim/3292/",
  jplCad: "https://ssd-api.jpl.nasa.gov/doc/cad.html",
  cneos: "https://cneos.jpl.nasa.gov/",
  imageLibrary: "https://images.nasa.gov/",
  humanHealth: "https://www.nasa.gov/hrp/",
  spaceRadiation: "https://www.nasa.gov/hrp/elements/space-radiation/",
};

export const DEFAULT_MISSION_PROFILE = {
  missionId: "NN-MARS-01",
  phase: "SURFACE OPERATIONS",
  objective: "Science survey, traverse and resource reconnaissance",
  earthDeparture: "",
  marsArrival: "",
  surfaceCampaignSols: "",
  returnWindow: "",
  crew: [
    { id: "CREW-01", role: "COMMAND", evaReady: true },
    { id: "CREW-02", role: "PILOT / SYSTEMS", evaReady: true },
    { id: "CREW-03", role: "GEOLOGY / SCIENCE", evaReady: true },
    { id: "CREW-04", role: "MEDICAL / EVA", evaReady: false },
  ],
  vehicles: [
    { id: "SIM-TRANSIT-01", class: "DEEP-SPACE TRANSIT", assignedToRoute: false, link: NASA_LINKS.moonToMars },
    { id: "SIM-LA-01", class: "MARS LANDER / ASCENDER", assignedToRoute: false, link: NASA_LINKS.humansToMars },
    { id: "SIM-PR-01", class: "PRESSURISED ROVER", assignedToRoute: true, link: NASA_LINKS.pressurisedRover },
    { id: "SIM-SCOUT-01", class: "SURFACE SCOUT", assignedToRoute: false, link: NASA_LINKS.eva },
    { id: "SIM-HAB-01", class: "SURFACE HABITAT", assignedToRoute: false, link: NASA_LINKS.eclss },
  ],
  evaPaceKmh: 2.5,
  ascentAllowanceMPerH: 600,
  evaShiftLimitHours: 8,
  lifeSupport: {
    cabinPressureKpa: "",
    oxygenReserveDays: "",
    co2RemovalCapacity: "",
    waterRecoveryPercent: "",
    foodInventoryDays: "",
    powerBudgetKw: "",
    backupLifeSupport: "",
    emergencyShelter: "",
  },
  habitat: null,
};

const MARS_RADIUS_KM = 3396.0;

export function haversineKm(a, b) {
  if (!a || !b) {
    return null;
  }
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const lat1 = toRad(a.latitude_deg);
  const lat2 = toRad(b.latitude_deg);
  const dLat = lat2 - lat1;
  const dLon = toRad(((((Number(b.longitude_deg) - Number(a.longitude_deg)) % 360) + 540) % 360) - 180);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  if (!Number.isFinite(h)) {
    return null;
  }
  return 2 * MARS_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function nearestSafeHaven(point, safeHavens = []) {
  if (!point || !safeHavens.length) {
    return null;
  }
  let best = null;
  for (const haven of safeHavens) {
    const distance = haversineKm(point, haven);
    if (distance !== null && (best === null || distance < best.distance_km)) {
      best = { ...haven, distance_km: distance };
    }
  }
  return best;
}

export function safeHavenRelationship(route, safeHavens = []) {
  const coordinates = route?.coordinates ?? [];
  if (!coordinates.length) {
    return { status: "UNAVAILABLE", detail: "No route is planned." };
  }
  if (!safeHavens.length) {
    return { status: "NONE DEFINED", detail: "No Safe Haven has been created." };
  }
  let nearestToRoute = null;
  let worstExposure = null;
  for (const point of coordinates) {
    const nearest = nearestSafeHaven(point, safeHavens);
    if (!nearest) {
      continue;
    }
    if (!nearestToRoute || nearest.distance_km < nearestToRoute.distance_km) {
      nearestToRoute = { ...nearest, at: point };
    }
    if (!worstExposure || nearest.distance_km > worstExposure.distance_km) {
      worstExposure = { ...nearest, at: point };
    }
  }
  return {
    status: "COMPUTED",
    nearest_safe_haven: nearestToRoute,
    max_distance_to_nearest_safe_haven_km: worstExposure?.distance_km ?? null,
    start_nearest: nearestSafeHaven(coordinates[0], safeHavens),
    end_nearest: nearestSafeHaven(coordinates[coordinates.length - 1], safeHavens),
    note: "A Safe Haven is a user-defined planning location. It is not established as physically safe.",
  };
}

/*
 * Statuses that are meaningful precisely because there is no value:
 * they must survive an empty value rather than collapsing to UNAVAILABLE.
 */
const SENTINEL_STATUSES = new Set(["NOT CONNECTED", "NO LIVE FEED", "NOT MODELED", "NOT INGESTED", "NONE DEFINED", "UNAVAILABLE"]);

function value(v, status, source = null, url = null, detail = null) {
  const empty = v === null || v === undefined || v === "";
  const resolved = empty && !SENTINEL_STATUSES.has(status) ? "UNAVAILABLE" : status;
  return { value: empty ? "UNAVAILABLE" : v, status: resolved, source, url, detail };
}

const round = (v, digits = 2) => {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const number = Number(v);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
};

export function buildMissionConsoleState(state = {}) {
  const {
    profile = DEFAULT_MISSION_PROFILE,
    sol = null,
    selection = null,
    environment = null,
    route = null,
    routeCandidates = null,
    selectedCandidateId = null,
    savedRoutes = [],
    safeHavens = [],
    customPlaces = [],
    orbitalTracking = null,
    backendConnected = false,
  } = state;

  const metrics = route?.metrics ?? null;
  const siteScience = environment?.site_science ?? null;
  const gases = siteScience?.atmosphere?.gases ?? [];
  const haven = safeHavenRelationship(route, safeHavens);
  const habitat = profile.habitat ?? safeHavens[0] ?? null;
  const distanceFromHabitat =
    route?.coordinates?.length && habitat ? Math.max(...route.coordinates.map((point) => haversineKm(point, habitat) ?? 0)) : null;
  const evaHours = metrics?.estimated_eva_hours ?? null;
  const shiftLimit = Number(profile.evaShiftLimitHours) || null;

  return {
    mode: "SIMULATION / RESEARCH MODEL",
    banner: "NOT A LIVE CREW, VEHICLE OR MISSION CONTROL FEED",
    generated_at: new Date().toISOString(),
    backend_connected: backendConnected,

    mission: {
      id: value(profile.missionId, "CONFIGURABLE"),
      phase: value(profile.phase, "CONFIGURABLE"),
      sol: value(sol, "PROJECT DATA"),
      site: value(selection?.label ?? selection?.feature_name ?? null, "PROJECT DATA", "Current selection"),
      coordinate: value(
        selection ? `${Number(selection.latitude_deg).toFixed(4)}°, ${Number(selection.longitude_deg).toFixed(4)}°E` : null,
        "PROJECT DATA",
      ),
      objective: value(profile.objective, "CONFIGURABLE", "NASA Moon to Mars architecture", NASA_LINKS.moonToMars),
      route_name: value(route?.name ?? null, "PROJECT DATA"),
      route_distance_km: value(round(metrics?.distance_km), "COMPUTED", "Haversine on MOLA-sampled waypoints", NASA_LINKS.mola),
      route_status: value(route?.coordinates?.length ? (route.analysed ? "ANALYSED" : "DRAFT") : "NOT PLANNED", "PROJECT DATA"),
      navigation_model: value(
        "Deterministic Dijkstra over bounded MOLA 128 ppd windows + Haversine geometry",
        "DERIVED",
        "NASA MOLA MEGDR",
        NASA_LINKS.mola,
      ),
      terrain_analysis: value(
        metrics?.data_support_score != null ? `${metrics.data_support_score}% MOLA sample support` : null,
        "DERIVED",
        "NASA MOLA MEGDR",
        NASA_LINKS.mola,
      ),
      selected_candidate: value(routeCandidates?.candidates?.find((c) => c.id === selectedCandidateId)?.name ?? null, "PROJECT DATA"),
      candidate_count: value(routeCandidates?.candidates?.length ?? 0, "PROJECT DATA"),
      saved_routes: value(savedRoutes.length, "PROJECT DATA"),
      timeline: {
        earth_departure: value(profile.earthDeparture, "CONFIGURABLE", "NASA humans to Mars", NASA_LINKS.humansToMars),
        mars_arrival: value(profile.marsArrival, "CONFIGURABLE", "NASA humans to Mars", NASA_LINKS.humansToMars),
        surface_campaign_sols: value(profile.surfaceCampaignSols, "CONFIGURABLE"),
        return_window: value(profile.returnWindow, "CONFIGURABLE"),
      },
    },

    crew: {
      manifest: (profile.crew ?? []).map((member) => ({
        id: member.id,
        role: member.role,
        eva_readiness: member.evaReady ? "EVA READY / SIM" : "NOT ASSIGNED / SIM",
        route_assignment: route?.name ?? (route?.coordinates?.length ? "CURRENT ROUTE" : "NONE"),
        estimated_eva_hours: member.evaReady ? round(evaHours) : null,
        eva_within_shift_limit:
          member.evaReady && evaHours != null && shiftLimit
            ? evaHours <= shiftLimit
              ? "WITHIN CONFIGURED LIMIT"
              : "EXCEEDS CONFIGURED LIMIT"
            : "UNAVAILABLE",
        distance_to_route_start_km: null,
        simulation_state: "SIMULATED",
      })),
      eva_shift_limit_hours: value(shiftLimit, "CONFIGURABLE", "NASA EVA and human surface mobility", NASA_LINKS.eva),
      biometrics: value(null, "NOT CONNECTED", "NASA Human Research Program", NASA_LINKS.humanHealth),
      dosimeters: value(null, "NOT CONNECTED", "NASA space radiation", NASA_LINKS.spaceRadiation),
      consumables: value("Profile-driven", "SIMULATED", "NASA ECLSS", NASA_LINKS.eclss),
    },

    vehicles: (profile.vehicles ?? []).map((vehicle) => ({
      id: vehicle.id,
      class: vehicle.class,
      link: vehicle.link,
      route_assignment: vehicle.assignedToRoute ? (route?.name ?? "CURRENT ROUTE") : "NOT ASSIGNED",
      mission_assignment: profile.missionId,
      route_distance_km: vehicle.assignedToRoute ? round(metrics?.distance_km) : null,
      power: vehicle.powerPercent != null ? { value: vehicle.powerPercent, status: "CONFIGURABLE" } : { value: "NOT MODELED", status: "NOT MODELED" },
      propellant:
        vehicle.propellantPercent != null
          ? { value: vehicle.propellantPercent, status: "CONFIGURABLE" }
          : { value: "NOT MODELED", status: "NOT MODELED" },
      communications: { value: "NOT MODELED", status: "NOT MODELED" },
      thermal_control: { value: "NOT MODELED", status: "NOT MODELED" },
      simulation_state: "SIMULATED",
    })),

    eva: {
      state: value(route?.coordinates?.length ? "ROUTE LOADED / SIM" : "STANDBY / SIM", "SIMULATED"),
      route_distance_km: value(round(metrics?.distance_km), "COMPUTED"),
      estimated_eva_hours: value(round(evaHours), "DERIVED", "NeuroNexus EVA model (configurable pace)", NASA_LINKS.eva),
      eva_pace_kmh: value(metrics?.eva_pace_kmh ?? profile.evaPaceKmh, "CONFIGURABLE"),
      ascent_allowance_m_per_h: value(metrics?.ascent_allowance_m_per_h ?? profile.ascentAllowanceMPerH, "CONFIGURABLE"),
      distance_from_habitat_km: value(
        round(distanceFromHabitat),
        habitat ? "COMPUTED" : "UNAVAILABLE",
        habitat ? `Habitat: ${habitat.name ?? "Safe Haven"}` : "No habitat/Safe Haven defined",
      ),
      return_path: value(route?.coordinates?.length ? "MANUAL REVIEW REQUIRED" : null, "SIMULATED"),
      terrain_burden_score: value(round(metrics?.terrain_burden_score), "DERIVED", "NASA MOLA MEGDR", NASA_LINKS.mola),
      terrain_risk_proxy: value(
        round(metrics?.terrain_risk_proxy),
        "DERIVED",
        "NeuroNexus derived terrain-risk proxy (not certified)",
        NASA_LINKS.mola,
      ),
      max_slope_deg: value(round(metrics?.max_slope_deg), "DERIVED", "NASA MOLA MEGDR", NASA_LINKS.mola),
      mean_slope_deg: value(round(metrics?.mean_slope_deg), "DERIVED", "NASA MOLA MEGDR", NASA_LINKS.mola),
      dust_context: value(
        environment?.dust?.opacity != null ? `Opacity ${Number(environment.dust.opacity).toFixed(3)}` : null,
        "MODELED",
        "NASA Ames Mars GCM MY34 dust scenario",
        NASA_LINKS.amesGcm,
      ),
      safe_haven_relationship: haven,
    },

    radiation: {
      surface_reference: value(
        "~210 µGy/day (Gale crater, MSL/RAD)",
        "NASA OBSERVED",
        "MSL RAD historical measurement",
        NASA_LINKS.rad,
        "Historical measurement at one site and period. Not a forecast and not a crew dose calculation.",
      ),
      instrument: value("Radiation Assessment Detector (RAD)", "NASA REFERENCE", "NASA MSL", NASA_LINKS.radInstrument),
      gcr_context: value(
        "Galactic cosmic rays dominate the quiet-time surface dose",
        "NASA REFERENCE",
        "NASA space radiation",
        NASA_LINKS.spaceRadiation,
      ),
      solar_particle_events: value(null, "NO LIVE FEED", "NASA CCMC DONKI (not connected)", NASA_LINKS.donki),
      crew_dosimeters: value(null, "NOT CONNECTED"),
      shelter_configuration: value(
        safeHavens.length ? `${safeHavens.length} Safe Haven(s) defined` : null,
        safeHavens.length ? "PROJECT DATA" : "UNAVAILABLE",
      ),
      route_radiation_context: value(null, "NO LIVE FEED", "No route-resolved radiation model is ingested"),
    },

    life_support: {
      cabin_pressure_kpa: value(profile.lifeSupport?.cabinPressureKpa, "CONFIGURABLE", "NASA ECLSS", NASA_LINKS.eclss),
      oxygen_reserve_days: value(profile.lifeSupport?.oxygenReserveDays, "CONFIGURABLE", "NASA ECLSS", NASA_LINKS.eclss),
      co2_removal_capacity: value(profile.lifeSupport?.co2RemovalCapacity, "CONFIGURABLE", "NASA ECLSS", NASA_LINKS.eclss),
      water_recovery_percent: value(profile.lifeSupport?.waterRecoveryPercent, "CONFIGURABLE", "NASA ECLSS", NASA_LINKS.eclss),
      food_inventory_days: value(profile.lifeSupport?.foodInventoryDays, "CONFIGURABLE"),
      power_budget_kw: value(profile.lifeSupport?.powerBudgetKw, "CONFIGURABLE"),
      backup_life_support: value(profile.lifeSupport?.backupLifeSupport, "CONFIGURABLE"),
      emergency_shelter: value(profile.lifeSupport?.emergencyShelter, "CONFIGURABLE"),
      safe_havens: value(safeHavens.length, "PROJECT DATA"),
      isru_context: value("Atmospheric CO₂ processing demonstrated by MOXIE on Perseverance", "NASA REFERENCE", "NASA MOXIE", NASA_LINKS.moxie),
    },

    resources: {
      atmosphere: gases.length
        ? gases.map((gas) => ({
            name: gas.name,
            volume_percent: gas.volume_percent ?? null,
            status: gas.status ?? (gas.volume_percent == null ? "UNAVAILABLE" : "NASA REFERENCE"),
            source: gas.source ?? "NASA Mars facts",
            url: gas.source_url ?? NASA_LINKS.marsFacts,
          }))
        : [
            {
              name: "Atmosphere",
              volume_percent: null,
              status: "UNAVAILABLE",
              source: "No site atmosphere composition ingested",
              url: NASA_LINKS.marsFacts,
            },
          ],
      dust_opacity: value(round(environment?.dust?.opacity, 3), "MODELED", "NASA Ames Mars GCM MY34", NASA_LINKS.amesGcm),
      soil: value(
        siteScience?.soil?.value ?? null,
        siteScience?.soil?.status ?? "UNAVAILABLE",
        siteScience?.soil?.source,
        siteScience?.soil?.source_url ?? NASA_LINKS.marsExploration,
      ),
      minerals: value(
        siteScience?.minerals?.value ?? null,
        siteScience?.minerals?.status ?? "NOT INGESTED",
        siteScience?.minerals?.source,
        siteScience?.minerals?.source_url ?? NASA_LINKS.mro,
      ),
      water: value(
        siteScience?.water?.value ?? null,
        siteScience?.water?.status ?? "UNAVAILABLE",
        siteScience?.water?.source,
        siteScience?.water?.source_url ?? NASA_LINKS.water,
      ),
      bioavailability: value(
        siteScience?.bioavailability?.value ?? null,
        siteScience?.bioavailability?.status ?? "UNAVAILABLE",
        siteScience?.bioavailability?.source,
        siteScience?.bioavailability?.source_url,
      ),
      vegetation: value(
        siteScience?.vegetation?.value ?? null,
        siteScience?.vegetation?.status ?? "UNAVAILABLE",
        siteScience?.vegetation?.source,
        siteScience?.vegetation?.source_url,
      ),
      thermal_reference: value(
        environment?.thermal?.observations?.[0]?.brightness_temperature_k != null
          ? `${Number(environment.thermal.observations[0].brightness_temperature_k).toFixed(1)} K nearest historical`
          : null,
        "NASA OBSERVED",
        "NASA THEMIS IR-PBT",
        NASA_LINKS.themis,
      ),
    },

    orbital_tracking: {
      status: orbitalTracking?.status ?? "NOT QUERIED",
      tracking_status: orbitalTracking?.tracking_status ?? "DATA SOURCE NOT QUERIED",
      count: orbitalTracking?.count ?? 0,
      retrieved_at: orbitalTracking?.retrieved_at ?? null,
      source: "NASA/JPL SSD Close-Approach Data API",
      url: NASA_LINKS.jplCad,
      next_approach: orbitalTracking?.objects?.[0] ?? null,
    },

    places: { custom_places: customPlaces.length, safe_havens: safeHavens.length },

    provenance: {
      terrain: { source: "NASA MOLA MEGDR 128 ppd", url: NASA_LINKS.mola, status: "NASA OBSERVED" },
      thermal: { source: "NASA THEMIS IR-PBT", url: NASA_LINKS.themis, status: "NASA OBSERVED" },
      atmosphere: { source: "NASA Ames Mars GCM MY34", url: NASA_LINKS.amesGcm, status: "MODELED" },
      nomenclature: { source: "USGS/IAU Gazetteer", url: NASA_LINKS.usgsNomenclature, status: "NASA REFERENCE" },
      geology: { source: "USGS SIM 3292", url: NASA_LINKS.usgsGeology, status: "NASA REFERENCE" },
      radiation: { source: "MSL RAD historical", url: NASA_LINKS.rad, status: "NASA OBSERVED" },
      orbital: { source: "NASA/JPL CAD API", url: NASA_LINKS.jplCad, status: "NASA OBSERVED" },
      simulation: { source: "NeuroNexus mission simulation profile", url: null, status: "SIMULATED" },
    },
  };
}
