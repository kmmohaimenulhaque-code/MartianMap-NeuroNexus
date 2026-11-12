"""Real data for the 3D Mars view.

- Rover traverses: NASA MMGIS GeoJSON (Curiosity, Perseverance), cached and
  decimated for rendering.
- Local terrain grid: a BOUNDED NASA MOLA 128 ppd window around a site
  (reuses the route engine's loader; never a global raster), with slope,
  roughness and a clearly labelled NeuroNexus-derived walkability score.
- Exploration context: documented locations (USGS/IAU gazetteer coordinates)
  for ancient-habitability missions and SWIM accessible-ice study regions.
  The SWIM ice-consensus raster itself is NOT integrated and is reported as
  UNAVAILABLE.
"""

from __future__ import annotations

import json
import math
import threading
import time
import urllib.request
from typing import Any

import numpy as np

USER_AGENT = "Mozilla/5.0 (compatible; NeuroNexus-MarsMap/2.0)"
TRAVERSE_CACHE_S = 6 * 3600
MAX_TRAVERSE_VERTICES = 4000

TRAVERSES = [
    {
        "id": "msl-curiosity",
        "rover": "Curiosity (MSL)",
        "source_url": "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json",
        "mission_url": "https://science.nasa.gov/mission/msl-curiosity/",
        "colour": "#ffd166",
    },
    {
        "id": "m2020-perseverance",
        "rover": "Perseverance (Mars 2020)",
        "source_url": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json",
        "mission_url": "https://science.nasa.gov/mission/mars-2020-perseverance/",
        "colour": "#ff8fa3",
    },
]

_lock = threading.Lock()
_traverse_cache: dict[str, Any] = {"at": 0.0, "payload": None}


def _get_json(url: str, timeout: float = 30.0) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _lines(geometry: dict[str, Any]) -> list[list[list[float]]]:
    if geometry.get("type") == "LineString":
        return [geometry["coordinates"]]
    if geometry.get("type") == "MultiLineString":
        return list(geometry["coordinates"])
    return []


def _decimate(points: list[list[float]], limit: int) -> list[list[float]]:
    if len(points) <= limit:
        return points
    step = math.ceil(len(points) / limit)
    kept = points[::step]
    if kept[-1] != points[-1]:
        kept.append(points[-1])
    return kept


def rover_traverses(fetch=_get_json, use_cache: bool = True) -> dict[str, Any]:
    with _lock:
        if use_cache and _traverse_cache["payload"] and time.time() - _traverse_cache["at"] < TRAVERSE_CACHE_S:
            return _traverse_cache["payload"]
    from concurrent.futures import ThreadPoolExecutor

    def _load(spec):
        try:
            return spec, fetch(spec["source_url"]), None
        except Exception as exc:  # one rover failing never breaks the layer
            return spec, None, exc

    with ThreadPoolExecutor(max_workers=len(TRAVERSES)) as pool:
        loaded = list(pool.map(_load, TRAVERSES))
    rovers = []
    for spec, collection, error in loaded:
        try:
            if error is not None:
                raise error
            vertices: list[list[float]] = []
            sols: list[int] = []
            for feature in collection.get("features", []):
                for line in _lines(feature.get("geometry") or {}):
                    for point in line:
                        lon, lat = float(point[0]), float(point[1])
                        if vertices and vertices[-1][0] == lon and vertices[-1][1] == lat:
                            continue
                        vertices.append([lon, lat])
                sol = (feature.get("properties") or {}).get("sol")
                if isinstance(sol, (int, float)):
                    sols.append(int(sol))
            path = _decimate(vertices, MAX_TRAVERSE_VERTICES)
            rovers.append({
                **spec, "status": "OBSERVED" if path else "UNAVAILABLE",
                "path": [[round(lon, 6), round(lat, 6)] for lon, lat in path],
                "vertex_count_source": len(vertices), "vertex_count_rendered": len(path),
                "latest_sol": max(sols) if sols else None,
                "start": path[0] if path else None, "end": path[-1] if path else None,
            })
        except Exception as exc:  # one rover failing never breaks the layer
            rovers.append({**spec, "status": "UNAVAILABLE", "path": [], "error": str(exc)[:200]})
    payload = {
        "status": "ok" if any(r["path"] for r in rovers) else "unavailable",
        "source": "NASA Multi-Mission Geographic Information System (MMGIS) rover traverse layers",
        "coordinate_system": "Mars 2000 planetocentric, east-positive longitude (-180..180)",
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rovers": rovers,
    }
    with _lock:
        _traverse_cache.update(at=time.time(), payload=payload)
    return payload


