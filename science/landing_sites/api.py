"""GET /landing-sites: the landing-site manifest already in the repository (NASA reference positions)."""
from __future__ import annotations

import json
from functools import lru_cache

from fastapi import APIRouter

from science import settings

router = APIRouter(tags=["landing-sites"])
MANIFEST = settings.PROJECT_ROOT / "data" / "manifests" / "mars_landing_sites.json"


@lru_cache(maxsize=1)
def _sites() -> list[dict]:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return data.get("sites", [])


@router.get("/landing-sites")
def landing_sites():
    return {"count": len(_sites()), "evidence": "NASA REFERENCE", "longitude_convention": "east, 0-360",
            "sites": [{k: s.get(k) for k in ("site_id", "mission", "spacecraft", "landing_date", "region", "latitude_deg",
                                             "longitude_deg", "site_status", "source_url")} for s in _sites()],
            "source": {"ledger_id": "NASA_MARS"}}
