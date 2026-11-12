"""Deterministic route metrics, terrain-risk proxy and Pareto filtering.

Every formula here is documented in METHODOLOGY and returned to clients.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

import numpy as np

MARS_RADIUS_KM = 3396.0  # identical to science.terrain.route_geometry

REFERENCES: dict[str, float] = {
    "burden_slope_deg": 25.0,
    "burden_roughness_m": 50.0,
    "risk_max_slope_deg": 30.0,
    "risk_p90_slope_deg": 20.0,
    "risk_max_roughness_m": 100.0,
    "risk_relief_m_per_km": 100.0,
    "risk_length_km": 20.0,
    "operational_reference_km": 10.0,
}

BURDEN_WEIGHTS: dict[str, float] = {"slope": 0.6, "roughness": 0.4}

RISK_WEIGHTS: dict[str, float] = {
    "max_slope": 0.35,
    "p90_slope": 0.25,
    "max_roughness": 0.20,
    "relief_per_km": 0.10,
    "length": 0.10,
}

METHODOLOGY: dict[str, Any] = {
    "name": "NEURONEXUS DERIVED TERRAIN-RISK PROXY",
    "certification": (
        "Research aid only. Not NASA-certified, not mission-certified and not an "
        "astronaut safety certification. No route is labelled safe."
    ),
    "terrain_input": "NASA MOLA MEGDR 128 pixels/degree elevation; slope and 3x3 roughness from science.terrain.derivatives",
    "distance": "Haversine great-circle distance on a 3396.0 km sphere (same as /terrain/route-plan).",
    "estimated_eva_time": (
        "ESTIMATED EVA TIME = distance_km / eva_pace_kmh + elevation_gain_m / ascent_allowance_m_per_h "
        "(Naismith-style ascent allowance, Earth heuristic, configurable; set to 0 for the original "
        "distance/pace model). Not operational flight data."
    ),
    "terrain_burden_score": (
        "100 * mean over evenly spaced route samples of "
        "[0.6 * min(slope/25 deg, 1) + 0.4 * min(roughness/50 m, 1)]"
    ),
    "terrain_risk_proxy": (
        "100 * [0.35*min(max_slope/30 deg,1) + 0.25*min(p90_slope/20 deg,1) + "
        "0.20*min(max_roughness/100 m,1) + 0.10*min((gain+loss)/(distance_km*100 m),1) + "
        "0.10*min(distance_km/20 km,1)]"
    ),
    "normalisation": "Each input is divided by a fixed reference value and clipped to [0, 1]; references are NeuroNexus planning choices, not NASA limits.",
    "operational_burden_score": (
        "100 * mean over route samples of min(distance to nearest Safe Haven / 10 km, 1). "
        "If no Safe Haven exists, distance to the route start (return-path exposure) is used."
    ),
    "science_opportunity_score": (
        "100 * (catalogued evidence items within their engagement radius of the route) / "
        "(evidence items catalogued in the planning window). UNAVAILABLE when the window "
        "contains no ingested evidence."
    ),
    "data_support_score": "100 * fraction of route samples with a finite MOLA elevation inside the planning window.",
    "pareto": (
        "A candidate is PARETO / NON-DOMINATED when no other candidate is <= on every objective "
        "(EVA hours, terrain burden, risk proxy, operational burden, -science) and < on at least one. "
        "Objectives UNAVAILABLE for any candidate are excluded from the comparison."
    ),
    "limitations": [
        "MOLA MEGDR (~463 m/pixel at the equator) cannot resolve boulders, small craters or metre-scale hazards.",
        "Slope is computed on the MOLA grid and underestimates short steep slopes.",
        "Reference values are planning choices; they are not rover or suit limits.",
        "Science score measures proximity to catalogued evidence, not confirmed scientific value.",
    ],
}


def finite_or_none(value: Any, digits: int | None = None) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(number, digits) if digits is not None else number


def haversine_km(lat1, lon1, lat2, lon2):
    lat1 = np.radians(lat1)
    lat2 = np.radians(lat2)
    dlat = lat2 - lat1
    dlon = np.radians((np.asarray(lon2) - np.asarray(lon1) + 180.0) % 360.0 - 180.0)
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0) ** 2
    a = np.clip(a, 0.0, 1.0)
    return 2.0 * MARS_RADIUS_KM * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))


def unwrap_longitude(longitude: float, reference: float) -> float:
    return reference + ((float(longitude) - reference + 180.0) % 360.0) - 180.0


def polyline_distance_km(coordinates: Sequence[tuple[float, float]]) -> float:
    if len(coordinates) < 2:
        return 0.0
    lat = np.array([c[0] for c in coordinates], dtype=float)
    lon = np.array([c[1] for c in coordinates], dtype=float)
    return float(np.sum(haversine_km(lat[:-1], lon[:-1], lat[1:], lon[1:])))


def densify(coordinates: Sequence[tuple[float, float]], spacing_km: float) -> tuple[np.ndarray, np.ndarray]:
    """Evenly spaced samples along a polyline (linear in lat/lon per short leg)."""
    lats: list[float] = []
    lons: list[float] = []
    reference = float(coordinates[0][1])
    unwrapped = [(float(lat), unwrap_longitude(lon, reference)) for lat, lon in coordinates]
    for (lat_a, lon_a), (lat_b, lon_b) in zip(unwrapped, unwrapped[1:]):
        length = float(haversine_km(lat_a, lon_a, lat_b, lon_b))
        steps = max(1, int(math.ceil(length / max(spacing_km, 1e-6))))
        t = np.arange(steps) / steps
        lats.extend((lat_a + (lat_b - lat_a) * t).tolist())
        lons.extend((lon_a + (lon_b - lon_a) * t).tolist())
    lats.append(unwrapped[-1][0])
    lons.append(unwrapped[-1][1])
    return np.asarray(lats), np.asarray(lons)


def burden_density(slope_deg, roughness_m):
    s = np.clip(np.asarray(slope_deg, dtype=float) / REFERENCES["burden_slope_deg"], 0.0, 1.0)
    r = np.clip(np.asarray(roughness_m, dtype=float) / REFERENCES["burden_roughness_m"], 0.0, 1.0)
    return BURDEN_WEIGHTS["slope"] * s + BURDEN_WEIGHTS["roughness"] * r


def terrain_risk_proxy(
    *,
    max_slope_deg: float | None,
    p90_slope_deg: float | None,
    max_roughness_m: float | None,
    elevation_gain_m: float | None,
    elevation_loss_m: float | None,
    distance_km: float | None,
) -> tuple[float | None, dict[str, float] | None]:
    inputs = [max_slope_deg, p90_slope_deg, max_roughness_m, elevation_gain_m, elevation_loss_m, distance_km]
    if any(value is None for value in inputs):
        return None, None
    distance = max(float(distance_km), 1e-6)
    components = {
        "max_slope": min(float(max_slope_deg) / REFERENCES["risk_max_slope_deg"], 1.0),
        "p90_slope": min(float(p90_slope_deg) / REFERENCES["risk_p90_slope_deg"], 1.0),
        "max_roughness": min(float(max_roughness_m) / REFERENCES["risk_max_roughness_m"], 1.0),
        "relief_per_km": min(
            (float(elevation_gain_m) + float(elevation_loss_m)) / (distance * REFERENCES["risk_relief_m_per_km"]),
            1.0,
        ),
        "length": min(distance / REFERENCES["risk_length_km"], 1.0),
    }
    components = {key: max(0.0, value) for key, value in components.items()}
    score = 100.0 * sum(RISK_WEIGHTS[key] * components[key] for key in RISK_WEIGHTS)
    return round(score, 3), {key: round(value, 4) for key, value in components.items()}


def estimate_eva_hours(distance_km: float | None, elevation_gain_m: float | None, pace_kmh: float, ascent_m_per_h: float) -> float | None:
    if distance_km is None:
        return None
    hours = float(distance_km) / float(pace_kmh)
    if ascent_m_per_h and ascent_m_per_h > 0:
        if elevation_gain_m is None:
            return None
        hours += float(elevation_gain_m) / float(ascent_m_per_h)
    return round(hours, 4)


def pareto_flags(vectors: Sequence[Sequence[float | None]]) -> tuple[list[bool], list[int]]:
    """Non-dominated flags for minimisation vectors.

    Dimensions containing None for any candidate are excluded (documented).
    Returns (flags, used_dimension_indices).
    """
    if not vectors:
        return [], []
    width = len(vectors[0])
    used = [d for d in range(width) if all(v[d] is not None for v in vectors)]
    flags: list[bool] = []
    for i, vi in enumerate(vectors):
        dominated = False
        for j, vj in enumerate(vectors):
            if i == j:
                continue
            le_all = all(float(vj[d]) <= float(vi[d]) + 1e-9 for d in used)
            lt_any = any(float(vj[d]) < float(vi[d]) - 1e-9 for d in used)
            if le_all and lt_any:
                dominated = True
                break
        flags.append(not dominated)
    return flags, used


def summarise_samples(
    *,
    elevation: np.ndarray,
    slope: np.ndarray,
    roughness: np.ndarray,
    valid: np.ndarray,
) -> dict[str, Any]:
    sample_count = int(valid.size)
    valid_count = int(np.count_nonzero(valid))
    out: dict[str, Any] = {
        "sample_count": sample_count,
        "valid_sample_count": valid_count,
        "data_support_score": round(100.0 * valid_count / sample_count, 2) if sample_count else None,
    }
    keys = [
        "mean_slope_deg", "max_slope_deg", "p90_slope_deg", "mean_roughness_m", "max_roughness_m",
        "elevation_min_m", "elevation_max_m", "elevation_gain_m", "elevation_loss_m", "terrain_burden_score",
    ]
    if valid_count < 2:
        out.update({key: None for key in keys})
        return out
    e = elevation[valid]
    s = slope[valid]
    r = roughness[valid]
    diffs = np.diff(e)
    out.update(
        {
            "mean_slope_deg": round(float(np.mean(s)), 3),
            "max_slope_deg": round(float(np.max(s)), 3),
            "p90_slope_deg": round(float(np.percentile(s, 90)), 3),
            "mean_roughness_m": round(float(np.mean(r)), 3),
            "max_roughness_m": round(float(np.max(r)), 3),
            "elevation_min_m": round(float(np.min(e)), 1),
            "elevation_max_m": round(float(np.max(e)), 1),
            "elevation_gain_m": round(float(np.sum(diffs[diffs > 0])), 1),
            "elevation_loss_m": round(float(-np.sum(diffs[diffs < 0])), 1),
            "terrain_burden_score": round(100.0 * float(np.mean(burden_density(s, r))), 3),
        }
    )
    return out


def iter_scalar(values: Iterable[Any]) -> list[float]:
    return [float(v) for v in values if finite_or_none(v) is not None]
