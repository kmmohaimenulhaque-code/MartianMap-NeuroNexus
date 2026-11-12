from __future__ import annotations

from fastapi import APIRouter, Query

from science.mission.state import build_mission_state


router = APIRouter(
    prefix="/mission",
    tags=["mission"],
)


@router.get("/state")
def mission_state(
    site: str = Query("Gale", min_length=1, max_length=160),
    sol: int = Query(100, ge=1),
    route_distance_km: float | None = Query(None, ge=0),
):
    return build_mission_state(
        site_name=site.strip() or "Gale",
        sol=sol,
        route_distance_km=route_distance_km,
    )
