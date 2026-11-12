"""GET /health (process up), GET /ready (core data loadable), GET /data/status (what is on disk)."""
from __future__ import annotations

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from science import settings
from science.terrain import mola_store

router = APIRouter(tags=["ops"])


def _checks() -> dict:
    checks = {}
    mola = mola_store.status()
    hero = {t: mola["tiles"].get(t) for t in ("megt00n090hb", "megt44n000hb")}
    checks["mola_tiles"] = {"ok": all(hero.values()), "detail": f"{mola['available']}/{mola['total']} MEG128 tiles; "
                            f"Gale {hero['megt00n090hb'] or 'missing'}, Jezero {hero['megt44n000hb'] or 'missing'}"}
    try:
        from science.sources import ledger
        problems = ledger.validate()
        checks["source_ledger"] = {"ok": not problems, "detail": f"{len(ledger.load()['entries'])} entries" +
                                   (f"; {len(problems)} problems" if problems else "")}
    except Exception as exc:  # noqa: BLE001 - status reporting must not raise
        checks["source_ledger"] = {"ok": False, "detail": str(exc)[:160]}
    from science.rovers import traverses
    snap = traverses.latest_snapshot()
    checks["rover_snapshot"] = {"ok": snap is not None, "detail": snap.name if snap else "missing"}
    from science.weather.config import dust_file
    try:
        dust = dust_file()
        checks["dust_scenario"] = {"ok": dust.exists(), "detail": dust.name}
    except Exception as exc:  # noqa: BLE001
        checks["dust_scenario"] = {"ok": False, "detail": str(exc)[:160]}
    latest = settings.PROJECT_ROOT / "validation" / "reports" / "latest.json"
    checks["validation_report"] = {"ok": latest.exists(), "detail": "validation/reports/latest.json" if latest.exists() else "not generated"}
    demo = settings.demo_pack_dir() / "manifest.json"
    checks["demo_pack"] = {"ok": demo.exists(), "detail": "data/demo_pack/manifest.json" if demo.exists() else "not built"}
    return checks


@router.get("/health")
def health():
    return {"status": "ok", "pid": os.getpid()}


@router.get("/ready")
def ready():
    checks = _checks()
    core = ("mola_tiles", "source_ledger", "rover_snapshot")
    ok = all(checks[k]["ok"] for k in core)
    return JSONResponse({"ready": ok, "core": list(core), "checks": checks}, status_code=200 if ok else 503)


@router.get("/data/status")
def data_status():
    return {"checks": _checks(), "demo_pack_mode": settings.demo_pack_mode(),
            "demo_pack": "ACTIVE (pre-fetched real NASA/USGS data)" if settings.demo_pack_mode() else None,
            "allowlist": sorted(settings.ALLOWED_HOSTS)}
