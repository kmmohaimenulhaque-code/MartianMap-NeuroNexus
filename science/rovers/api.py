"""/rovers/{rover}/waypoints, /traverse and /latest (MMGIS, with snapshot fallback)."""
from __future__ import annotations

import threading
from functools import lru_cache

import numpy as np
from fastapi import APIRouter, Query

from science.ops.errors import ApiError, unavailable
from science.rovers import traverses

router = APIRouter(prefix="/rovers", tags=["rovers"])


def _data(rover: str) -> dict:
    if rover not in traverses.ROVERS:
        raise ApiError(404, "NOT_FOUND", f"unknown rover {rover!r}", "use msl or m2020")
    try:
        return traverses.load(rover)
    except FileNotFoundError as exc:
        raise unavailable(f"MMGIS unreachable and {exc}") from exc


def _source(data: dict, ledger_id: str) -> dict:
    return {"ledger_id": ledger_id, "retrieved_at": data["retrieved_at"], "origin": data["origin"],
            "label": "NASA MMGIS (operations localization)", **({"snapshot": data["snapshot"]} if "snapshot" in data else {})}


@router.get("/{rover}/waypoints")
def waypoints(rover: str, sol_min: int | None = Query(None, ge=0), sol_max: int | None = Query(None, ge=0)):
    data = _data(rover)
    rows = [w for w in data["waypoints"] if (sol_min is None or (w["sol"] or 0) >= sol_min)
            and (sol_max is None or (w["sol"] or 0) <= sol_max)]
    meta = traverses.ROVERS[rover]
    return {"rover": rover, "name": meta["name"], "count": len(rows), "evidence": "OBSERVED",
            "units": {"lon": "deg E", "lat": "deg N", "elev_geoid": "m", "tilt": "deg", "dist_total_m": "m"},
            "missing_value_rule": "-9999 sentinels are null", "waypoints": rows,
            "source": _source(data, meta["waypoints_ledger"])}


_simplify_lock = threading.Lock()


@lru_cache(maxsize=32)
def _display_line(rover: str, max_vertices: int, version: str) -> tuple[list, int, float]:
    """RDP display line for one data version; cached because the 30-step tolerance search is CPU-bound."""
    data = _data(rover)
    coords = np.array([c[:2] for d in data["traverse"] for c in d["coordinates"]], dtype="float64")
    total = len(coords)
    line = coords
    tolerance = 0.0
    if total > max_vertices:
        lat0, lon0 = float(coords[:, 1].mean()), float(coords[:, 0].mean())
        x, y = traverses.local_xy(coords[:, 1], coords[:, 0], lat0, lon0)
        pts = np.column_stack([x, y])
        lo, hi = 0.01, 200.0
        for _ in range(30):  # binary-search the RDP tolerance to fit the vertex budget
            mid = (lo + hi) / 2
            if len(traverses.rdp(pts, mid)) > max_vertices:
                lo = mid
            else:
                hi = mid
        idx = traverses.rdp(pts, hi)
        line, tolerance = coords[idx], hi
    return [[round(a, 7), round(b, 7)] for a, b in line], total, tolerance


def warm(max_vertices: tuple[int, ...] = (3000, 4000)) -> None:
    """Precompute the display lines the console requests first (called in a background thread at startup)."""
    for rover in traverses.ROVERS:
        for n in max_vertices:
            try:
                traverse(rover, n)
            except Exception:  # noqa: BLE001 - warming is best effort; requests still compute on demand
                return


@router.get("/{rover}/traverse")
def traverse(rover: str, max_vertices: int = Query(4000, ge=50, le=200000)):
    data = _data(rover)
    meta = traverses.ROVERS[rover]
    with _simplify_lock:  # one computation per (rover, budget, version); concurrent callers wait for it
        line, total, tolerance = _display_line(rover, max_vertices, f"{data['origin']}:{data['retrieved_at']}")
    return {"rover": rover, "name": meta["name"], "evidence": "OBSERVED",
            "geometry": {"type": "LineString", "coordinates": line},
            "vertices_full": total, "vertices_display": len(line), "display_tolerance_m": round(tolerance, 3),
            "display_only": total > max_vertices, "drives": len(data["traverse"]),
            "source": _source(data, meta["traverse_ledger"])}


@router.get("/{rover}/latest")
def latest(rover: str):
    data = _data(rover)
    meta = traverses.ROVERS[rover]
    last = max(data["waypoints"], key=lambda w: ((w["sol"] or 0), w["dist_total_m"] or 0))
    return {"rover": rover, "name": meta["name"], "site": meta["site"], "latest": last, "evidence": "OBSERVED",
            "habitat_stand_in": f"{meta['name']}'s latest position, used as a stand-in habitat for EVA planning",
            "source": _source(data, meta["waypoints_ledger"])}
