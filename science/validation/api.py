"""GET /validation/latest and GET /validation/{site}/{run_id}."""
from __future__ import annotations

import json
import re

from fastapi import APIRouter
from fastapi.responses import FileResponse

from science.ops.errors import ApiError
from science.validation.run import REPORTS

router = APIRouter(prefix="/validation", tags=["validation"])


@router.get("/latest")
def latest():
    path = REPORTS / "latest.json"
    if not path.exists():
        raise ApiError(404, "NOT_FOUND", "no validation report yet", "python -m science.validation.run --site all")
    return {**json.loads(path.read_text(encoding="utf-8")), "source": {"ledger_id": "NEURONEXUS_VALIDATION_SUITE"}}


@router.get("/figure/{site}/{run_id}/figures/{name}")
def figure(site: str, run_id: str, name: str):
    """Validation chart PNGs (downloadable chart snapshots for the export)."""
    if site not in ("gale", "jezero") or not re.fullmatch(r"\d{8}-[0-9a-f]{8}", run_id) or not re.fullmatch(r"[a-z0-9_]+\.png", name):
        raise ApiError(400, "BAD_REQUEST", "unknown site, run id or figure")
    path = REPORTS / site / run_id / "figures" / name
    if not path.exists():
        raise ApiError(404, "NOT_FOUND", f"no figure {site}/{run_id}/{name}")
    return FileResponse(path, media_type="image/png", filename=f"neuronexus_validation_{site}_{name}")


@router.get("/{site}/{run_id}")
def report(site: str, run_id: str):
    if site not in ("gale", "jezero") or not re.fullmatch(r"\d{8}-[0-9a-f]{8}", run_id):
        raise ApiError(400, "BAD_REQUEST", "unknown site or malformed run id")
    path = REPORTS / site / run_id / "report.json"
    if not path.exists():
        raise ApiError(404, "NOT_FOUND", f"no report {site}/{run_id}")
    return json.loads(path.read_text(encoding="utf-8"))
