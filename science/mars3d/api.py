from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from science.mars3d.layers import exploration_context, exploration_zones, local_terrain_grid, rover_traverses

router = APIRouter(prefix="/mars3d", tags=["mars3d"])


@router.get("/traverses")
def traverses() -> dict[str, Any]:
    return rover_traverses()


@router.get("/terrain-grid")
def terrain_grid(
    latitude: float = Query(..., ge=-88.0, le=88.0),
    longitude: float = Query(...),
    half_width_km: float = Query(20.0, ge=2.0, le=60.0),
    max_cells: int = Query(30, ge=5, le=40),
) -> dict[str, Any]:
    try:
        return local_terrain_grid(latitude, longitude % 360.0, half_width_km, max_cells)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=503, detail=f"NASA MOLA tiles unavailable: {exc}. Run `git lfs pull`.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=f"NASA MOLA tiles unavailable: {exc}. Run `git lfs pull`.") from exc


@router.get("/context")
def context() -> dict[str, Any]:
    return exploration_context()


@router.get("/exploration-zones")
def potential_exploration_zones(
    latitude: float | None = Query(None, ge=-88.0, le=88.0),
    longitude: float | None = Query(None),
) -> dict[str, Any]:
    site = {"latitude_deg": latitude, "longitude_deg": longitude % 360.0} if latitude is not None and longitude is not None else None
    return exploration_zones(site)
