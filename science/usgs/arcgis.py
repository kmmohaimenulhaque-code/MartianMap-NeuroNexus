"""Legitimate integration with the USGS SIM 3292 ArcGIS application.

Mechanisms used (no cross-origin DOM manipulation):
  * Web AppBuilder URL parameter `extent=xmin,ymin,xmax,ymax,wkt=<map WKT>`
    (jimu.js MapUrlParamsHandler applies it without reprojection when the WKT
    equals the map's spatial reference).
  * ArcGIS REST tile endpoint of the web map's own MOLA hillshade basemap.
  * ArcGIS REST FeatureServer `query` on the SIM 3292 geologic layers.
"""

from __future__ import annotations

import base64
import io
import json
import math
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait
from functools import lru_cache
from typing import Any

import numpy as np

from science.usgs.robinson import MARS_2000_SPHERE_RADIUS_M, forward, to_longitude_180

WAB_APP_ID = "fc004c3d21b64c398ed5458580ab7c58"
WAB_BASE_URL = "https://usgs.maps.arcgis.com/apps/webappviewer/index.html"
MAP_WKT = (
    'PROJCS["Robinson_clon0_Mars_2000_Sphere",GEOGCS["GCS_Mars_2000_Sphere",DATUM["<custom>",'
    'SPHEROID["<custom>",3396190.0,0.0]],PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Robinson"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],'
    'PARAMETER["Central_Meridian",0.0],UNIT["Meter",1.0]]'
)
TILE_SERVICE = (
    "https://tiles.arcgis.com/tiles/v01gqwM5QqNysAAi/arcgis/rest/services/"
    "MOLA_Hillshade_Robinson_128ppd_tif/MapServer"
)
FEATURE_SERVICE = (
    "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/"
    "Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer"
)
LAYERS = {"landing_sites": 0, "contacts": 1, "structures": 2, "units": 3}
TILE_ORIGIN = (-9055300.0, 13517700.0)
TILE_SIZE = 256
LOD_RESOLUTIONS = [33072.9828126323 / (2 ** level) for level in range(8)]
# The service advertises LODs 0-7 but only levels 0-5 are cached
# (maxScale 3,906,250 -> 1,033.53 m/pixel). Finer levels return HTTP 404,
# so NeuroNexus never requests them and reports the native limit honestly.
MAX_CACHED_LEVEL = 5
SNAPSHOT_BUDGET_S = 60.0  # whole USGS fetch for one snapshot, well inside a 120 s proxy limit
NATIVE_LIMIT_NOTE = (
    "USGS tile cache limit: level 5, 1,033.53 m/pixel. Smaller extents are "
    "upsampled for display; no detail beyond the cached resolution exists."
)
USER_AGENT = "NeuroNexus-MartianMap/2.0 (NASA Space Apps research prototype)"
SOURCE = {
    "map": "USGS SIM 3292 Geologic Map of Mars, 1:20M (Tanaka et al., 2014)",
    "map_url": "https://pubs.usgs.gov/sim/3292/",
    "app_url": f"{WAB_BASE_URL}?id={WAB_APP_ID}",
    "tiles": TILE_SERVICE,
    "features": FEATURE_SERVICE,
    "projection": "Robinson_clon0_Mars_2000_Sphere (R = 3,396,190 m); PROJ robin algorithm in NeuroNexus",
}


def project(latitude_deg: float, longitude_deg: float) -> tuple[float, float]:
    return forward(longitude_deg, latitude_deg, MARS_2000_SPHERE_RADIUS_M)


