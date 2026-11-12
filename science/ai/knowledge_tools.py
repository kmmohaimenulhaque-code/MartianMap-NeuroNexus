"""Knowledge, reference and calculation tools for Mars Intelligence.

Each tool is registered with @tool, which keeps its Gemini function
declaration beside its implementation. New tools only need this decorator;
science.ai.tools merges REGISTRY into the assistant automatically.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from science.ai.knowledge_base import KNOWLEDGE

ROOT = Path(__file__).resolve().parents[2]
REGISTRY: dict[str, dict[str, Any]] = {}


def tool(name: str, description: str, properties: dict[str, Any] | None = None, required: list[str] | None = None):
    def decorate(fn: Callable[..., Any]):
        parameters: dict[str, Any] = {"type": "object", "properties": properties or {}}
        if required:
            parameters["required"] = required
        REGISTRY[name] = {"fn": fn, "declaration": {"name": name, "description": description, "parameters": parameters}}
        return fn
    return decorate


def _selection(state: dict[str, Any], latitude: float | None, longitude: float | None) -> tuple[float, float] | None:
    if latitude is not None and longitude is not None:
        return float(latitude), float(longitude)
    selection = state.get("selection") or {}
    if selection.get("latitude_deg") is None or selection.get("longitude_deg") is None:
        return None
    return float(selection["latitude_deg"]), float(selection["longitude_deg"])


def _hits(results: list[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        return {"status": "NO MATCH", "detail": "Nothing relevant in the local knowledge base. Answer from general "
                "knowledge (label it GENERAL KNOWLEDGE) or suggest enabling WEB SEARCH."}
    return {"status": "ok", "results": results,
            "citation_rule": "Cite as [title › section]. Respect each result's evidence_class and as_of date."}


@tool("search_mars_knowledge",
      "Search the curated Mars reference library: planetary science (orbit, seasons, Ls, atmosphere, dust, geology, "
      "water/ice, moons, radiation), every NASA and partner-agency Mars mission (history, discoveries, status), "
      "observation history, Mars time keeping, human exploration, ISRU and landing-site criteria.",
      {"query": {"type": "string", "description": "Natural-language search query."},
       "k": {"type": "integer", "description": "Number of sections to return (default 5, max 8)."}}, ["query"])
def search_mars_knowledge(state, query: str, k: int = 5, **_):
    return _hits(KNOWLEDGE.search(query, k=max(1, min(int(k), 8)), kinds=("reference",)))


@tool("search_project_docs",
      "Search NeuroNexus' own documentation: README, setup and deployment guides, data sources (MLA), results, "
      "architecture, team and NASA Space Apps 2026 context, and the UI command catalogue.",
      {"query": {"type": "string"}, "k": {"type": "integer"}}, ["query"])
def search_project_docs(state, query: str, k: int = 5, **_):
    return _hits(KNOWLEDGE.search(query, k=max(1, min(int(k), 8)), kinds=("project", "ui", "reference")
                                  if "team" in query.lower() else ("project", "ui")))


@tool("get_ui_guide",
      "How to use the NeuroNexus interface: where a feature is, what it does, keyboard shortcuts. "
      "Leave topic empty to list every command by category.",
      {"topic": {"type": "string", "description": "Feature or task, e.g. 'compare routes in 3D'."}})
def get_ui_guide(state, topic: str = "", **_):
    path = ROOT / "frontend" / "src" / "features" / "commands.json"
    if not topic.strip():
        catalogue = json.loads(path.read_text(encoding="utf-8"))
        return {"categories": [{"category": c["label"], "commands": [
            {"label": x["label"], "shortcut": x.get("shortcut")} for x in catalogue["commands"] if x["category"] == c["id"]]}
            for c in catalogue["categories"]],
            "entry_point": "☰ Command Index (top right) or Ctrl/⌘+K."}
    return _hits(KNOWLEDGE.search(topic, k=6, kinds=("ui", "project")))


@lru_cache(maxsize=1)
def _gazetteer():
    from science.gazetteer.usgs import USGSMarsGazetteer

    return USGSMarsGazetteer(ROOT / "data" / "processed" / "gazetteer" / "mars_nomenclature_center_pts.parquet")


@tool("lookup_mars_place",
      "Look up any named Mars feature in the USGS/IAU Gazetteer by name (anywhere on Mars, not only near the selection).",
      {"name": {"type": "string"}}, ["name"])
def lookup_mars_place(state, name: str, **_):
    matches = _gazetteer().find(name)
    exact = [m for m in matches if str(m.get("feature_name", "")).lower() == name.strip().lower()]
    items = (exact or list(matches))[:10]
    if not items:
        return {"status": "NOT FOUND", "detail": f"No registered USGS/IAU feature matches '{name}'."}
    keep = ("feature_name", "feature_type", "diameter_km", "latitude_deg", "longitude_deg", "quadrangle_name",
            "approval_status", "origin", "usgs_feature_url")
    return {"source": "USGS Gazetteer of Planetary Nomenclature (IAU)", "count": len(matches),
            "features": [{k: m.get(k) for k in keep if k in m} for m in items]}


@tool("get_landing_sites", "Catalogue of Mars landing sites with coordinates, dates and status.",
      {"mission": {"type": "string", "description": "Optional mission-name filter."}})
def get_landing_sites(state, mission: str = "", **_):
    data = json.loads((ROOT / "data" / "manifests" / "mars_landing_sites.json").read_text(encoding="utf-8"))
    sites = [s for s in data.get("sites", []) if mission.lower() in json.dumps(s).lower()]
    return {"source": data.get("source_of_truth"), "coordinate_convention": data.get("coordinate_convention"),
            "count": len(sites), "sites": sites[:30]}


@tool("get_dust_scenario",
      "MODELED NASA Ames MGCM MY34 dust scenario at a coordinate (defaults to the selected site): opacity τ and "
      "dust-top height for a sol, the full-year min/mean/max, the peak sol, and the global picture for that sol.",
      {"latitude": {"type": "number"}, "longitude": {"type": "number"},
       "sol": {"type": "integer", "description": "1-668 (defaults to the console sol)."}})
def get_dust_scenario(state, latitude: float | None = None, longitude: float | None = None, sol: int | None = None, **_):
    from science.weather.api.dust import _cell, _map, _provenance, _series
    from science.weather.models.environment_assessment import classify_dust

    point = _selection(state, latitude, longitude)
    if point is None:
        return {"status": "UNAVAILABLE", "detail": "No coordinate supplied or selected."}
    sol = int(sol or state.get("sol") or 1)
    sol = min(max(sol, 1), 668)
    series = _series(*_cell(*point))
    tau = series["tau"][sol - 1]
    global_map = _map(sol)
    return {**_provenance(), "cell": series["cell"], "sol": sol, "ls_deg": series["ls_deg"][sol - 1],
            "tau": tau, "level": classify_dust(tau) if tau is not None else None,
            "dust_top_km": series["zmax_km"][sol - 1], "year_stats": series["stats"],
            "peak_ls_deg": series["ls_deg"][series["stats"]["peak_sol"] - 1],
            "global_tau_for_sol": global_map["range"]}


@tool("get_terrain_statistics",
      "DERIVED NASA MOLA MEGDR terrain statistics (MIN/MEAN/MAX elevation, slope, roughness) over a square window "
      "around a coordinate (defaults to the selected site).",
      {"latitude": {"type": "number"}, "longitude": {"type": "number"},
       "window_km": {"type": "number", "description": "Window side in km, 1-20 (default 4)."}})
def get_terrain_statistics(state, latitude: float | None = None, longitude: float | None = None,
                           window_km: float = 4.0, **_):
    from science.terrain.api import terrain_window

    point = _selection(state, latitude, longitude)
    if point is None:
        return {"status": "UNAVAILABLE", "detail": "No coordinate supplied or selected."}
    size = min(max(float(window_km), 1.0), 20.0)
    try:
        window = terrain_window(latitude=point[0], longitude=point[1] % 360.0, width_km=size, height_km=size)
    except Exception as exc:
        return {"status": "UNAVAILABLE", "detail": str(getattr(exc, "detail", exc))[:300]}
    return {"source": window["source"], "data_class": "DERIVED", "center": window["center"],
            "window_km": size, "summary": window["summary"]}


# Allison & McEwen (2000) / Mars24 periodic perturbation terms: (A, tau, phi).
_PBS = [(0.0071, 2.2353, 49.409), (0.0057, 2.7543, 168.173), (0.0039, 1.1177, 191.837),
        (0.0037, 15.7866, 21.736), (0.0021, 2.1354, 15.704), (0.0020, 2.4694, 95.528), (0.0018, 32.8493, 49.095)]
_MY1_START = datetime(1955, 4, 11, tzinfo=timezone.utc)
_MARS_YEAR_DAYS = 686.9726


def mars_time(moment: datetime) -> dict[str, Any]:
    """Ls, Mars Year and MTC for a UTC instant (Allison & McEwen 2000, as used by NASA GISS Mars24)."""
    jd_utc = moment.timestamp() / 86400.0 + 2440587.5
    jd_tt = jd_utc + (37.0 + 32.184) / 86400.0
    dt = jd_tt - 2451545.0
    m = math.radians((19.3871 + 0.52402073 * dt) % 360.0)
    alpha = 270.3871 + 0.524038496 * dt
    pbs = sum(a * math.cos(math.radians(0.985626 * dt / t + p)) for a, t, p in _PBS)
    eoc = ((10.691 + 3.0e-7 * dt) * math.sin(m) + 0.623 * math.sin(2 * m) + 0.050 * math.sin(3 * m)
           + 0.005 * math.sin(4 * m) + 0.0005 * math.sin(5 * m) + pbs)
    ls = (alpha + eoc) % 360.0
    msd = (jd_tt - 2405522.0028779) / 1.0274912517
    mtc = (24.0 * msd) % 24.0
    my = int((moment - _MY1_START).total_seconds() / 86400.0 // _MARS_YEAR_DAYS) + 1
    # Near the year boundary the day-count estimate can be off by one: align it with Ls.
    days_into = ((moment - _MY1_START).total_seconds() / 86400.0) % _MARS_YEAR_DAYS
    if ls > 300 and days_into < 60:
        my -= 1
    elif ls < 60 and days_into > _MARS_YEAR_DAYS - 60:
        my += 1
    season = ["northern spring", "northern summer", "northern autumn", "northern winter"][int(ls // 90)]
    return {"utc": moment.isoformat(), "ls_deg": round(ls, 2), "mars_year": my, "northern_season": season,
            "mars_sol_date": round(msd, 4), "mtc_hours": round(mtc, 3),
            "dust_season": 180 <= ls < 360, "method": "Allison & McEwen (2000), NASA GISS Mars24 algorithm"}


@tool("mars_calculator",
      "Deterministic Mars conversions. operation is one of: mars_time (date → Ls, Mars Year, season; value = ISO date "
      "or empty for now), earth_days_to_sols, sols_to_earth_days, earth_kg_to_mars_weight, light_time_minutes "
      "(value = distance in km), celsius_to_kelvin, kelvin_to_celsius.",
      {"operation": {"type": "string"}, "value": {"type": "string", "description": "Input value (number or ISO date)."}},
      ["operation"])
def mars_calculator(state, operation: str, value: str = "", **_):
    op = operation.strip().lower()
    if op == "mars_time":
        moment = datetime.now(timezone.utc) if not value.strip() else datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return {"data_class": "COMPUTED", **mars_time(moment)}
    number = float(value)
    table = {
        "earth_days_to_sols": (number / 1.0274912517, "sols"),
        "sols_to_earth_days": (number * 1.0274912517, "Earth days"),
        "earth_kg_to_mars_weight": (number * 3.721 / 9.80665, "kg-equivalent on Mars (0.379 g)"),
        "light_time_minutes": (number / 299792.458 / 60.0, "minutes one-way"),
        "celsius_to_kelvin": (number + 273.15, "K"),
        "kelvin_to_celsius": (number - 273.15, "°C"),
    }
    if op not in table:
        return {"error": f"Unknown operation '{operation}'.", "operations": ["mars_time", *table]}
    result, unit = table[op]
    return {"data_class": "COMPUTED", "operation": op, "input": number, "result": round(result, 4), "unit": unit}
