"""MMGIS rover traverse and waypoint ingest with a dated offline snapshot.

Live: https://mars.nasa.gov/mmgis-maps/{MSL,M20}/Layers/json/*.json ("NASA MMGIS (operations
localization)"). -9999 is a missing-value sentinel and becomes None, never a number. Longitudes
are normalized to -180..180. Full resolution is kept for validation; decimation is display-only.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import requests

from science import settings
from science.constants import MARS_RADIUS_M

MMGIS = "https://mars.nasa.gov/mmgis-maps/{code}/Layers/json/{code}_{kind}.json"
ROVERS = {
    "msl": {"name": "Curiosity", "code": "MSL", "site": "gale", "traverse_ledger": "MMGIS_MSL_TRAVERSE",
            "waypoints_ledger": "MMGIS_MSL_WAYPOINTS"},
    "m2020": {"name": "Perseverance", "code": "M20", "site": "jezero", "traverse_ledger": "MMGIS_M2020_TRAVERSE",
              "waypoints_ledger": "MMGIS_M2020_WAYPOINTS"},
}
WAYPOINT_FIELDS = ("RMC", "site", "drive", "sol", "lon", "lat", "elev_geoid", "roll", "pitch", "yaw", "tilt",
                   "dist_m", "dist_total_m")
SENTINEL = -9999.0
SNAPSHOT_DIR = settings.PROJECT_ROOT / "data" / "snapshots" / "rovers"
LIVE_TTL_S = 3600
_cache: dict[str, dict] = {}
_lock = threading.Lock()


def _num(value):
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return None if (not math.isfinite(v) or v == SENTINEL) else v


def _lon(value):
    v = _num(value)
    return None if v is None else ((v + 180.0) % 360.0) - 180.0


def normalize_waypoints(geojson: dict) -> list[dict]:
    out = []
    for feature in geojson.get("features", []):
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or [None, None]
        wp = {}
        for key in WAYPOINT_FIELDS:
            raw = props.get(key)
            if key == "RMC":
                wp[key] = str(raw) if raw is not None else None
            elif key in ("site", "drive", "sol"):
                v = _num(raw)
                wp[key] = None if v is None else int(v)
            elif key == "lon":
                wp[key] = _lon(raw if raw is not None else coords[0])
            elif key == "lat":
                wp[key] = _num(raw if raw is not None else coords[1])
            else:
                wp[key] = _num(raw)
        if wp["lat"] is not None and wp["lon"] is not None:
            out.append(wp)
    return out


def normalize_traverse(geojson: dict) -> list[dict]:
    drives = []
    for feature in geojson.get("features", []):
        geom = feature.get("geometry") or {}
        parts = [geom.get("coordinates", [])] if geom.get("type") == "LineString" else geom.get("coordinates", [])
        props = feature.get("properties") or {}
        for part in parts:
            coords = [[round(_lon(c[0]), 7), round(float(c[1]), 7)] + ([round(float(c[2]), 2)] if len(c) > 2 and
                      _num(c[2]) is not None else []) for c in part if _lon(c[0]) is not None and _num(c[1]) is not None]
            if len(coords) >= 2:
                drives.append({"sol": None if _num(props.get("sol")) is None else int(_num(props.get("sol"))),
                               "from_rmc": props.get("fromRMC"), "to_rmc": props.get("toRMC"),
                               "length_m": _num(props.get("length", props.get("Length"))), "coordinates": coords})
    return drives


def _fetch(code: str, kind: str) -> dict:
    url = settings.check_url(MMGIS.format(code=code, kind=kind))
    response = requests.get(url, timeout=(settings.CONNECT_TIMEOUT_S, settings.READ_TIMEOUT_S))
    response.raise_for_status()
    return response.json()


def fetch_live(rover: str) -> dict:
    meta = ROVERS[rover]
    waypoints = normalize_waypoints(_fetch(meta["code"], "waypoints"))
    traverse = normalize_traverse(_fetch(meta["code"], "traverse"))
    if not waypoints or not traverse:
        raise ValueError("MMGIS returned no usable features")
    return {"rover": rover, "name": meta["name"], "waypoints": waypoints, "traverse": traverse,
            "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"), "origin": "live"}


def latest_snapshot() -> Path | None:
    files = sorted(SNAPSHOT_DIR.glob("mmgis_*.json.gz"))
    return files[-1] if files else None


def load_snapshot(rover: str) -> dict:
    path = latest_snapshot()
    if path is None:
        raise FileNotFoundError("no MMGIS snapshot in data/snapshots/rovers/")
    data = json.loads(gzip.decompress(path.read_bytes()))
    return {**data["rovers"][rover], "retrieved_at": data["retrieved_at"], "origin": "snapshot",
            "snapshot": path.name}


def content_version(data: dict) -> str:
    """Hash of the traverse geometry: a refetch that returns the same drives keeps the same version, so
    derived products (the RDP display lines) are reused instead of recomputed on every TTL refresh."""
    digest = hashlib.sha1(usedforsecurity=False)
    for drive in data["traverse"]:
        digest.update(np.asarray([c[:2] for c in drive["coordinates"]], dtype="float64").tobytes())
    return digest.hexdigest()[:16]


def load(rover: str, *, allow_live: bool = True) -> dict:
    if rover not in ROVERS:
        raise KeyError(rover)
    with _lock:
        hit = _cache.get(rover)
        if hit and time.time() - hit["_t"] < LIVE_TTL_S:
            return hit["data"]
    data = None
    if allow_live and not settings.demo_pack_mode():
        try:
            data = fetch_live(rover)
        except (OSError, ValueError, requests.RequestException) as exc:
            data = {**load_snapshot(rover), "live_error": str(exc)[:200]}
    if data is None:
        data = load_snapshot(rover)
    data["content_version"] = content_version(data)
    with _lock:
        _cache[rover] = {"_t": time.time(), "data": data}
    return data


def write_snapshot(date: str | None = None) -> Path:
    """Fetch both rovers live and write data/snapshots/rovers/mmgis_<date>.json.gz plus its sha256."""
    rovers = {r: {k: v for k, v in fetch_live(r).items() if k not in ("retrieved_at", "origin")} for r in ROVERS}
    stamp = datetime.now(UTC)
    payload = {"source": "NASA MMGIS (operations localization)", "retrieved_at": stamp.isoformat(timespec="seconds"),
               "urls": {r: [MMGIS.format(code=m["code"], kind=k) for k in ("waypoints", "traverse")] for r, m in ROVERS.items()},
               "rovers": rovers}
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOT_DIR / f"mmgis_{date or stamp.date().isoformat()}.json.gz"
    raw = gzip.compress(json.dumps(payload, separators=(",", ":")).encode(), mtime=0)
    path.write_bytes(raw)
    (path.parent / (path.name + ".sha256")).write_text(f"{hashlib.sha256(raw).hexdigest()}  {path.name}\n")
    return path


def local_xy(lat: np.ndarray, lon: np.ndarray, lat0: float, lon0: float) -> tuple[np.ndarray, np.ndarray]:
    x = MARS_RADIUS_M * math.cos(math.radians(lat0)) * np.radians(((lon - lon0 + 180.0) % 360.0) - 180.0)
    return x, MARS_RADIUS_M * np.radians(lat - lat0)


def rdp(points: np.ndarray, epsilon: float) -> np.ndarray:
    """Ramer-Douglas-Peucker on an (n, 2) metric array; returns kept indices (display only, A10)."""
    keep = np.zeros(len(points), dtype=bool)
    keep[[0, -1]] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = points[i], points[j]
        seg = points[i + 1:j] - a
        d = b - a
        norm = math.hypot(*d)
        dist = np.abs(seg[:, 0] * d[1] - seg[:, 1] * d[0]) / norm if norm > 0 else np.hypot(seg[:, 0], seg[:, 1])
        k = int(np.argmax(dist))
        if dist[k] > epsilon:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return np.nonzero(keep)[0]