def extent_for(coordinates: list[tuple[float, float]], min_half_m: float = 40000.0, margin: float = 0.3) -> dict[str, float]:
    lons = [to_longitude_180(c[1]) for c in coordinates]
    if max(lons) - min(lons) > 180.0:
        raise ValueError("Route crosses the 180 deg meridian of the USGS Robinson map; split the route.")
    xy = [project(lat, lon) for lat, lon in coordinates]
    xs, ys = [p[0] for p in xy], [p[1] for p in xy]
    cx, cy = (min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0
    half = max(min_half_m, (max(xs) - min(xs)) * (0.5 + margin), (max(ys) - min(ys)) * (0.5 + margin))
    return {"xmin": cx - half, "ymin": cy - half, "xmax": cx + half, "ymax": cy + half}


def build_wab_sync_url(coordinates: list[tuple[float, float]], min_half_km: float = 40.0) -> dict[str, Any]:
    ext = extent_for(coordinates, min_half_m=min_half_km * 1000.0)
    value = f"{ext['xmin']:.1f},{ext['ymin']:.1f},{ext['xmax']:.1f},{ext['ymax']:.1f},wkt={MAP_WKT}"
    url = f"{WAB_BASE_URL}?id={WAB_APP_ID}&extent={urllib.parse.quote(value, safe='')}"
    return {"url": url, "extent": ext, "method": "Web AppBuilder `extent` URL parameter with the map's own WKT", "source": SOURCE}


# ---------------------------------------------------------------- REST helpers


def _get(url: str, params: dict[str, Any] | None = None, timeout: float = 15.0) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _post_json(url: str, data: dict[str, Any], timeout: float = 20.0) -> dict[str, Any]:
    body = urllib.parse.urlencode(data).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT,
                                                                "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(f"ArcGIS error: {payload['error']}")
    return payload


_RENDERER_LOCK = threading.Lock()
_RENDERER: dict[str, Any] = {}


@lru_cache(maxsize=1)  # the published renderer does not change; a failed fetch is not cached
def unit_colors() -> dict[str, str]:
    with _RENDERER_LOCK:
        if "colors" in _RENDERER:
            return _RENDERER["colors"]
    layer = json.loads(_get(f"{FEATURE_SERVICE}/{LAYERS['units']}", {"f": "json"}).decode("utf-8"))
    renderer = (layer.get("drawingInfo") or {}).get("renderer") or {}
    colors: dict[str, str] = {}
    for info in renderer.get("uniqueValueInfos", []) or []:
        rgba = ((info.get("symbol") or {}).get("color")) or [128, 128, 128, 255]
        colors[str(info.get("value"))] = "#{:02x}{:02x}{:02x}".format(*[int(v) for v in rgba[:3]])
    with _RENDERER_LOCK:
        _RENDERER["colors"] = colors
    return colors


def query_layer(layer: str, extent: dict[str, float], out_fields: str, return_geometry: bool, offset: float | None = None,
                geometry: dict[str, Any] | None = None, geometry_type: str = "esriGeometryEnvelope") -> list[dict[str, Any]]:
    geom = geometry or {**extent, "spatialReference": {"wkt": MAP_WKT}}
    params: dict[str, Any] = {
        "f": "json",
        "where": "1=1",
        "geometry": json.dumps(geom),
        "geometryType": geometry_type,
        "inSR": json.dumps({"wkt": MAP_WKT}),
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": out_fields,
        "returnGeometry": "true" if return_geometry else "false",
        "resultRecordCount": 250,
    }
    if offset:
        params["maxAllowableOffset"] = offset
    payload = _post_json(f"{FEATURE_SERVICE}/{LAYERS[layer]}/query", params)
    return payload.get("features", [])


# ---------------------------------------------------------------- tiles


# Snapshots are drawn up to ~1,000 CSS px wide on 2-3x screens; up to 2,048 px per side keeps the hillshade sharp
# there (level 5 whenever it fits) instead of stretching a coarser level.
SNAPSHOT_MAX_PX = 2048
MAX_TILES = 100  # 2,048 px is at most 9 x 9 tiles; this cap also bounds memory on a 512 MB instance
JPEG_QUALITY = 90  # hillshade has no hard edges; JPEG is ~4x smaller and ~10x cheaper to encode than PNG
BACKGROUND_RGB = (4, 8, 11)  # the snapshot panel background (#04080b) behind areas outside the map


def _choose_level(width_m: float, height_m: float, max_px: int = SNAPSHOT_MAX_PX) -> int:
    for level in range(MAX_CACHED_LEVEL, -1, -1):
        if max(width_m, height_m) / LOD_RESOLUTIONS[level] <= max_px:
            return level
    return 0


def stitch_tiles(extent: dict[str, float], level: int) -> dict[str, Any]:
    from PIL import Image

    res = LOD_RESOLUTIONS[level]
    span = TILE_SIZE * res
    col0 = int(math.floor((extent["xmin"] - TILE_ORIGIN[0]) / span))
    col1 = int(math.floor((extent["xmax"] - TILE_ORIGIN[0]) / span))
    row0 = int(math.floor((TILE_ORIGIN[1] - extent["ymax"]) / span))
    row1 = int(math.floor((TILE_ORIGIN[1] - extent["ymin"]) / span))
    if (col1 - col0 + 1) * (row1 - row0 + 1) > MAX_TILES:
        raise ValueError(f"Snapshot would need more than {MAX_TILES} tiles.")
    canvas = Image.new("RGBA", ((col1 - col0 + 1) * TILE_SIZE, (row1 - row0 + 1) * TILE_SIZE), (0, 0, 0, 0))
    jobs = [(r, c) for r in range(row0, row1 + 1) for c in range(col0, col1 + 1)]
    fetched = {"ok": 0, "missing": 0}

    def fetch(rc):
        r, c = rc
        try:
            return rc, _get(f"{TILE_SERVICE}/tile/{level}/{r}/{c}", timeout=12.0)
        except Exception:
            return rc, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        for (r, c), data in pool.map(fetch, jobs):
            if not data:
                fetched["missing"] += 1
                continue
            try:
                tile = Image.open(io.BytesIO(data)).convert("RGBA")
                canvas.paste(tile, ((c - col0) * TILE_SIZE, (r - row0) * TILE_SIZE))
                fetched["ok"] += 1
            except Exception:
                fetched["missing"] += 1
    left = int(round((extent["xmin"] - (TILE_ORIGIN[0] + col0 * span)) / res))
    top = int(round(((TILE_ORIGIN[1] - row0 * span) - extent["ymax"]) / res))
    width = int(round((extent["xmax"] - extent["xmin"]) / res))
    height = int(round((extent["ymax"] - extent["ymin"]) / res))
    image = canvas.crop((left, top, left + max(width, 1), top + max(height, 1)))
    # Upsample small extents so the snapshot is legible. The native cached
    # resolution is reported separately and is never overstated.
    scale = 1
    if max(image.width, image.height) < 480:
        scale = max(1, int(round(640 / max(image.width, image.height, 1))))
        image = image.resize((image.width * scale, image.height * scale), Image.NEAREST)
    flat = Image.new("RGB", image.size, BACKGROUND_RGB)
    flat.paste(image, mask=image.getchannel("A"))
    buffer = io.BytesIO()
    flat.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return {
        "data_uri": "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"),
        "width": image.width, "height": image.height,
        "source_width": width, "source_height": height,
        "display_scale": scale, "tiles": fetched, "level": level,
        "native_resolution_m_per_px": res,
        "display_resolution_m_per_px": res / scale,
        "resolution_note": NATIVE_LIMIT_NOTE,
    }