# ------------------------------------------------------------ local terrain

WALKABILITY_REFERENCES = {"slope_deg": 25.0, "roughness_m": 50.0, "relief_m": 200.0}
WALKABILITY_WEIGHTS = {"slope": 0.55, "roughness": 0.30, "relief": 0.15}
WALKABILITY_METHOD = (
    "NEURONEXUS DERIVED WALKABILITY = 100 x (1 - min(1, 0.55*slope/25deg + 0.30*roughness/50m + "
    "0.15*relief/200m)), per cell, from NASA MOLA 128 ppd slope, roughness and local relief. "
    "A relative planning aid for comparing nearby terrain; not a NASA or mission safety certification "
    "and not a statement that any place is the best or safe place to walk."
)


def walkability(slope_deg: float, roughness_m: float, relief_m: float) -> float:
    cost = (
        WALKABILITY_WEIGHTS["slope"] * slope_deg / WALKABILITY_REFERENCES["slope_deg"]
        + WALKABILITY_WEIGHTS["roughness"] * roughness_m / WALKABILITY_REFERENCES["roughness_m"]
        + WALKABILITY_WEIGHTS["relief"] * relief_m / WALKABILITY_REFERENCES["relief_m"]
    )
    return round(100.0 * (1.0 - min(1.0, max(0.0, cost))), 1)


def local_terrain_grid(latitude: float, longitude: float, half_width_km: float = 20.0,
                       max_cells: int = 30, loader=None) -> dict[str, Any]:
    """Bounded MOLA window around a site, coarsened to at most max_cells x max_cells."""
    from science.routing.engine import MAX_WINDOW_KM, load_grid
    from science.routing.metrics import MARS_RADIUS_KM

    half = float(min(max(half_width_km, 2.0), MAX_WINDOW_KM / 2.0))
    dlat = math.degrees(half / MARS_RADIUS_KM)
    dlon = dlat / max(math.cos(math.radians(latitude)), 0.05)
    window = {
        "lat_min": latitude - dlat, "lat_max": latitude + dlat,
        "lon_min": longitude - dlon, "lon_max": longitude + dlon,
        "width_km": 2 * half, "height_km": 2 * half,
        "center_latitude_deg": latitude, "center_longitude_deg": longitude,
    }
    grid = (loader or load_grid)(window)
    rows, cols = grid.elevation_m.shape
    step = max(1, math.ceil(max(rows, cols) / max_cells))
    lat_edges = np.asarray(grid.latitudes_deg)
    lon_edges = np.asarray(grid.longitudes_deg)
    cells = []
    for r in range(0, rows, step):
        for c in range(0, cols, step):
            block = np.s_[r:r + step, c:c + step]
            elevation = grid.elevation_m[block]
            slope = grid.slope_deg[block]
            rough = grid.roughness_m[block]
            if not (np.isfinite(elevation).any() and np.isfinite(slope).any()):
                continue
            relief = float(np.nanmax(elevation) - np.nanmin(elevation))
            s, k = float(np.nanmean(slope)), float(np.nanmean(rough))
            lats = lat_edges[r:r + step]
            lons = lon_edges[c:c + step]
            cells.append({
                "lat_min": round(float(lats.min()), 5), "lat_max": round(float(lats.max()), 5),
                "lon_min": round(float(lons.min()) % 360.0, 5), "lon_max": round(float(lons.max()) % 360.0, 5),
                "elevation_m": round(float(np.nanmean(elevation)), 1),
                "slope_deg": round(s, 2), "roughness_m": round(k, 2), "relief_m": round(relief, 1),
                "walkability": walkability(s, k, relief),
            })
    return {
        "status": "ok",
        "center": {"latitude_deg": latitude, "longitude_deg": longitude % 360.0},
        "half_width_km": half,
        "cell_size_deg": round(abs(float(lat_edges[1] - lat_edges[0])) * step, 6) if len(lat_edges) > 1 else None,
        "cells": cells,
        "source": grid.source,
        "dataset": grid.dataset,
        "layers": {
            "slope": {"status": "DERIVED", "from": "NASA MOLA 128 ppd (OBSERVED)"},
            "roughness": {"status": "DERIVED", "from": "NASA MOLA 128 ppd (OBSERVED)"},
            "walkability": {"status": "DERIVED", "method": WALKABILITY_METHOD,
                            "weights": WALKABILITY_WEIGHTS, "references": WALKABILITY_REFERENCES},
        },
    }


