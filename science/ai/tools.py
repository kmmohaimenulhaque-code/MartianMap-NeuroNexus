"""Application tools exposed to Gemini function calling.

Every tool returns compact structured data. Large arrays (terrain rasters,
full evidence tables) are summarised before they are sent to the model.
The mission state is supplied by the browser each turn; server-side sources
(JPL, USGS, THEMIS, NASA feeds) are queried live.
"""

from __future__ import annotations

import json
from typing import Any, Callable

MAX_TOOL_CHARS = 12000


def _clip(value: Any, limit: int = MAX_TOOL_CHARS) -> Any:
    text = json.dumps(value, default=str)
    if len(text) <= limit:
        return value
    if isinstance(value, list):
        keep = max(1, len(value) * limit // max(len(text), 1))
        return {"truncated": True, "shown": keep, "total": len(value), "items": value[:keep]}
    return {"truncated": True, "preview": text[:limit]}


def _get(state: dict[str, Any], *path: str, default: Any = None) -> Any:
    node: Any = state
    for key in path:
        if not isinstance(node, dict):
            return default
        node = node.get(key)
    return node if node is not None else default


def _unavailable(what: str) -> dict[str, Any]:
    return {"status": "UNAVAILABLE", "detail": f"{what} is not present in the current mission state."}


def _metrics(candidate: dict[str, Any]) -> dict[str, Any]:
    metrics = candidate.get("metrics") or {}
    keep = [
        "distance_km", "estimated_eva_hours", "eva_pace_kmh", "mean_slope_deg", "max_slope_deg",
        "mean_roughness_m", "max_roughness_m", "elevation_min_m", "elevation_max_m", "elevation_gain_m",
        "elevation_loss_m", "terrain_burden_score", "terrain_risk_proxy", "operational_burden_score",
        "science_opportunity_score", "science_evidence_count", "data_support_score", "objective_score",
        "route_generation_time_ms",
    ]
    return {
        "id": candidate.get("id"),
        "name": candidate.get("name"),
        "objective_weights": candidate.get("objective_weights") or candidate.get("scoring_weights"),
        "generation_method": candidate.get("generation_method"),
        "pareto": candidate.get("pareto_label"),
        "uncertainties": candidate.get("uncertainties"),
        "metrics": {key: metrics.get(key, "UNAVAILABLE") for key in keep},
    }


# ------------------------------------------------------------------ tools


def get_selected_location(state, **_):
    location = _get(state, "selection")
    return location or _unavailable("A selected location")


def get_selected_feature(state, **_):
    feature = _get(state, "selection", "selected_feature")
    if not feature:
        return {"status": "NO NAMED FEATURE SELECTED",
                "detail": "The selection is an exact coordinate; nearby nomenclature is context only."}
    return {k: feature.get(k) for k in (
        "feature_name", "feature_type", "diameter_km", "latitude_deg", "longitude_deg",
        "quadrangle_name", "approval_status", "usgs_feature_url")}


def get_environment(state, **_):
    environment = _get(state, "environment")
    if not environment:
        return _unavailable("Environment data")
    thermal = (_get(environment, "thermal", "observations") or [{}])[0]
    return {
        "location": environment.get("location"),
        "thermal_nearest": {k: thermal.get(k) for k in (
            "brightness_temperature_k", "brightness_temperature_c", "product_id", "observation_start",
            "solar_longitude_deg", "local_solar_time_hours", "spatial_distance_km")} or "UNAVAILABLE",
        "thermal_observation_count": len(_get(environment, "thermal", "observations") or []),
        "thermal_status": "NASA OBSERVED (historical THEMIS IR-PBT)",
        "dust": environment.get("dust"),
        "dust_status": "MODELED (NASA Ames MGCM MY34 scenario)",
        "solar": environment.get("solar"),
        "terrain": environment.get("terrain"),
        "assessment": environment.get("assessment"),
    }


def get_terrain_analysis(state, **_):
    terrain = _get(state, "environment", "terrain")
    route = _get(state, "route", "metrics")
    return {"site_terrain": terrain or "UNAVAILABLE",
            "route_terrain": {k: (route or {}).get(k) for k in (
                "mean_slope_deg", "max_slope_deg", "mean_roughness_m", "max_roughness_m",
                "elevation_gain_m", "elevation_loss_m", "terrain_burden_score", "terrain_risk_proxy")} if route else "UNAVAILABLE",
            "source": "NASA MOLA MEGDR 128 pixels/degree"}


def get_route_plan(state, **_):
    route = _get(state, "route")
    if not route or not route.get("coordinates"):
        return _unavailable("A planned route")
    return {"name": route.get("name"), "waypoint_count": len(route.get("coordinates") or []),
            "start": (route.get("coordinates") or [{}])[0], "end": (route.get("coordinates") or [{}])[-1],
            "metrics": route.get("metrics"), "generation_method": route.get("generation_method"),
            "warnings": route.get("warnings")}


def get_route_candidates(state, **_):
    candidates = _get(state, "route_candidates", "candidates") or []
    if not candidates:
        return _unavailable("Generated route candidates")
    return _clip({
        "count": len(candidates),
        "selected_candidate_id": _get(state, "route_candidates", "selected_id"),
        "objective_optima": _get(state, "route_candidates", "methodology", "objective_optima"),
        "scalarisation": _get(state, "route_candidates", "methodology", "scalarisation"),
        "pareto": _get(state, "route_candidates", "pareto"),
        "candidates": [_metrics(c) for c in candidates],
    })


def get_saved_routes(state, **_):
    routes = _get(state, "saved_routes") or []
    return _clip({"count": len(routes), "routes": [_metrics(r) for r in routes]}) if routes else _unavailable("Saved routes")


def compare_routes(state, route_ids: list[str] | None = None, **_):
    pool = (_get(state, "saved_routes") or []) + (_get(state, "route_candidates", "candidates") or [])
    if route_ids:
        pool = [r for r in pool if r.get("id") in route_ids or r.get("name") in route_ids]
    if not pool:
        return _unavailable("Routes to compare")
    return _clip({
        "count": len(pool),
        "routes": [_metrics(r) for r in pool],
        "note": "Present measurable trade-offs. Do not declare an overall winner.",
    })


def get_rover_photos(state, **_):
    media = _get(state, "media", "photos") or []
    if not media:
        return {"status": "NO PHOTOS AVAILABLE", "detail": "No rover/NASA media is associated with the current site."}
    return _clip({"count": len(media), "photos": [{k: p.get(k) for k in ("title", "source", "nasa_url", "date_created", "rover", "camera", "nasa_id")} for p in media]})


def get_USGS_features(state, radius_km: float = 100.0, **_):
    from science.routing.evidence import collect_usgs_features

    selection = _get(state, "selection") or {}
    lat, lon = selection.get("latitude_deg"), selection.get("longitude_deg")
    if lat is None or lon is None:
        return _unavailable("A selected coordinate")
    items = collect_usgs_features(float(lat), float(lon), min(float(radius_km), 500.0))
    return _clip({"count": len(items), "radius_km": radius_km, "source": "USGS Gazetteer of Planetary Nomenclature (IAU)",
                  "features": [{"name": i.name, "type": i.extra.get("feature_type"), "diameter_km": i.extra.get("diameter_km"),
                                "latitude_deg": i.latitude_deg, "longitude_deg": i.longitude_deg, "url": i.url} for i in items[:60]]})


def get_THEMIS_context(state, radius_km: float = 50.0, **_):
    from science.routing.evidence import collect_themis

    selection = _get(state, "selection") or {}
    lat, lon = selection.get("latitude_deg"), selection.get("longitude_deg")
    if lat is None or lon is None:
        return _unavailable("A selected coordinate")
    try:
        items = collect_themis(float(lat), float(lon), min(float(radius_km), 300.0))
    except Exception as exc:
        return {"status": "THERMAL DATA UNAVAILABLE", "error": str(exc)[:200]}
    if not items:
        return {"status": "THERMAL DATA UNAVAILABLE", "detail": f"No THEMIS IR-PBT observation within {radius_km} km."}
    temps = [i.extra.get("brightness_temperature_k") for i in items if i.extra.get("brightness_temperature_k") is not None]
    return {"status": "NASA OBSERVED", "source": "NASA THEMIS IR-PBT (Mars Odyssey)", "count": len(items),
            "radius_km": radius_km, "brightness_temperature_k": {"min": min(temps), "max": max(temps),
            "mean": round(sum(temps) / len(temps), 2)} if temps else "UNAVAILABLE",
            "measurement": "Historical brightness temperature; not a live or forecast temperature.",
            "examples": [{"product_id": i.name, "k": i.extra.get("brightness_temperature_k"),
                          "observation_start": i.timestamp, "solar_longitude_deg": i.extra.get("solar_longitude_deg")} for i in items[:8]]}


def get_Mars_weather_context(state, **_):
    environment = _get(state, "environment") or {}
    return {"dust": environment.get("dust") or "UNAVAILABLE",
            "dust_status": "MODELED — NASA Ames Mars GCM MY34 dust scenario, not a live forecast",
            "solar": environment.get("solar") or "UNAVAILABLE",
            "assessment": environment.get("assessment") or "UNAVAILABLE",
            "live_weather_feed": "NOT CONNECTED"}


def get_NASA_briefing(state, limit: int = 5, **_):
    try:
        from science.weather.api.environment import mars_briefing

        payload = mars_briefing(limit=min(int(limit), 10))
    except Exception as exc:
        return {"status": "unavailable", "error": str(exc)[:200]}
    return _clip({"status": payload.get("status"), "source": payload.get("source"),
                  "items": [{k: item.get(k) for k in ("title", "url", "published")} for item in payload.get("items", [])]})


def get_safe_havens(state, **_):
    havens = _get(state, "safe_havens") or []
    return {"count": len(havens), "note": "User-defined planning locations. Not established as physically safe.",
            "safe_havens": havens[:50], "nearest_to_route": _get(state, "route", "nearest_safe_haven")} if havens else _unavailable("Safe Havens")


def get_custom_places(state, **_):
    places = _get(state, "custom_places") or []
    return {"count": len(places), "places": places[:50]} if places else _unavailable("Custom places")


def get_orbital_small_body_alerts(state, days: int = 365, dist_max_au: float = 0.05, **_):
    from science.orbital.small_bodies import get_near_mars_tracking

    payload = get_near_mars_tracking(days=int(days), dist_max_au=float(dist_max_au), limit=50)
    objects = payload.get("objects", [])[:15]
    return _clip({"status": payload.get("status"), "tracking_status": payload.get("tracking_status"),
                  "source": payload.get("source"), "retrieved_at": payload.get("retrieved_at"),
                  "classification_basis": payload.get("classification_basis"), "limitations": payload.get("limitations"),
                  "count": payload.get("count"), "error": payload.get("error"),
                  "objects": [{k: o.get(k) for k in ("object", "designation", "close_approach_tdb", "distance_au",
                               "distance_km", "distance_min_au", "distance_max_au", "relative_velocity_km_s",
                               "time_sigma_raw", "diameter_km", "tracking_status", "sbdb_url")} for o in objects]})


def get_mission_console_state(state, **_):
    console = _get(state, "mission_console")
    return _clip(console) if console else _unavailable("Mission console state")


def get_project_provenance(state, **_):
    from science.provenance import source_ledger

    return _clip({"ledger": source_ledger(), "mission_state_provenance": _get(state, "provenance")})


TOOLS: dict[str, Callable[..., Any]] = {
    "get_selected_location": get_selected_location,
    "get_selected_feature": get_selected_feature,
    "get_environment": get_environment,
    "get_terrain_analysis": get_terrain_analysis,
    "get_route_plan": get_route_plan,
    "get_route_candidates": get_route_candidates,
    "get_saved_routes": get_saved_routes,
    "compare_routes": compare_routes,
    "get_rover_photos": get_rover_photos,
    "get_USGS_features": get_USGS_features,
    "get_THEMIS_context": get_THEMIS_context,
    "get_Mars_weather_context": get_Mars_weather_context,
    "get_NASA_briefing": get_NASA_briefing,
    "get_safe_havens": get_safe_havens,
    "get_custom_places": get_custom_places,
    "get_orbital_small_body_alerts": get_orbital_small_body_alerts,
    "get_mission_console_state": get_mission_console_state,
    "get_project_provenance": get_project_provenance,
}

DECLARATIONS: list[dict[str, Any]] = [
    {"name": "get_selected_location", "description": "Currently selected Mars coordinate, its label and selection mode.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_selected_feature", "description": "Selected USGS/IAU named feature, if the selection is a named feature.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_environment", "description": "Environment at the selected site: THEMIS thermal, MGCM dust, solar geometry, MOLA terrain, assessment.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_terrain_analysis", "description": "MOLA-derived terrain for the site and the current route.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_route_plan", "description": "The route currently in the route editor with its deterministic metrics.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_route_candidates", "description": "AI-designed route candidates, their metrics, objective weights and Pareto status.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_saved_routes", "description": "Routes the user has saved.", "parameters": {"type": "object", "properties": {}}},
    {"name": "compare_routes", "description": "Compare saved and candidate routes on measurable metrics.", "parameters": {"type": "object", "properties": {"route_ids": {"type": "array", "items": {"type": "string"}, "description": "Optional route ids or names to restrict the comparison."}}}},
    {"name": "get_rover_photos", "description": "NASA rover/media metadata associated with the selected site.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_USGS_features", "description": "USGS/IAU named features near the selected coordinate.", "parameters": {"type": "object", "properties": {"radius_km": {"type": "number", "description": "Search radius in km (default 100)."}}}},
    {"name": "get_THEMIS_context", "description": "Historical NASA THEMIS IR-PBT brightness-temperature observations near the selected coordinate.", "parameters": {"type": "object", "properties": {"radius_km": {"type": "number", "description": "Search radius in km (default 50)."}}}},
    {"name": "get_Mars_weather_context", "description": "Modelled dust and solar context for the selected site.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_NASA_briefing", "description": "Recent items from the NASA Science Mars photojournal feed.", "parameters": {"type": "object", "properties": {"limit": {"type": "integer"}}}},
    {"name": "get_safe_havens", "description": "User-defined Safe Havens and their relationship to the route.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_custom_places", "description": "User-created custom places.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_orbital_small_body_alerts", "description": "Live NASA/JPL near-Mars small-body close approaches with distances and uncertainties.", "parameters": {"type": "object", "properties": {"days": {"type": "integer", "description": "Horizon in days (default 365)."}, "dist_max_au": {"type": "number", "description": "Maximum close-approach distance in au (default 0.05)."}}}},
    {"name": "get_mission_console_state", "description": "Derived Crewed Mars Console state: mission, crew, vehicles, EVA, radiation, life support, resources.", "parameters": {"type": "object", "properties": {}}},
    {"name": "get_project_provenance", "description": "NeuroNexus data-source ledger and evidence classes.", "parameters": {"type": "object", "properties": {}}},
]


def call_tool(name: str, arguments: dict[str, Any], state: dict[str, Any]) -> Any:
    tool = TOOLS.get(name)
    if tool is None:
        return {"error": f"Unknown tool: {name}"}
    try:
        return tool(state, **(arguments or {}))
    except Exception as exc:  # a failing tool must not break the conversation
        return {"status": "TOOL ERROR", "tool": name, "error": str(exc)[:300]}
