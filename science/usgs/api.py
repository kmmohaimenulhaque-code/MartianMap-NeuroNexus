from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from science.usgs.arcgis import SOURCE, build_route_snapshot, build_wab_sync_url

router = APIRouter(prefix="/usgs", tags=["usgs"])


class Coordinate(BaseModel):
    latitude_deg: float = Field(ge=-90, le=90)
    longitude_deg: float = Field(ge=-180, le=360)
    label: str | None = None


class SnapshotRequest(BaseModel):
    route_id: str | None = None
    name: str | None = None
    coordinates: list[Coordinate] = Field(min_length=2, max_length=64)
    metrics: dict[str, Any] | None = None
    objective_weights: dict[str, Any] | None = None
    generation_method: str | None = None
    eva: dict[str, Any] | None = None
    provenance: dict[str, Any] | None = None


@router.get("/source")
def source() -> dict[str, Any]:
    return SOURCE


@router.get("/sync")
def sync(latitude: float = Query(..., ge=-90, le=90), longitude: float = Query(..., ge=-180, le=360),
         half_width_km: float = Query(40.0, gt=1, le=3000)) -> dict[str, Any]:
    return build_wab_sync_url([(latitude, longitude)], min_half_km=half_width_km)


@router.post("/route-snapshot")
def route_snapshot(request: SnapshotRequest) -> dict[str, Any]:
    try:
        return build_route_snapshot(request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
