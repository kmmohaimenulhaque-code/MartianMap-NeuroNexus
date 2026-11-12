"""GET /sources and GET /sources/{id} (also resolved by alias)."""
from __future__ import annotations

from fastapi import APIRouter

from science.ops.errors import ApiError
from science.sources import ledger

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("")
def list_sources():
    data = ledger.load()
    return {"schema": data["schema"], "ledger_sha256": ledger.sha256(), "evidence_classes": data["evidence_classes"],
            "ingestion_statuses": data["ingestion_statuses"], "count": len(data["entries"]), "entries": data["entries"]}


@router.get("/{source_id}")
def get_source(source_id: str):
    entry = ledger.resolve(source_id)
    if entry is None:
        raise ApiError(404, "NOT_FOUND", f"no ledger entry or alias {source_id!r}", "GET /sources lists every entry")
    return entry
