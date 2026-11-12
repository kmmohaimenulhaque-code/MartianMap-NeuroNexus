from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from typing import Any

from science.evidence.site_profile import build_site_profile


AU_KM = 149_597_870.7
JPL_CAD_URL = "https://ssd-api.jpl.nasa.gov/cad.api"


# -------------------------------------------------
# SOURCE REGISTRY
# -------------------------------------------------

SOURCES: dict[str, dict[str, Any]] = {
    "jpl_cad": {
        "id": "jpl_cad",
        "organisation": "NASA/JPL CNEOS",
        "title": "Small-Body Close Approach Data API",
        "class": "measurement_database",
        "url": JPL_CAD_URL,
        "use": (
            "Close-approach records, dates, distances, velocities and "
            "optional physical parameters for small bodies approaching Mars."
        ),
    },
    "jpl_sbdb": {
        "id": "jpl_sbdb",
        "organisation": "NASA/JPL Solar System Dynamics",
        "title": "Small-Body Database",
        "class": "orbital_database",
        "url": "https://ssd-api.jpl.nasa.gov/doc/sbdb.html",
        "use": (
            "Small-body orbital parameters and physical/orbit metadata."
        ),
    },
    "nasa_mars_facts": {
        "id": "nasa_mars_facts",
        "organisation": "NASA Science",
        "title": "Mars Facts",
        "class": "mission_science",
        "url": "https://science.nasa.gov/mars/facts/",
        "use": (
            "Mars atmosphere, temperature, water-state and environmental context."
        ),
    },
    "nasa_dust_cycle": {
        "id": "nasa_dust_cycle",
        "organisation": "NASA",
        "title": "Dust Cycle",
        "class": "mission_science",
        "url": "https://www.nasa.gov/general/dust-cycle/",
        "use": (
            "Martian dust lifting, transport, atmospheric feedback and "
            "local-to-global dust-storm behaviour."
        ),
    },
    "nasa_dust_modeling": {
        "id": "nasa_dust_modeling",
        "organisation": "NASA",
        "title": "Dust Lifting and Dust Cycle Modeling",
        "class": "mission_science",
        "url": (
            "https://www.nasa.gov/general/"
            "dust-lifting-and-dust-cycle-modeling/"
        ),
        "use": (
            "Dust lifting mechanisms including wind stress and convective "
            "vortex/dust-devil processes."
        ),
    },
    "nasa_mars_cyclones": {
        "id": "nasa_mars_cyclones",
        "organisation": "NASA Ames / NASA Technical Reports Server",
        "title": "Large-scale weather systems on Mars",
        "class": "research",
        "url": (
            "https://ntrs.nasa.gov/citations/20170000649"
        ),
        "use": (
            "Evidence that Mars supports large-scale cyclones, "
            "anticyclones and travelling weather systems."
        ),
    },
    "nasa_mars_greenhouse": {
        "id": "nasa_mars_greenhouse",
        "organisation": "NASA Science",
        "title": "Planetary atmospheres",
        "class": "mission_science",
        "url": (
            "https://science.nasa.gov/solar-system/"
            "10-things-planetary-atmospheres/"
        ),
        "use": (
            "Mars has a weak greenhouse effect because of its thin atmosphere."
        ),
    },
    "noaa_enso": {
        "id": "noaa_enso",
        "organisation": "NOAA Climate Prediction Center",
        "title": "ENSO Cycle",
        "class": "earth_analogue",
        "url": (
            "https://www.cpc.ncep.noaa.gov/products/"
            "analysis_monitoring/ensocycle/ensocycle.shtml"
        ),
        "use": (
            "Earth El Niño/La Niña ocean-atmosphere variability. "
            "Not a direct Mars weather mode."
        ),
    },
}


def _source(source_id: str) -> dict[str, Any]:
    return dict(SOURCES[source_id])


# -------------------------------------------------
# STATIC HAZARD CATALOGUE
# -------------------------------------------------