# ---------------------------------------------------------------- geometry


def _point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
    return inside


def _point_in_polygon(x: float, y: float, rings: list[list[list[float]]]) -> bool:
    return sum(_point_in_ring(x, y, ring) for ring in rings) % 2 == 1


_EDGE_CHUNK = 256  # edges per vectorized step: bounds memory to (points x 256) floats on a 512 MB instance


def _points_in_polygon(xs: np.ndarray, ys: np.ndarray, rings: list[list[list[float]]]) -> np.ndarray:
    """Vectorized `_point_in_polygon` for many points: the same even-odd ray test with the same arithmetic,
    so every decision matches the scalar version. Points outside a ring's bounding box are skipped (they
    cannot toggle it: the y test needs min y <= y < max y, and the crossing x never exceeds the ring's max x)."""
    inside = np.zeros(xs.shape, dtype=bool)
    for ring in rings:
        if not ring:
            continue
        r = np.asarray(ring, dtype=float)
        cand = np.nonzero((ys >= r[:, 1].min()) & (ys <= r[:, 1].max()) & (xs <= r[:, 0].max() + 1.0))[0]
        if not cand.size:
            continue
        px, py = xs[cand][:, None], ys[cand][:, None]
        x1, y1 = r[:, 0], r[:, 1]
        x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
        odd = np.zeros(cand.size, dtype=bool)
        for s in range(0, len(r), _EDGE_CHUNK):
            a, b, c, d = x1[s:s + _EDGE_CHUNK], y1[s:s + _EDGE_CHUNK], x2[s:s + _EDGE_CHUNK], y2[s:s + _EDGE_CHUNK]
            dy = d - b
            dy = np.where(dy == 0, 1e-12, dy)  # the scalar `(y2 - y1) or 1e-12`
            hit = ((b > py) != (d > py)) & (px < (c - a) * (py - b) / dy + a)
            odd ^= (np.count_nonzero(hit, axis=1) % 2).astype(bool)
        inside[cand] ^= odd
    return inside


