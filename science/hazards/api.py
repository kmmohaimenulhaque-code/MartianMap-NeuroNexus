from __future__ import annotations

from fastapi import APIRouter, Query

from science.hazards.mars_hazard_engine import (
    build_ai_context,
    build_hazard_overview,
)


router = APIRouter(
    prefix="/hazards",
    tags=["hazards"],
)


@router.get("/overview")
def hazard_overview(
    site: str = Query(
        "Gale",
        min_length=1,
        max_length=160,
    ),
    sol: int = Query(
        100,
        ge=1,
    ),
    horizon_days: int = Query(
        365,
        ge=1,
        le=3650,
    ),
):
    return build_hazard_overview(
        site_name=site.strip() or "Gale",
        sol=sol,
        horizon_days=horizon_days,
    )


@router.get("/ai-context")
def hazard_ai_context(
    site: str = Query(
        "Gale",
        min_length=1,
        max_length=160,
    ),
    sol: int = Query(
        100,
        ge=1,
    ),
):
    return build_ai_context(
        site_name=site.strip() or "Gale",
        sol=sol,
    )
