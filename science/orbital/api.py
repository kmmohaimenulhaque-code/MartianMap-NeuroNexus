from __future__ import annotations

from fastapi import APIRouter, Query

from science.orbital.small_bodies import get_near_mars_tracking

router = APIRouter(prefix="/orbital", tags=["orbital"])


@router.get("/mars-close-approaches")
def mars_close_approaches(days: int = Query(365, ge=1, le=3650), dist_max_au: float = Query(0.05, gt=0, le=0.5),
                          limit: int = Query(50, ge=1, le=200)):
    return get_near_mars_tracking(days=days, dist_max_au=dist_max_au, limit=limit)