_CACHE: dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()


def _units_crossed(coords: list[tuple[float, float]], cached: dict[str, Any]) -> list[dict[str, Any]]:
    """Geologic units a route crosses, as fractions of its densified (0.25 km) samples."""
    from science.routing.metrics import densify

    lat_s, lon_s = densify(coords, 0.25)
    samples = [project(a, b) for a, b in zip(lat_s, lon_s, strict=True)]
    xs = np.array([x for x, _ in samples], dtype=float)
    ys = np.array([y for _, y in samples], dtype=float)
    counts: dict[str, int] = {}
    unit_info: dict[str, dict[str, Any]] = {}
    for feature in cached["units"]:
        attrs = feature.get("attributes", {})
        rings = (feature.get("geometry") or {}).get("rings") or []
        unit = str(attrs.get("Unit"))
        unit_info.setdefault(unit, attrs)
        hits = int(np.count_nonzero(_points_in_polygon(xs, ys, rings))) if rings else 0
        if hits:
            counts[unit] = counts.get(unit, 0) + hits
    total = max(len(samples), 1)
    return [
        {"unit": unit, "fraction_of_route": round(n / total, 4), "color": cached["colors"].get(unit, "#8a8a8a"),
         "description": unit_info[unit].get("UnitDesc"), "group": unit_info[unit].get("UnitGroup"),
         "interpretation": unit_info[unit].get("Interpretation"),
         "primary_characteristics": unit_info[unit].get("PrimaryCharacteristics"),
         "status": "USGS MAPPED (1:20M)"}
        for unit, n in sorted(counts.items(), key=lambda kv: -kv[1])
    ]


