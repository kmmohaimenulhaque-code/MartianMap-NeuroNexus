"""NASA Ames MGCM MY34 dust scenario: time series, global maps and metadata.

The scenario is MODELED data: the Montabone et al. (2015) dust climatology for
Mars Year 34, binned by the Ames Mars GCM V3.2 to 3 x 3 degree cells and daily
(sol) time bins. It is not a forecast and not a live observation.
"""

from __future__ import annotations

import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from science.weather.config import dust_file
from science.weather.models.environment_assessment import DUST_LEVELS


SOURCE = "NASA Ames Mars GCM V3.2 · DustScenario_MY34.nc"
DATA_CLASS = "MODELED"
QUANTITY = (
    "Normalised column dust optical depth (Montabone et al. 2015 MY34 climatology, "
    "as distributed with the NASA Ames Mars GCM V3.2)"
)
LEVELS = DUST_LEVELS

router = APIRouter(prefix="/dust", tags=["dust"])

_lock = threading.Lock()
_dataset: Any = None


def dust_path() -> Path:
    return dust_file()


def dataset():
    """The opened scenario (loaded fully: ~58 MB, so every query is in-memory)."""
    global _dataset
    with _lock:
        if _dataset is None:
            import xarray as xr

            _dataset = xr.open_dataset(dust_path()).load()
        return _dataset


def _round(values: np.ndarray, digits: int) -> list[float | None]:
    return [None if not np.isfinite(v) else round(float(v), digits) for v in np.asarray(values, dtype=float)]


def _cell(latitude: float, longitude: float) -> tuple[int, int]:
    ds = dataset()
    lat_index = int(np.abs(ds["lat"].values - latitude).argmin())
    lon = longitude % 360.0
    lons = ds["lon"].values
    lon_distance = np.abs(((lons - lon) + 180.0) % 360.0 - 180.0)
    return lat_index, int(lon_distance.argmin())


@lru_cache(maxsize=512)
def _series(lat_index: int, lon_index: int) -> dict[str, Any]:
    ds = dataset()
    tau = ds["tau"].values[:, lat_index, lon_index]
    taufill = ds["taufill"].values[:, lat_index, lon_index]
    zmax = ds["zmax"].values[:, lat_index, lon_index]
    filled = ~np.isclose(tau, taufill, equal_nan=True)
    return {
        "cell": {
            "latitude_deg": float(ds["lat"].values[lat_index]),
            "longitude_deg": float(ds["lon"].values[lon_index]),
            "grid_deg": 3.0,
        },
        "sol": [int(v) for v in ds["time"].values],
        "ls_deg": _round(ds["areo"].values, 2),
        "tau": _round(tau, 4),
        "zmax_km": _round(zmax, 2),
        "filled": [bool(v) for v in filled],
        "stats": {
            "tau": {"min": round(float(np.nanmin(tau)), 4), "mean": round(float(np.nanmean(tau)), 4),
                    "max": round(float(np.nanmax(tau)), 4)},
            "zmax_km": {"min": round(float(np.nanmin(zmax)), 2), "mean": round(float(np.nanmean(zmax)), 2),
                        "max": round(float(np.nanmax(zmax)), 2)},
            "peak_sol": int(ds["time"].values[int(np.nanargmax(tau))]),
        },
    }


@lru_cache(maxsize=64)
def _map(sol: int) -> dict[str, Any]:
    ds = dataset()
    tau = ds["tau"].values[sol - 1]
    return {
        "sol": sol,
        "ls_deg": round(float(ds["areo"].values[sol - 1]), 2),
        "lat": _round(ds["lat"].values, 2),
        "lon": _round(ds["lon"].values, 2),
        "tau": [_round(row, 3) for row in tau],
        "range": {"min": round(float(np.nanmin(tau)), 3), "max": round(float(np.nanmax(tau)), 3),
                  "mean": round(float(np.nanmean(tau)), 3)},
    }


def _provenance() -> dict[str, Any]:
    return {"source": SOURCE, "data_class": DATA_CLASS, "quantity": QUANTITY,
            "note": "Modeled MY34 scenario (includes the 2018 global dust storm). Not a forecast."}


def _sol_count() -> int:
    return int(dataset().sizes["time"])


def _guard() -> None:
    try:
        dataset()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/meta")
def meta() -> dict[str, Any]:
    _guard()
    ds = dataset()
    return {
        **_provenance(),
        "sols": _sol_count(),
        "grid_deg": 3.0,
        "units": {"tau": "dimensionless", "zmax": "km", "ls": "degrees"},
        "levels": LEVELS,
        "reference": "NASA Ames Mars GCM V3.2 User Guide §2.3; Montabone et al. (2015), Icarus 251.",
        "ls_range_deg": [round(float(ds["areo"].values[0]), 2), round(float(ds["areo"].values[-1]), 2)],
    }


@router.get("/timeseries")
def timeseries(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=360),
) -> dict[str, Any]:
    _guard()
    series = _series(*_cell(latitude, longitude))
    return {**series, **_provenance(), "levels": LEVELS,
            "requested": {"latitude_deg": latitude, "longitude_deg": longitude % 360.0}}


@router.get("/map")
def dust_map(sol: int = Query(..., ge=1)) -> dict[str, Any]:
    _guard()
    if sol > _sol_count():
        raise HTTPException(status_code=400, detail=f"sol must be between 1 and {_sol_count()}")
    return {**_map(sol), **_provenance(), "levels": LEVELS}