HAZARD_CATALOGUE: list[dict[str, Any]] = [
    {
        "id": "mars_close_approach",
        "name": "Mars-orbit asteroid close approach",
        "domain": "mars_orbital_environment",
        "applicability": "dynamic",
        "evidence_type": "JPL/CNEOS",
        "status_text": (
            "Live-queryable orbital close-approach data. "
            "A close approach is not an impact prediction."
        ),
        "controls": [
            "monitor JPL/CNEOS close-approach records",
            "verify object designation and trajectory",
            "place surface operations on review hold when mission authority requires",
            "preserve communications and navigation margins",
            "maintain protected/shelter posture if an impact scenario is independently confirmed",
            "do not represent NeuroNexus as an asteroid-deflection authority",
        ],
        "source_ids": ["jpl_cad", "jpl_sbdb"],
    },
    {
        "id": "dust_storm",
        "name": "Dust storm",
        "domain": "mars_surface_weather",
        "applicability": "real_mars_hazard",
        "evidence_type": "NASA observation/model",
        "status_text": (
            "Mars experiences local, regional and occasionally "
            "planet-encircling dust storms."
        ),
        "controls": [
            "reduce unnecessary EVA exposure",
            "protect optics and mechanical interfaces",
            "preserve power reserves for degraded solar generation",
            "retain a navigation-safe return route",
            "maintain communications margin",
            "resume normal operations only after environmental review",
        ],
        "source_ids": ["nasa_dust_cycle", "nasa_dust_modeling"],
    },
    {
        "id": "convective_vortex",
        "name": "Dust devil / convective vortex",
        "domain": "mars_surface_weather",
        "applicability": "real_mars_hazard",
        "evidence_type": "NASA observation",
        "status_text": (
            "Pressure-drop and vortex events have been measured "
            "by Mars surface missions."
        ),
        "controls": [
            "hold exposed EVA activity when local conditions warrant",
            "secure lightweight external equipment",
            "protect dust-sensitive interfaces",
            "retain immediate return-to-habitat path",
            "log pressure/wind changes when local instruments are available",
        ],
        "source_ids": ["nasa_dust_modeling", "nasa_mars_facts"],
    },
    {
        "id": "large_scale_cyclone",
        "name": "Large-scale Martian cyclone / weather system",
        "domain": "mars_atmosphere",
        "applicability": "real_mars_weather",
        "evidence_type": "NASA research",
        "status_text": (
            "Mars can support large-scale cyclonic and anticyclonic "
            "weather systems, especially in higher latitudes and "
            "during relevant seasons."
        ),
        "controls": [
            "increase weather-monitoring cadence",
            "review dust and atmospheric transport implications",
            "review communications and navigation margins",
            "avoid treating an Earth hurricane category as a Mars severity scale",
        ],
        "source_ids": ["nasa_mars_cyclones"],
    },
    {
        "id": "thermal_extreme",
        "name": "Thermal extreme",
        "domain": "mars_surface_environment",
        "applicability": "real_mars_hazard",
        "evidence_type": "NASA mission evidence",
        "status_text": (
            "Mars has large temperature variability and a very thin atmosphere."
        ),
        "controls": [
            "protect batteries and thermal-sensitive hardware",
            "schedule EVA activity using validated thermal constraints",
            "retain thermal refuge capability",
            "distinguish historical THEMIS brightness temperature from live forecasts",
        ],
        "source_ids": ["nasa_mars_facts", "nasa_mars_greenhouse"],
    },
    {
        "id": "greenhouse_effect",
        "name": "Martian greenhouse effect",
        "domain": "planetary_climate",
        "applicability": "real_but_not_equivalent_to_earth",
        "evidence_type": "NASA science",
        "status_text": (
            "Mars has a weak greenhouse effect. This should not be "
            "treated as an Earth-like runaway-greenhouse scenario."
        ),
        "controls": [
            "track atmospheric state through appropriate models",
            "do not convert greenhouse physics into an immediate surface hazard score",
            "keep atmospheric composition separate from short-timescale weather hazards",
        ],
        "source_ids": ["nasa_mars_greenhouse"],
    },
    {
        "id": "enso",
        "name": "El Niño / La Niña",
        "domain": "earth_climate_analogue",
        "applicability": "not_a_mars_weather_mode",
        "evidence_type": "NOAA Earth climate science",
        "status_text": (
            "ENSO describes coupled ocean-atmosphere variability in "
            "Earth's tropical Pacific. Mars has no Earth-like ocean "
            "basin on which to reproduce this mechanism."
        ),
        "controls": [
            "keep ENSO in the Earth-comparison layer",
            "never use an ENSO index as a direct Mars surface-weather input",
            "use it for educational comparison or Earth-Mars climate storytelling",
        ],
        "source_ids": ["noaa_enso"],
    },
    {
        "id": "acid_rain",
        "name": "Acid rain",
        "domain": "earth_weather_analogue",
        "applicability": "not_a_mars_surface_rain_mode",
        "evidence_type": "planetary-environment comparison",
        "status_text": (
            "Persistent liquid rainfall is not a normal Martian surface "
            "operating condition because the atmosphere is too thin for "
            "liquid water to remain stable for long."
        ),
        "controls": [
            "do not model terrestrial acid-rain chemistry as ordinary Mars rainfall",
            "track Martian dust, ice clouds, atmospheric chemistry and deposition separately",
            "label any acid-rain scenario as an Earth or hypothetical analogue",
        ],
        "source_ids": ["nasa_mars_facts"],
    },
]


# -------------------------------------------------
# JPL/CNEOS CLOSE APPROACH FETCH
# -------------------------------------------------

