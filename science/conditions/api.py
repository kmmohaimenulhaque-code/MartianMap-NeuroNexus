"""GET /conditions?site=gale|jezero: archived radiation, outreach weather, modeled dust and season.

Every block carries its evidence class, archive lag or age, and its ledger id. Nothing here is live,
a forecast, or a safety statement.
"""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Query

from science.conditions import rad, rems, solar
from science.ops.errors import ApiError

router = APIRouter(tags=["conditions"])
SITES = {"gale": (-4.72, 137.39), "jezero": (18.44, 77.45)}


def _dust(lat: float, lon: float, ls: float | None) -> dict:
    try:
        from science.weather.api.dust import _cell, _series
        series = _series(*_cell(lat, lon))
    except Exception as exc:  # noqa: BLE001 - the dust scenario is optional for this block
        return {"status": "UNAVAILABLE", "reason": str(exc)[:160], "ledger_id": "NASA_AMES_MGCM"}
    if ls is None:
        return {"status": "UNAVAILABLE", "reason": "season unknown (no Ls from the outreach feed)", "ledger_id": "NASA_AMES_MGCM"}
    ls_arr = np.array([np.nan if v is None else v for v in series["ls_deg"]], dtype="float64")
    gap = np.abs((ls_arr - ls + 180.0) % 360.0 - 180.0)
    i = int(np.nanargmin(gap))
    return {"tau": series["tau"][i], "my34_sol": series["sol"][i], "my34_ls": series["ls_deg"][i], "filled": series["filled"][i],
            "cell": series["cell"], "evidence": "MODELED", "ledger_id": "NASA_AMES_MGCM",
            "note": "NASA Ames MGCM MY34 scenario at the same season (Ls); a modeled year, not an observation or forecast"}


def _dust_at_sol(lat: float, lon: float, sol: int) -> dict:
    try:
        from science.weather.api.dust import _cell, _series
        series = _series(*_cell(lat, lon))
    except Exception as exc:  # noqa: BLE001 - the dust scenario is optional for this block
        return {"status": "UNAVAILABLE", "reason": str(exc)[:160], "ledger_id": "NASA_AMES_MGCM"}
    i = min(max(sol, 1), len(series["sol"])) - 1
    return {"tau": series["tau"][i], "my34_sol": series["sol"][i], "my34_ls": series["ls_deg"][i], "filled": series["filled"][i],
            "cell": series["cell"], "evidence": "MODELED", "ledger_id": "NASA_AMES_MGCM",
            "note": "NASA Ames MGCM MY34 scenario at the console's sol; a modeled year, not an observation or forecast"}


@router.get("/conditions")
def conditions(site: str = Query("gale"), sol: int | None = Query(None, ge=1, le=669,
               description="MY34 scenario sol from the console's sol slider; omitted = season from the outreach feed")):
    if site not in SITES:
        raise ApiError(400, "BAD_REQUEST", f"unknown site {site!r}", "use gale or jezero")
    lat, lon = SITES[site]
    r = rad.latest_window()
    weather = rems.latest_line("msl")
    out = {"site": site,
           "rad": {**r, "measured_at": "Gale crater (Curiosity RAD)"} if r.get("status") != "UNAVAILABLE" else {**r, "ledger_id": "MSL_RAD_RDR"},
           "weather": {**weather, "ledger_id": "MSL_REMS_OUTREACH"}, "season": None, "meda": None}
    if site == "jezero":
        out["rad"]["note"] = "RAD is on Curiosity: this rate was measured at Gale, about 3,700 km away (screening context only)."
        meda = rems.latest_line("mars2020")
        out["meda"] = {**meda, "ledger_id": "M2020_MEDA_OUTREACH"}
        out["weather"]["note"] = "Gale (Curiosity REMS) outreach line; Perseverance MEDA is shown separately."
    ls = weather.get("ls")
    if sol is not None:
        out["dust"] = _dust_at_sol(lat, lon, sol)
        ls = out["dust"].get("my34_ls")
        if ls is not None:
            out["season"] = {"ls": ls, "sol": sol, "label": f"MY34 sol {sol} · Ls {ls:.0f}° (scenario)", "source": "NASA_AMES_MGCM"}
    else:
        if ls is not None:
            out["season"] = {"ls": ls, "label": f"Ls {ls:.0f}° · {weather.get('season')}", "source": "MSL_REMS_OUTREACH"}
        out["dust"] = _dust(lat, lon, ls)
    if ls is not None:
        out["solar"] = solar.solar(lat, float(ls), out["dust"].get("tau"))
    out["dose_screening"] = {"rule": "EVA dose = daily E rate x EVA hours / 24 (altitude term below 1% at EVA scale)",
                             "ledger_id": "NEURONEXUS_DOSE_SCREENING", "evidence": "DERIVED"}
    return out
