"""Near-Mars small-body close-approach tracking from NASA/JPL SSD CAD API.

Observation, tracking and mission-planning awareness only. No interception,
targeting or countermeasure logic exists or will be added here.
"""

from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import quote

AU_KM = 149597870.7
MARS_RADIUS_KM = 3389.5
JPL_CAD_URL = "https://ssd-api.jpl.nasa.gov/cad.api"
JPL_CAD_DOC = "https://ssd-api.jpl.nasa.gov/doc/cad.html"
SBDB_LOOKUP = "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr="

# Documented NeuroNexus display thresholds (NOT a NASA/JPL risk scale).
MARS_HILL_RADIUS_AU = 0.0066  # a(1-e)(m/3M)^(1/3) at perihelion ~ 0.98 million km
THRESHOLDS = {
    "high_priority_min_distance_au": MARS_HILL_RADIUS_AU,
    "review_nominal_distance_au": 0.01,
    "review_time_sigma_hours": 24.0,
    "review_distance_spread_au": 0.01,
    "monitoring_nominal_distance_au": 0.05,
}
BAND_BASIS = (
    "HIGH-PRIORITY MONITORING: 3-sigma minimum distance <= 0.0066 au (~Mars Hill-sphere radius at perihelion). "
    "REVIEW: nominal distance <= 0.01 au, or 3-sigma time uncertainty > 24 h, or (dist_max - dist_min) > 0.01 au. "
    "MONITORING: nominal distance <= 0.05 au. LOW-CONCERN: beyond 0.05 au. DATA ONLY: distance missing. "
    "These are NeuroNexus display thresholds, not impact probabilities or a NASA risk classification."
)

_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {}
CACHE_SECONDS = 900


def _default_fetch(params: dict[str, Any]) -> dict[str, Any]:
    from science.hazards.mars_hazard_engine import _fetch_json

    return _fetch_json(JPL_CAD_URL, params)


def parse_time_sigma(value: Any) -> tuple[float | None, bool]:
    """JPL t_sigma_f -> (minutes, is_upper_bound). Formats: '< 00:01', 'HH:MM', 'D_HH:MM'."""
    if value is None:
        return None, False
    text = str(value).strip()
    upper = text.startswith("<")
    text = text.lstrip("<").strip()
    match = re.fullmatch(r"(?:(\d+)_)?(\d{1,2}):(\d{2})", text)
    if not match:
        return None, False
    days = int(match.group(1) or 0)
    return float(days * 1440 + int(match.group(2)) * 60 + int(match.group(3))), upper


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def classify(dist: float | None, dist_min: float | None, dist_max: float | None, sigma_minutes: float | None) -> str:
    if dist is None:
        return "DATA ONLY"
    if dist_min is not None and dist_min <= THRESHOLDS["high_priority_min_distance_au"]:
        return "HIGH-PRIORITY MONITORING"
    spread = (dist_max - dist_min) if dist_max is not None and dist_min is not None else None
    if (
        dist <= THRESHOLDS["review_nominal_distance_au"]
        or (sigma_minutes is not None and sigma_minutes > THRESHOLDS["review_time_sigma_hours"] * 60)
        or (spread is not None and spread > THRESHOLDS["review_distance_spread_au"])
    ):
        return "REVIEW"
    if dist <= THRESHOLDS["monitoring_nominal_distance_au"]:
        return "MONITORING"
    return "LOW-CONCERN"


def parse_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    fields = payload.get("fields") or []
    index = {name: i for i, name in enumerate(fields)}
    records = []
    for row in payload.get("data") or []:
        def get(name):
            i = index.get(name)
            return row[i] if i is not None and i < len(row) else None

        dist, dmin, dmax = _num(get("dist")), _num(get("dist_min")), _num(get("dist_max"))
        sigma, upper = parse_time_sigma(get("t_sigma_f"))
        designation = str(get("des") or "").strip()
        records.append({
            "object": (str(get("fullname")).strip() if get("fullname") else designation),
            "designation": designation,
            "orbit_id": get("orbit_id"),
            "close_approach_jd_tdb": _num(get("jd")),
            "close_approach_tdb": get("cd"),
            "distance_au": dist,
            "distance_km": dist * AU_KM if dist is not None else None,
            "distance_mars_radii": dist * AU_KM / MARS_RADIUS_KM if dist is not None else None,
            "distance_min_au": dmin,
            "distance_max_au": dmax,
            "relative_velocity_km_s": _num(get("v_rel")),
            "v_infinity_km_s": _num(get("v_inf")),
            "time_sigma_raw": get("t_sigma_f"),
            "time_sigma_3sigma_minutes": sigma,
            "time_sigma_is_upper_bound": upper,
            "absolute_magnitude_h": _num(get("h")),
            "diameter_km": _num(get("diameter")),
            "diameter_sigma_km": _num(get("diameter_sigma")),
            "tracking_status": classify(dist, dmin, dmax, sigma),
            "sbdb_url": SBDB_LOOKUP + quote(designation),
            "source": "NASA/JPL SSD Small-Body Database Close-Approach Data API",
            "evidence_status": "NASA OBSERVED / ORBIT SOLUTION (JPL)",
        })
    return records


def get_near_mars_tracking(days: int = 365, dist_max_au: float = 0.05, limit: int = 50,
                           fetch: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
                           use_cache: bool = True) -> dict[str, Any]:
    days = min(max(int(days), 1), 3650)
    dist_max_au = min(max(float(dist_max_au), 0.001), 0.5)
    limit = min(max(int(limit), 1), 200)
    key = f"{days}:{dist_max_au}:{limit}"
    now = time.time()
    if use_cache and fetch is None:
        with _LOCK:
            hit = _CACHE.get(key)
            if hit and now - hit["t"] < CACHE_SECONDS:
                return {**hit["value"], "cache": "hit"}
    params = {
        "body": "Mars", "date-min": "now", "date-max": f"+{days}", "dist-max": str(dist_max_au),
        "neo": "false", "sort": "date", "limit": str(limit), "diameter": "true", "fullname": "true",
    }
    retrieved = datetime.now(timezone.utc).isoformat()
    base = {
        "subsystem": "NEAR-MARS SMALL-BODY TRACKING",
        "purpose": "Detection, tracking, close-approach awareness and mission planning only. Not a weapon or interception system.",
        "source": {"name": "NASA/JPL SSD Close-Approach Data (CAD) API", "url": JPL_CAD_URL, "documentation": JPL_CAD_DOC},
        "query": {**params, "body": "Mars"},
        "retrieved_at": retrieved,
        "thresholds": THRESHOLDS,
        "classification_basis": BAND_BASIS,
        "limitations": [
            "A close approach is not an impact prediction.",
            "Distances are between object and Mars centre (JPL nominal plus 3-sigma min/max).",
            "JPL CAD does not provide approach direction; any schematic orientation is illustrative.",
        ],
    }
    try:
        payload = (fetch or _default_fetch)(params)
        records = parse_records(payload)
        result = {**base, "status": "live", "tracking_status": "DATA SOURCE AVAILABLE",
                  "signature": payload.get("signature"), "count": len(records), "total": payload.get("total"),
                  "objects": records}
    except Exception as exc:
        return {**base, "status": "unavailable", "tracking_status": "DATA SOURCE UNAVAILABLE",
                "error": str(exc)[:300], "count": 0, "objects": [],
                "note": "No close-approach events are shown or inferred while the JPL source is unavailable."}
    if fetch is None:
        with _LOCK:
            _CACHE[key] = {"t": now, "value": result}
    return result