_CACHE_LOCK = threading.Lock()
_ASTEROID_CACHE: dict[str, Any] = {
    "timestamp": 0.0,
    "key": None,
    "value": None,
}

CACHE_SECONDS = 900


def _fetch_json(
    url: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    query = urllib.parse.urlencode(params)

    request = urllib.request.Request(
        f"{url}?{query}",
        headers={
            "User-Agent": (
                "NeuroNexus-Martian-Map/1.0 "
                "(NASA Space Apps research prototype)"
            ),
            "Accept": "application/json",
        },
        method="GET",
    )

    with urllib.request.urlopen(
        request,
        timeout=20,
    ) as response:
        payload = response.read().decode("utf-8")

    result = json.loads(payload)

    if not isinstance(result, dict):
        raise RuntimeError("JPL API returned a non-object JSON payload.")

    return result


def _parse_cad(payload: dict[str, Any]) -> list[dict[str, Any]]:
    fields = payload.get("fields", [])
    rows = payload.get("data", [])

    if not fields or not rows:
        return []

    index = {
        field: i
        for i, field in enumerate(fields)
    }

    output: list[dict[str, Any]] = []

    for row in rows:
        def value(field: str) -> Any:
            position = index.get(field)
            if position is None or position >= len(row):
                return None
            return row[position]

        dist_au = value("dist")
        dist_min_au = value("dist_min")
        dist_max_au = value("dist_max")
        velocity = value("v_rel")
        h_mag = value("h")
        diameter = value("diameter")

        try:
            dist_au_float = float(dist_au)
        except (TypeError, ValueError):
            dist_au_float = None

        def number(value_: Any) -> float | None:
            try:
                return float(value_)
            except (TypeError, ValueError):
                return None

        distance_km = (
            dist_au_float * AU_KM
            if dist_au_float is not None
            else None
        )

        if distance_km is not None:
            if distance_km <= 0.01 * AU_KM:
                screening_band = "near-mars-watch"
            elif distance_km <= 0.05 * AU_KM:
                screening_band = "close-mars-watch"
            else:
                screening_band = "extended-mars-watch"
        else:
            screening_band = "unresolved"

        output.append(
            {
                "designation": value("des"),
                "fullname": (
                    str(value("fullname")).strip()
                    if value("fullname") is not None
                    else None
                ),
                "orbit_id": value("orbit_id"),
                "close_approach_time_tdb": value("cd"),
                "distance_au": dist_au_float,
                "distance_km": distance_km,
                "distance_min_au": number(dist_min_au),
                "distance_max_au": number(dist_max_au),
                "relative_velocity_km_s": number(velocity),
                "absolute_magnitude_H": number(h_mag),
                "diameter_km": number(diameter),
                "screening_band": screening_band,
                "screening_note": (
                    "NeuroNexus display band only. "
                    "This is not a NASA impact probability, risk score "
                    "or collision classification."
                ),
            }
        )

    return output


def get_mars_asteroid_watch(
    horizon_days: int = 365,
    distance_max_au: float = 0.20,
    limit: int = 24,
) -> dict[str, Any]:
    horizon_days = min(max(int(horizon_days), 1), 3650)
    distance_max_au = min(
        max(float(distance_max_au), 0.001),
        2.0,
    )
    limit = min(max(int(limit), 1), 100)

    cache_key = (
        horizon_days,
        round(distance_max_au, 6),
        limit,
    )

    now = time.time()

    with _CACHE_LOCK:
        if (
            _ASTEROID_CACHE["value"] is not None
            and _ASTEROID_CACHE["key"] == cache_key
            and now - float(_ASTEROID_CACHE["timestamp"])
            < CACHE_SECONDS
        ):
            return _ASTEROID_CACHE["value"]

    params = {
        "body": "Mars",
        "date-min": "now",
        "date-max": f"+{horizon_days}",
        "dist-max": str(distance_max_au),
        "kind": "a",
        "neo": "false",
        "class": "MCA",
        "sort": "dist",
        "limit": str(limit),
        "diameter": "true",
        "fullname": "true",
    }

    try:
        payload = _fetch_json(
            JPL_CAD_URL,
            params,
        )

        signature = payload.get("signature", {})

        result = {
            "status": "live_query",
            "source": _source("jpl_cad"),
            "signature": signature,
            "query": {
                "body": "Mars",
                "orbit_class": "MCA",
                "kind": "asteroid",
                "horizon_days": horizon_days,
                "distance_max_au": distance_max_au,
            },
            "count": int(payload.get("count", 0) or 0),
            "objects": _parse_cad(payload),
            "note": (
                "Records are JPL/CNEOS close approaches to Mars. "
                "They are orbital screening data and do not by themselves "
                "establish an impact event."
            ),
        }

    except Exception as exc:
        result = {
            "status": "unavailable",
            "source": _source("jpl_cad"),
            "error": str(exc),
            "count": 0,
            "objects": [],
            "note": (
                "The live JPL query failed. No orbital conclusion is "
                "inferred from missing data."
            ),
        }

    with _CACHE_LOCK:
        _ASTEROID_CACHE["timestamp"] = now
        _ASTEROID_CACHE["key"] = cache_key
        _ASTEROID_CACHE["value"] = result

    return result


# -------------------------------------------------
# SITE-AWARE HAZARD OVERVIEW
# -------------------------------------------------

def _site_environment(
    site_name: str,
    sol: int,
) -> dict[str, Any]:
    try:
        profile = build_site_profile(
            site_name=site_name,
            sol=sol,
        )

        if profile.get("ok"):
            return profile

        return {
            "ok": False,
            "error": profile.get(
                "error",
                "Site profile unavailable.",
            ),
        }

    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
        }


