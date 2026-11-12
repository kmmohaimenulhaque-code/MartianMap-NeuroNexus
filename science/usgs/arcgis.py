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
from concurrent.futures import ThreadPoolExecutor
from typing import Any

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


def _choose_level(width_m: float, height_m: float, max_px: int = 900) -> int:
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
    if (col1 - col0 + 1) * (row1 - row0 + 1) > 64:
        raise ValueError("Snapshot would need more than 64 tiles.")
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
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return {
        "data_uri": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"),
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
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
    return inside


def _point_in_polygon(x: float, y: float, rings: list[list[list[float]]]) -> bool:
    return sum(_point_in_ring(x, y, ring) for ring in rings) % 2 == 1


_CACHE: dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()


def build_route_snapshot(route: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()
    coords = [(float(c["latitude_deg"]), float(c["longitude_deg"])) for c in route["coordinates"]]
    key = json.dumps([[round(a, 6), round(b, 6)] for a, b in coords])
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
    errors: list[str] = []
    extent = extent_for(coords, min_half_m=8000.0, margin=0.25)
    level = _choose_level(extent["xmax"] - extent["xmin"], extent["ymax"] - extent["ymin"])
    res = LOD_RESOLUTIONS[level]

    scale = float((cached or {}).get("image", {}).get("display_scale", 1) or 1) if isinstance(cached, dict) else 1.0

    def px(x: float, y: float) -> list[float]:
        return [round(scale * (x - extent["xmin"]) / res, 2), round(scale * (extent["ymax"] - y) / res, 2)]

    route_xy = [project(lat, lon) for lat, lon in coords]
    if cached is None:
        cached = {"image": None, "units": [], "contacts": [], "structures": [], "landing_sites": [], "colors": {}}
        try:
            cached["image"] = stitch_tiles(extent, level)
        except Exception as exc:
            errors.append(f"USGS MOLA hillshade tiles unavailable: {exc}")
        try:
            cached["colors"] = unit_colors()
            cached["units"] = query_layer("units", extent, "Unit,UnitDesc,UnitGroup,Interpretation,PrimaryCharacteristics", True, res)
            cached["contacts"] = query_layer("contacts", extent, "*", True, res)
            cached["structures"] = query_layer("structures", extent, "*", True, res)
            cached["landing_sites"] = query_layer("landing_sites", extent, "*", True)
        except Exception as exc:
            errors.append(f"USGS SIM 3292 FeatureServer query failed: {exc}")
        if not errors:
            with _CACHE_LOCK:
                if len(_CACHE) > 32:
                    _CACHE.clear()
                _CACHE[key] = cached

    from science.routing.metrics import densify

    lat_s, lon_s = densify(coords, 0.25)
    samples = [project(a, b) for a, b in zip(lat_s, lon_s)]
    polygons = []
    counts: dict[str, int] = {}
    for feature in cached["units"]:
        attrs = feature.get("attributes", {})
        rings = (feature.get("geometry") or {}).get("rings") or []
        unit = str(attrs.get("Unit"))
        hits = sum(1 for x, y in samples if _point_in_polygon(x, y, rings)) if rings else 0
        if hits:
            counts[unit] = counts.get(unit, 0) + hits
        polygons.append({"unit": unit, "color": cached["colors"].get(unit, "#8a8a8a"),
                         "rings_px": [[px(x, y) for x, y in ring] for ring in rings]})
    unit_info = {str(f["attributes"].get("Unit")): f["attributes"] for f in cached["units"]}
    total = max(len(samples), 1)
    crossed = [
        {"unit": unit, "fraction_of_route": round(n / total, 4), "color": cached["colors"].get(unit, "#8a8a8a"),
         "description": unit_info[unit].get("UnitDesc"), "group": unit_info[unit].get("UnitGroup"),
         "interpretation": unit_info[unit].get("Interpretation"),
         "primary_characteristics": unit_info[unit].get("PrimaryCharacteristics"),
         "status": "USGS MAPPED (1:20M)"}
        for unit, n in sorted(counts.items(), key=lambda kv: -kv[1])
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
        "geology": {"units_crossed": crossed, "polygons": polygons, "contacts": lines(cached["contacts"]),
                    "structures": lines(cached["structures"]), "landing_sites": landing,
                    "note": "SIM 3292 is a 1:20,000,000 global map; unit boundaries are generalised at km scale."},
        "wab_sync_url": sync["url"],
        "source": SOURCE,
        "provenance": {
            "basemap": "USGS-hosted MOLA hillshade (NASA MOLA 128 ppd) tiles, fetched unmodified",
            "geology": "USGS SIM 3292 FeatureServer query (EXTERNAL SOURCE)",
            "route_geometry": "NeuroNexus route coordinates projected with the map's Robinson definition (COMPUTED)",
        },
        "timing_ms": {"total": round((time.perf_counter() - t0) * 1000, 2)},
    }