def build_route_snapshot(route: dict[str, Any]) -> dict[str, Any]:
    """Snapshot one route, or several (`routes`) drawn together in one shared frame."""
    t0 = time.perf_counter()
    overlays = [
        {**item, "coords": [(float(c["latitude_deg"]), float(c["longitude_deg"])) for c in item["coordinates"]]}
        for item in (route.get("routes") or [])
    ]
    primary = route.get("coordinates") or (overlays[0]["coordinates"] if overlays else [])
    coords = [(float(c["latitude_deg"]), float(c["longitude_deg"])) for c in primary]
    if len(coords) < 2:
        raise ValueError("A snapshot needs at least two coordinates.")
    all_coords = coords + [point for item in overlays for point in item["coords"]]
    key = json.dumps([[round(a, 6), round(b, 6)] for a, b in all_coords])
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
    errors: list[str] = []
    extent = extent_for(all_coords, min_half_m=8000.0, margin=0.25)
    level = _choose_level(extent["xmax"] - extent["xmin"], extent["ymax"] - extent["ymin"])
    res = LOD_RESOLUTIONS[level]

    scale = 1.0  # set from the stitched image below, before any pixel coordinate is computed

    def px(x: float, y: float) -> list[float]:
        return [round(scale * (x - extent["xmin"]) / res, 2), round(scale * (extent["ymax"] - y) / res, 2)]

    route_xy = [project(lat, lon) for lat, lon in coords]
    if cached is None:
        cached = {"image": None, "units": [], "contacts": [], "structures": [], "landing_sites": [], "colors": {}}
        query = "USGS SIM 3292 FeatureServer query failed"
        jobs = {
            "image": (lambda: stitch_tiles(extent, level), "USGS MOLA hillshade tiles unavailable"),
            "colors": (unit_colors, f"{query} (unit colors)"),
            "units": (lambda: query_layer("units", extent, "Unit,UnitDesc,UnitGroup,Interpretation,PrimaryCharacteristics",
                                          True, res), f"{query} (units)"),
            "contacts": (lambda: query_layer("contacts", extent, "*", True, res), f"{query} (contacts)"),
            "structures": (lambda: query_layer("structures", extent, "*", True, res), f"{query} (structures)"),
            "landing_sites": (lambda: query_layer("landing_sites", extent, "*", True), f"{query} (landing sites)"),
        }
        # All six USGS requests at once, under one time budget: run in sequence their timeouts could add up to
        # more than a proxy waits (Vercel cuts external rewrites at 120 s). A late answer becomes a reported gap.
        pool = ThreadPoolExecutor(max_workers=len(jobs))
        futures = {key: pool.submit(fn) for key, (fn, _msg) in jobs.items()}
        wait(futures.values(), timeout=max(1.0, SNAPSHOT_BUDGET_S - (time.perf_counter() - t0)))
        pool.shutdown(wait=False, cancel_futures=True)
        for key, future in futures.items():
            message = jobs[key][1]
            if not future.done():
                errors.append(f"{message}: no answer within {SNAPSHOT_BUDGET_S:.0f} s")
                continue
            try:
                cached[key] = future.result()
            except Exception as exc:
                errors.append(f"{message}: {exc}")
        if not errors:
            with _CACHE_LOCK:
                if len(_CACHE) > 32:
                    _CACHE.clear()
                _CACHE[key] = cached

    # Read the display scale only now: a freshly stitched image may be upsampled for display,
    # and every pixel coordinate below must use the same scale as that image.
    scale = float((cached.get("image") or {}).get("display_scale", 1) or 1)

    polygons = []
    for feature in cached["units"]:
        attrs = feature.get("attributes", {})
        rings = (feature.get("geometry") or {}).get("rings") or []
        unit = str(attrs.get("Unit"))
        polygons.append({"unit": unit, "color": cached["colors"].get(unit, "#8a8a8a"),
                         "rings_px": [[px(x, y) for x, y in ring] for ring in rings]})
    crossed = _units_crossed(coords, cached)
    overlay_routes = [
        {"route_id": item.get("route_id"), "name": item.get("name"), "colour": item.get("colour"),
         "route_px": [px(*project(lat, lon)) for lat, lon in item["coords"]],
         "units_crossed": _units_crossed(item["coords"], cached)}
        for item in overlays
    ]

    def lines(features):
        return [{"attributes": f.get("attributes", {}),
                 "paths_px": [[px(x, y) for x, y in path] for path in (f.get("geometry") or {}).get("paths", [])]}
                for f in features]

    landing = []
    for feature in cached["landing_sites"]:
        geometry = feature.get("geometry") or {}
        if "x" in geometry and "y" in geometry:
            points = [(geometry["x"], geometry["y"])]
        else:
            points = [(p[0], p[1]) for p in geometry.get("points", [])]
        for x, y in points:
            landing.append({"attributes": feature.get("attributes", {}), "px": px(x, y)})
    sync = build_wab_sync_url(coords)
    return {
        "status": "ok" if not errors else ("partial" if cached["image"] or cached["units"] else "unavailable"),
        "errors": errors,
        "route": {k: route.get(k) for k in ("route_id", "name", "metrics", "objective_weights", "generation_method", "eva", "provenance")},
        "coordinates": [{"latitude_deg": a, "longitude_deg": b % 360.0} for a, b in coords],
        "start": {"latitude_deg": coords[0][0], "longitude_deg": coords[0][1] % 360.0},
        "end": {"latitude_deg": coords[-1][0], "longitude_deg": coords[-1][1] % 360.0},
        "projection": {"name": "Robinson_clon0_Mars_2000_Sphere", "wkt": MAP_WKT, "radius_m": MARS_2000_SPHERE_RADIUS_M},
        "extent_robinson_m": extent,
        "level": level,
        "native_resolution_m_per_px": res,
        "resolution_note": NATIVE_LIMIT_NOTE,
        "image": cached["image"],
        "route_px": [px(x, y) for x, y in route_xy],
        "routes": overlay_routes,
        "geology": {"units_crossed": crossed, "polygons": polygons, "contacts": lines(cached["contacts"]),
                    "structures": lines(cached["structures"]), "landing_sites": landing,
                    "note": "SIM 3292 is a 1:20,000,000 global map; unit boundaries are generalized at km scale."},
        "wab_sync_url": sync["url"],
        "source": SOURCE,
        "provenance": {
            "basemap": "USGS-hosted MOLA hillshade (NASA MOLA 128 ppd) tiles, fetched unmodified",
            "geology": "USGS SIM 3292 FeatureServer query (EXTERNAL SOURCE)",
            "route_geometry": "NeuroNexus route coordinates projected with the map's Robinson definition (COMPUTED)",
        },
        "timing_ms": {"total": round((time.perf_counter() - t0) * 1000, 2)},
    }