# ------------------------------------------------------------ exploration context

ANCIENT_HABITABILITY = [
    {"name": "Gale", "mission": "Curiosity (MSL)", "url": "https://science.nasa.gov/mission/msl-curiosity/",
     "evidence": "Ancient lake-bed mudstones with clays and organic molecules: an environment that could have "
                 "supported microbial life billions of years ago."},
    {"name": "Jezero", "mission": "Perseverance (Mars 2020)", "url": "https://science.nasa.gov/mission/mars-2020-perseverance/",
     "evidence": "Ancient river delta and lake deposits; samples cached for possible return."},
    {"name": "Meridiani Planum", "mission": "Opportunity (MER-B)", "url": "https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/",
     "evidence": "Hematite concretions and sulfate-rich rocks formed in ancient acidic water."},
    {"name": "Gusev", "mission": "Spirit (MER-A)", "url": "https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/",
     "evidence": "Silica-rich deposits near Home Plate consistent with ancient hot-spring or fumarole activity."},
]

SWIM_STUDY_REGIONS = [
    {"name": "Arcadia Planitia", "note": "Mid-latitude plains repeatedly identified by SWIM as a candidate for shallow, accessible water ice."},
    {"name": "Deuteronilus Mensae", "note": "Lobate debris aprons and lineated valley fill interpreted as buried glacial ice."},
    {"name": "Utopia Planitia", "note": "Scalloped terrain and radar evidence of a large subsurface ice deposit."},
    {"name": "Phlegra Montes", "note": "Debris-covered glacial landforms in the northern mid-latitudes."},
]

SWIM_SOURCES = {
    "swim_products": "https://swim.psi.edu/SWIM4MIMProducts.php",
    "nasa_mars_water_maps": "https://ammos.nasa.gov/marswatermaps/?mission=MWR",
    "jpl_feature": "https://www.jpl.nasa.gov/news/where-should-future-astronauts-land-on-mars-follow-the-water",
}


def _locate(name: str) -> dict[str, Any] | None:
    from science.routing.evidence import _gazetteer

    matches = [m for m in _gazetteer().find(name) if str(m.get("feature_name", "")).lower() == name.lower()]
    if not matches:
        return None
    m = matches[0]
    return {"latitude_deg": float(m["latitude_deg"]), "longitude_deg": float(m["longitude_deg"]) % 360.0,
            "feature_type": m.get("feature_type"), "usgs_feature_url": m.get("usgs_feature_url")}


def exploration_context() -> dict[str, Any]:
    ancient = []
    for site in ANCIENT_HABITABILITY:
        where = _locate(site["name"])
        if where:
            ancient.append({**site, **where, "status": "OBSERVED",
                            "classification": "ANCIENT HABITABILITY EVIDENCE (not present-day habitability)"})
    regions = []
    for region in SWIM_STUDY_REGIONS:
        where = _locate(region["name"])
        if where:
            regions.append({**region, **where, "status": "DERIVED",
                            "classification": "DOCUMENTED ACCESSIBLE-ICE STUDY REGION (centroid from USGS/IAU gazetteer)"})
    return {
        "status": "ok",
        "ancient_habitability": ancient,
        "ice_study_regions": regions,
        "layers": {
            "swim_water_ice": {
                "status": "UNAVAILABLE",
                "reason": "The SWIM ice-consensus GeoTIFFs (~70 MB each, slow host) are not integrated into "
                          "NeuroNexus. Region markers below are documented study areas, not the ice map itself.",
                "sources": SWIM_SOURCES,
            },
            "human_exploration_context": {
                "status": "DERIVED",
                "method": "Per site: latitude band, MOLA elevation, distance to the nearest documented SWIM study "
                          "region. Context only; not a landing-site certification.",
            },
            "ancient_habitability": {
                "status": "OBSERVED",
                "note": "Ancient habitability evidence from rover investigations; no present-day habitability is implied.",
            },
        },
        "boundary": "No region is labelled NASA-certified safe or universally the best place to walk or land.",
    }


# ------------------------------------------------------------ potential exploration zones

