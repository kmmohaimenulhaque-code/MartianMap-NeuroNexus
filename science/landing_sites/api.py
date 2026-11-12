"""GET /landing-sites: the landing-site manifest already in the repository (reference positions).

NASA sites cite NASA mission documentation (ledger NASA_MARS). The two ESA-era landers outside NASA, Beagle 2 and the
Schiaparelli impact site, are positioned from MRO HiRISE imaging (ledger HIRISE). Each site carries its own ledger id;
sites whose position was never established (Mars Polar Lander, Deep Space 2) are listed under scope, never given
coordinates.
"""
from __future__ import annotations

import json
from functools import lru_cache

from fastapi import APIRouter

from science import settings

router = APIRouter(tags=["landing-sites"])
MANIFEST = settings.PROJECT_ROOT / "data" / "manifests" / "mars_landing_sites.json"
SITE_FIELDS = ("site_id", "mission", "spacecraft", "agency", "label", "landing_date", "region", "latitude_deg",
               "longitude_deg", "site_status", "source_url", "secondary_source_url", "coordinate_provenance", "notes")
DEFAULT_LEDGER = "NASA_MARS"


@lru_cache(maxsize=1)
def _manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def _sites() -> list[dict]:
    return _manifest().get("sites", [])


def _site(s: dict) -> dict:
    out = {k: s.get(k) for k in SITE_FIELDS}
    out["label"] = out["label"] or s.get("spacecraft") or s.get("mission")
    out["source"] = {"ledger_id": s.get("ledger_id") or DEFAULT_LEDGER}
    return out


@router.get("/landing-sites")
def landing_sites():
    return {"count": len(_sites()), "evidence": "NASA REFERENCE", "longitude_convention": "east, 0-360",
            "sites": [_site(s) for s in _sites()],
            "scope": _manifest().get("scope"),
            "source": {"ledger_id": DEFAULT_LEDGER}}
