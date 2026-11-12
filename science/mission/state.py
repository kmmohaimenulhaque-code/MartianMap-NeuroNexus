from __future__ import annotations

from typing import Any


NASA_RAD_SOURCE = (
    "https://science.nasa.gov/resource/"
    "radiation-measurements-on-mars/"
)
NASA_MARS_HUMANS_SOURCE = (
    "https://www.nasa.gov/humans-in-space/humans-to-mars/"
)


CREW_TEMPLATE = [
    {
        "id": "CREW-01",
        "role": "COMMAND",
        "status": "SIM READY",
        "eva": "STANDBY",
    },
    {
        "id": "CREW-02",
        "role": "PILOT / SYSTEMS",
        "status": "SIM READY",
        "eva": "STANDBY",
    },
    {
        "id": "CREW-03",
        "role": "GEOLOGY / SCIENCE",
        "status": "SIM READY",
        "eva": "STANDBY",
    },
    {
        "id": "CREW-04",
        "role": "MEDICAL / EVA",
        "status": "SIM READY",
        "eva": "STANDBY",
    },
]


VEHICLE_TEMPLATE = [
    {
        "name": "DEEP-SPACE TRANSIT",
        "id": "SIM-TRANSIT-01",
        "state": "SIM NOMINAL",
    },
    {
        "name": "MARS LANDER / ASCENDER",
        "id": "SIM-LA-01",
        "state": "SIM NOMINAL",
    },
    {
        "name": "PRESSURISED ROVER",
        "id": "SIM-PR-01",
        "state": "SIM NOMINAL",
    },
    {
        "name": "SURFACE SCOUT",
        "id": "SIM-SCOUT-01",
        "state": "SIM NOMINAL",
    },
    {
        "name": "SURFACE HABITAT",
        "id": "SIM-HAB-01",
        "state": "SIM NOMINAL",
    },
]


def build_mission_state(
    *,
    site_name: str = "Gale",
    sol: int = 100,
    route_distance_km: float | None = None,
) -> dict[str, Any]:
    """Return a clearly-labelled synthetic crewed-Mars mission state.

    This is an application simulation model. It deliberately contains no
    claim that the crew, vehicles, readiness values, or live feeds exist.
    """

    return {
        "mode": "simulation",
        "mission": {
            "id": "NN-MARS-01",
            "phase": "SURFACE OPERATIONS",
            "sol": int(sol),
            "landing_site": site_name,
            "objective": (
                "Science survey, traverse, resource reconnaissance "
                "and surface operations."
            ),
            "timeline": {
                "earth_departure": "configurable",
                "mars_arrival": "configurable",
                "surface_campaign": "configurable",
                "return_ascent": "configurable",
            },
            "sources": [NASA_MARS_HUMANS_SOURCE],
        },
        "crew": [dict(member) for member in CREW_TEMPLATE],
        "spacecraft": [dict(vehicle) for vehicle in VEHICLE_TEMPLATE],
        "vehicle_systems": {
            "power": "100% SIM",
            "avionics": "NOMINAL / SIM",
            "communications": "NOMINAL / SIM",
            "propellant": "100% SIM",
            "thermal_control": "NOMINAL / SIM",
            "dust_protection": "MONITORED / SIM",
        },
        "eva": {
            "state": "STANDBY",
            "suit_pressure": "NOMINAL / SIM",
            "portable_life_support": "NOMINAL / SIM",
            "o2": "100% SIM",
            "co2_scrubbing": "100% SIM",
            "battery": "100% SIM",
            "thermal_control": "100% SIM",
            "communications": "NOMINAL / SIM",
            "distance_from_habitat_km": 0.0,
            "return_path": "MANUAL REVIEW REQUIRED",
        },
        "radiation": {
            "surface_reference_ugy_day": 210.0,
            "reference_unit": "µGy/day",
            "reference_source": "Curiosity Radiation Assessment Detector (RAD)",
            "reference_url": NASA_RAD_SOURCE,
            "galactic_cosmic_rays": "REFERENCE ONLY",
            "solar_particle_events": "NO LIVE FEED",
            "crew_dosimeters": "NOT CONNECTED",
            "shelter_state": "STANDBY",
            "live_forecast": False,
        },
        "life_support": {
            "cabin_pressure": "NOMINAL / SIM",
            "oxygen_generation_reserve": "SIMULATED",
            "co2_removal": "NOMINAL / SIM",
            "water_recovery": "NOMINAL / SIM",
            "waste_processing": "NOMINAL / SIM",
            "food_inventory": "SIMULATED",
            "surface_isru": "SITE / TECHNOLOGY DEPENDENT",
            "power": "NOMINAL / SIM",
        },
        "resources": {
            "regolith": "CONTEXT ONLY",
            "minerals": "SITE-SPECIFIC DATASET REQUIRED",
            "water": "SITE-SPECIFIC EVIDENCE REQUIRED",
            "bioavailability": "PROXY ONLY",
            "vegetation": "NO CONFIRMED NATIVE VEGETATION",
            "atmosphere": "SITE SCIENCE LAYER",
        },
        "route": {
            "planned_distance_km": route_distance_km,
            "distance_model": "Haversine waypoint geometry",
            "terrain_search": "none",
            "waypoint_analysis": "local MOLA samples only",
        },
        "provenance": {
            "simulation_values": True,
            "live_telemetry": False,
            "crew_identity": False,
            "mission_certification": False,
        },
    }