PEZ_CRITERIA = {
    "walkability_min": 70.0,
    "slope_max_deg": 5.0,
    "elevation_max_m": 0.0,
    "ice_band_abs_latitude_deg": [30.0, 50.0],
}
PEZ_METHOD = (
    "DERIVED — NEURONEXUS. Within a bounded +/-30 km NASA MOLA 128 ppd window, a cell is a candidate when "
    "NeuroNexus walkability >= 70, mean slope <= 5 deg and elevation <= 0 m (below the MOLA datum, i.e. more "
    "atmosphere above the surface for entry, descent and landing). The zone reports whether its centre lies in the "
    "30-50 deg latitude band where SWIM documents accessible shallow-ice study regions. Exploration context only: "
    "not a NASA-certified safe zone, no guarantee of habitability and no confirmed resource."
)
PEZ_CACHE: dict[str, dict[str, Any]] = {}


def _cell_area_km2(cell: dict[str, Any]) -> float:
    from science.routing.metrics import MARS_RADIUS_KM

    dlat = math.radians(abs(cell["lat_max"] - cell["lat_min"]))
    dlon = math.radians(abs(((cell["lon_max"] - cell["lon_min"]) + 180.0) % 360.0 - 180.0))
    lat = math.radians((cell["lat_max"] + cell["lat_min"]) / 2.0)
    return (MARS_RADIUS_KM ** 2) * dlat * dlon * math.cos(lat)


def evaluate_exploration_zone(name: str, latitude: float, longitude: float, *, context: str,
                              loader=None, half_width_km: float = 30.0) -> dict[str, Any]:
    key = f"{name}:{latitude:.3f}:{longitude % 360.0:.3f}"
    if loader is None and key in PEZ_CACHE:
        return PEZ_CACHE[key]
    base = {"name": name, "latitude_deg": latitude, "longitude_deg": longitude % 360.0, "context": context,
            "criteria": PEZ_CRITERIA, "classification": "POTENTIAL EXPLORATION ZONE — DERIVED — NEURONEXUS"}
    try:
        grid = local_terrain_grid(latitude, longitude, half_width_km=half_width_km, max_cells=24, loader=loader)
    except Exception as exc:
        return {**base, "status": "UNAVAILABLE", "reason": f"MOLA terrain unavailable here: {str(exc)[:160]}",
                "cells": [], "extent": None}
    cells = grid["cells"]
    passing = [c for c in cells if c["walkability"] >= PEZ_CRITERIA["walkability_min"]
               and c["slope_deg"] <= PEZ_CRITERIA["slope_max_deg"] and c["elevation_m"] <= PEZ_CRITERIA["elevation_max_m"]]
    lo, hi = PEZ_CRITERIA["ice_band_abs_latitude_deg"]
    total_area = sum(_cell_area_km2(c) for c in cells) or 1.0
    zone_area = sum(_cell_area_km2(c) for c in passing)
    mean = lambda key: round(sum(c[key] for c in passing) / len(passing), 2) if passing else None  # noqa: E731
    result = {
        **base,
        "status": "DERIVED" if passing else "NO CANDIDATE CELLS",
        "in_ice_study_latitude_band": lo <= abs(latitude) <= hi,
        "candidate_area_km2": round(zone_area, 1),
        "candidate_fraction": round(zone_area / total_area, 3),
        "mean_walkability": mean("walkability"),
        "mean_slope_deg": mean("slope_deg"),
        "mean_roughness_m": mean("roughness_m"),
        "mean_elevation_m": mean("elevation_m"),
        "cells": passing,
        "extent": {
            "lat_min": min(c["lat_min"] for c in passing), "lat_max": max(c["lat_max"] for c in passing),
            "lon_min": min(c["lon_min"] for c in passing), "lon_max": max(c["lon_max"] for c in passing),
        } if passing else None,
        "window_half_width_km": grid["half_width_km"],
        "source": grid["source"],
    }
    if loader is None:
        PEZ_CACHE[key] = result
    return result


def exploration_zones(site: dict[str, Any] | None = None, loader=None) -> dict[str, Any]:
    zones = []
    for region in SWIM_STUDY_REGIONS:
        where = _locate(region["name"])
        if where:
            zones.append(evaluate_exploration_zone(region["name"], where["latitude_deg"], where["longitude_deg"],
                                                   context="Documented accessible-ice study region (SWIM literature)", loader=loader))
    if site is not None:
        zones.append(evaluate_exploration_zone("Selected site", float(site["latitude_deg"]), float(site["longitude_deg"]),
                                               context="Currently selected NeuroNexus site", loader=loader))
    return {
        "status": "ok",
        "label": "POTENTIAL EXPLORATION ZONES — DERIVED — NEURONEXUS",
        "method": PEZ_METHOD,
        "criteria": PEZ_CRITERIA,
        "zones": zones,
        "boundary": "Not an official NASA zone. No zone is certified safe, habitable or resource-confirmed.",
    }