def build_hazard_overview(
    site_name: str = "Gale",
    sol: int = 100,
    horizon_days: int = 365,
) -> dict[str, Any]:
    site = _site_environment(
        site_name=site_name,
        sol=sol,
    )

    asteroid_watch = get_mars_asteroid_watch(
        horizon_days=horizon_days,
    )

    live_evidence = {
        "mola": None,
        "themis": None,
        "mgcm": None,
    }

    if site.get("ok"):
        science = site.get("science", {})
        live_evidence["mola"] = science.get("mola")
        live_evidence["themis"] = science.get("themis")
        live_evidence["mgcm"] = science.get("mgcm")

    hazards = []

    for hazard in HAZARD_CATALOGUE:
        hazards.append(
            {
                **hazard,
                "sources": [
                    _source(source_id)
                    for source_id in hazard["source_ids"]
                ],
            }
        )

    return {
        "mode": "research_prototype",
        "site": site.get(
            "site",
            {
                "name": site_name,
            },
        ),
        "sol": int(sol),
        "asteroid_watch": asteroid_watch,
        "site_evidence": live_evidence,
        "hazards": hazards,
        "defence_doctrine": {
            "title": "Mission protection doctrine",
            "steps": [
                {
                    "phase": "MONITOR",
                    "actions": [
                        "query authoritative observations/models",
                        "record source and timestamp",
                        "distinguish measurement from model",
                    ],
                },
                {
                    "phase": "VERIFY",
                    "actions": [
                        "do not act on an unverified headline or inferred value",
                        "check source signature/version when available",
                        "separate missing evidence from safe conditions",
                    ],
                },
                {
                    "phase": "HOLD",
                    "actions": [
                        "pause optional surface activity when defined trigger conditions are reached",
                        "preserve return route",
                        "maintain communications margin",
                    ],
                },
                {
                    "phase": "SHELTER",
                    "actions": [
                        "move personnel into protected configuration when required",
                        "protect power, thermal and life-support reserves",
                        "secure exposed equipment",
                    ],
                },
                {
                    "phase": "RECOVER",
                    "actions": [
                        "re-check current evidence",
                        "validate route and systems",
                        "resume operations only under mission authority",
                    ],
                },
            ],
            "important_boundary": (
                "NeuroNexus is a research and simulation system. "
                "Its contingency playbooks are not flight rules, "
                "NASA operational directives or certified safety procedures."
            ),
        },
        "evidence_registry": [
            _source(source_id)
            for source_id in SOURCES
        ],
        "limitations": [
            "No live Mars weather station network is connected to this endpoint.",
            "THEMIS values are historical brightness-temperature observations.",
            "MGCM values are model outputs, not direct observations.",
            "JPL close approaches are not automatically impact predictions.",
            "ENSO is kept as an Earth analogue rather than a Mars forcing.",
            "Acid rain is not treated as ordinary present-day Martian rainfall.",
            "Defence actions are prototype mission-contingency concepts.",
        ],
    }


# -------------------------------------------------
# AI-READY NORMALISED CONTEXT
# -------------------------------------------------

def build_ai_context(
    site_name: str = "Gale",
    sol: int = 100,
) -> dict[str, Any]:
    overview = build_hazard_overview(
        site_name=site_name,
        sol=sol,
        horizon_days=365,
    )

    return {
        "schema": "neuronexus.hazard-context.v1",
        "generated_for": {
            "site": site_name,
            "sol": int(sol),
        },
        "instruction_to_future_ai": (
            "Use evidence only as labelled. Never turn missing evidence "
            "into a safe-state assumption. Never present a model output "
            "as a direct observation. Never claim NASA certification."
        ),
        "site_evidence": overview["site_evidence"],
        "asteroid_watch": overview["asteroid_watch"],
        "hazards": overview["hazards"],
        "defence_doctrine": overview["defence_doctrine"],
        "evidence_registry": overview["evidence_registry"],
    }
