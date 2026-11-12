from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from science.ai.gemini import analyse_routes, chat, service_status
from science.provenance import source_ledger

router = APIRouter(prefix="/ai", tags=["ai"])


class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)
    mission_state: dict[str, Any] = Field(default_factory=dict)
    enable_search: bool = False


class RouteAnalysisRequest(BaseModel):
    candidates: list[dict[str, Any]] = Field(default_factory=list, max_length=12)
    selected_candidate_id: str | None = None
    objective_weights: dict[str, Any] | None = None
    methodology: dict[str, Any] | None = None
    context: dict[str, Any] | None = None
    question: str | None = None


@router.get("/status")
def status() -> dict[str, Any]:
    return service_status()


@router.get("/provenance")
def provenance() -> dict[str, Any]:
    return source_ledger()


@router.post("/chat")
def ai_chat(request: ChatRequest) -> dict[str, Any]:
    return chat([m.model_dump() for m in request.messages], request.mission_state, enable_search=request.enable_search)


@router.post("/route-analysis")
def ai_route_analysis(request: RouteAnalysisRequest) -> dict[str, Any]:
    return analyse_routes(request.model_dump())
