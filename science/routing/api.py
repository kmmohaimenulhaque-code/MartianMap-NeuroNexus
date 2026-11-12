from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from science.routing.engine import (
    DEFAULT_ASCENT_M_PER_H, DEFAULT_EVA_PACE_KMH, MAX_WINDOW_KM, evaluate_route, plan_route_candidates,
)
from science.routing.metrics import METHODOLOGY
from science.routing.objectives import OBJECTIVE_KEYS, OBJECTIVE_LABELS, PRESETS, SCALARISATION, SPECIAL_CANDIDATES

router = APIRouter(prefix="/routes", tags=["routes"])


class PointIn(BaseModel):
    latitude_deg: float = Field(ge=-88.0, le=88.0)
    longitude_deg: float = Field(ge=-180.0, le=360.0)
    label: str | None = Field(default=None, max_length=120)


class HavenIn(PointIn):
    id: str | None = None
    name: str | None = None


class CandidateRequest(BaseModel):
    start: PointIn
    destination: PointIn
    weights: dict[str, float] | None = None
    eva_pace_kmh: float = Field(DEFAULT_EVA_PACE_KMH, gt=0.1, le=10.0)
    ascent_allowance_m_per_h: float = Field(DEFAULT_ASCENT_M_PER_H, ge=0.0, le=5000.0)
    safe_havens: list[HavenIn] = Field(default_factory=list, max_length=64)
    include_science: bool = True


class EvaluateRequest(BaseModel):
    coordinates: list[PointIn] = Field(min_length=2, max_length=64)
    eva_pace_kmh: float = Field(DEFAULT_EVA_PACE_KMH, gt=0.1, le=10.0)
    ascent_allowance_m_per_h: float = Field(DEFAULT_ASCENT_M_PER_H, ge=0.0, le=5000.0)
    safe_havens: list[HavenIn] = Field(default_factory=list, max_length=64)
    include_science: bool = True


def _dump(items) -> list[dict[str, Any]]:
    return [item.model_dump() for item in items]


@router.get("/methodology")
def methodology() -> dict[str, Any]:
    return {
        "objectives": {key: OBJECTIVE_LABELS[key] for key in OBJECTIVE_KEYS},
        "presets": PRESETS,
        "special_candidates": SPECIAL_CANDIDATES,
        "scalarisation": SCALARISATION,
        "max_window_km": MAX_WINDOW_KM,
        "defaults": {"eva_pace_kmh": DEFAULT_EVA_PACE_KMH, "ascent_allowance_m_per_h": DEFAULT_ASCENT_M_PER_H},
        **METHODOLOGY,
    }


@router.post("/candidates")
def candidates(request: CandidateRequest) -> dict[str, Any]:
    try:
        return plan_route_candidates(
            request.start.model_dump(),
            request.destination.model_dump(),
            weights=request.weights,
            eva_pace_kmh=request.eva_pace_kmh,
            ascent_allowance_m_per_h=request.ascent_allowance_m_per_h,
            safe_havens=_dump(request.safe_havens),
            include_science=request.include_science,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"NASA MOLA MEGDR tiles unavailable: {exc}. Run `git lfs pull`.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/evaluate")
def evaluate(request: EvaluateRequest) -> dict[str, Any]:
    try:
        return evaluate_route(
            [c.model_dump() for c in request.coordinates],
            eva_pace_kmh=request.eva_pace_kmh,
            ascent_allowance_m_per_h=request.ascent_allowance_m_per_h,
            safe_havens=_dump(request.safe_havens),
            include_science=request.include_science,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
