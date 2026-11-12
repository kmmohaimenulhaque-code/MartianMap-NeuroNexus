"""NASA / partner data-source ledger.

Distinguishes EXTERNAL SOURCE, DERIVED OUTPUT, TEAM EXPERIMENT,
TEAM BENCHMARK, TEAM METHOD and AI INTERPRETATION so that AI prose is never
presented as a NASA observation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LEDGER_FILE = ROOT / "data" / "manifests" / "source_ledger.json"

CLASSES = ["EXTERNAL SOURCE", "DERIVED OUTPUT", "TEAM EXPERIMENT", "TEAM BENCHMARK", "TEAM METHOD", "AI INTERPRETATION"]

EVIDENCE_STATUSES = {
    "PROJECT DATA": "Stored in this application's own state.",
    "NASA OBSERVED": "A real instrument measurement from a NASA mission archive.",
    "NASA REFERENCE": "A published NASA/USGS reference value or catalogue entry.",
    "MODELED": "Output of a physical model (e.g. NASA Ames Mars GCM).",
    "DERIVED": "Computed by NeuroNexus from observed or modelled inputs.",
    "COMPUTED": "Pure geometry or arithmetic computed by NeuroNexus.",
    "SIMULATED": "A configurable NeuroNexus simulation value, not a measurement.",
    "UNAVAILABLE": "No evidence is ingested; nothing is inferred.",
}

ENTRIES: list[dict[str, Any]] = [
    {"id": "usgs_nomenclature", "class": "EXTERNAL SOURCE", "organisation": "USGS Astrogeology / IAU",
     "title": "Gazetteer of Planetary Nomenclature (Mars, 2,052 features)",
     "url": "https://planetarynames.wr.usgs.gov/", "use": "Named feature search, site identity, science evidence."},
    {"id": "usgs_sim3292", "class": "EXTERNAL SOURCE", "organisation": "USGS",
     "title": "SIM 3292 Geologic Map of Mars, 1:20M (Tanaka et al., 2014)",
     "url": "https://pubs.usgs.gov/sim/3292/", "use": "Scientific map view and route geologic-unit snapshot."},
    {"id": "nasa_mola", "class": "EXTERNAL SOURCE", "organisation": "NASA MGS / MOLA",
     "title": "MOLA MEGDR 128 pixels/degree topography (MGS-M-MOLA-5-MEGDR-L3-V1.0)",
     "url": "https://pds-geosciences.wustl.edu/missions/mgs/megdr.html",
     "use": "Elevation, slope, roughness, route planning grid and terrain metrics."},
    {"id": "nasa_themis", "class": "EXTERNAL SOURCE", "organisation": "NASA Mars Odyssey / ASU",
     "title": "THEMIS IR predicted brightness temperature observations",
     "url": "https://themis.asu.edu/", "use": "Historical thermal evidence at and around sites."},
    {"id": "nasa_ames_mgcm", "class": "EXTERNAL SOURCE", "organisation": "NASA Ames Research Center",
     "title": "Mars Global Climate Model MY34 dust scenario",
     "url": "https://www.nasa.gov/space-science-and-astrobiology-at-ames/division-overview/planetary-systems-branch-overview-stt/mars-climate-modeling-center-mcmc/", "use": "Modelled dust opacity and height."},
    {"id": "nasa_rad", "class": "EXTERNAL SOURCE", "organisation": "NASA MSL / RAD",
     "title": "Radiation Assessment Detector surface measurements (Gale crater)",
     "url": "https://science.nasa.gov/resource/radiation-measurements-on-mars/",
     "use": "Historical surface radiation reference only. Not a forecast."},
    {"id": "nasa_image_library", "class": "EXTERNAL SOURCE", "organisation": "NASA",
     "title": "NASA Image and Video Library", "url": "https://images.nasa.gov/", "use": "Rover and mission imagery metadata."},
    {"id": "nasa_photojournal", "class": "EXTERNAL SOURCE", "organisation": "NASA Science",
     "title": "Mars photojournal feed", "url": "https://science.nasa.gov/mars/", "use": "Reference briefing feed."},
    {"id": "jpl_cad", "class": "EXTERNAL SOURCE", "organisation": "NASA/JPL Solar System Dynamics",
     "title": "Small-Body Database Close-Approach Data API", "url": "https://ssd-api.jpl.nasa.gov/doc/cad.html",
     "use": "Near-Mars small-body close approaches, distances and uncertainties."},
    {"id": "nn_route_engine", "class": "TEAM METHOD", "organisation": "NeuroNexus",
     "title": "Deterministic multi-objective route engine", "url": None,
     "use": "Dijkstra candidate generation and metric computation over MOLA windows."},
    {"id": "nn_risk_proxy", "class": "DERIVED OUTPUT", "organisation": "NeuroNexus",
     "title": "NeuroNexus derived terrain-risk proxy", "url": None,
     "use": "Transparent weighted proxy. Not a NASA or mission safety certification."},
    {"id": "nn_eva_model", "class": "TEAM METHOD", "organisation": "NeuroNexus",
     "title": "Estimated EVA time model (configurable pace + ascent allowance)", "url": None,
     "use": "Planning estimate only. Not operational flight data."},
    {"id": "nn_mission_sim", "class": "TEAM EXPERIMENT", "organisation": "NeuroNexus",
     "title": "Crewed Mars Console simulation profile", "url": None,
     "use": "Configurable simulation of crew, vehicle and life-support planning values."},
    {"id": "gemini", "class": "AI INTERPRETATION", "organisation": "Google",
     "title": "Gemini model interpretation of NeuroNexus structured results",
     "url": "https://ai.google.dev/gemini-api/docs",
     "use": "Explanation and prioritisation only. AI prose is never a NASA observation."},
]


def source_ledger() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema": "neuronexus.source-ledger.v2",
        "classes": CLASSES,
        "evidence_statuses": EVIDENCE_STATUSES,
        "entries": ENTRIES,
        "boundary": "AI-generated prose is an AI INTERPRETATION and is never a NASA observation.",
    }
    try:
        payload["repository_ledger"] = json.loads(LEDGER_FILE.read_text())
    except Exception:
        payload["repository_ledger"] = {"status": "UNAVAILABLE"}
    return payload
