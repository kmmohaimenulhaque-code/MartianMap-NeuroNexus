from __future__ import annotations

from pathlib import Path
import sys

from fastapi import FastAPI, Query

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from science.thermal.engine.thermal_engine import (
    NeuroNexusThermalEngine,
)

PARQUET = (
    ROOT
    / "data/indexes/themis/final/parquet/"
    / "neuronexus_thermal_observations.parquet"
)

engine = NeuroNexusThermalEngine(PARQUET)

app = FastAPI(
    title="NeuroNexus Thermal Engine",
    version="1.0.0",
)


@app.get("/thermal/coverage")
def coverage():
    return engine.coverage_summary()


@app.get("/thermal/nearest")
def nearest(
    latitude: float,
    longitude: float,
    solar_longitude: float | None = None,
    limit: int = Query(default=10, ge=1, le=100),
):
    return engine.nearest(
        latitude_deg=latitude,
        longitude_deg=longitude,
        solar_longitude_deg=solar_longitude,
        limit=limit,
    )


@app.get("/thermal/landing-site")
def landing_site(
    latitude: float,
    longitude: float,
    solar_longitude: float | None = None,
    radius_km: float = Query(default=50.0, gt=0, le=500),
    nearest_limit: int = Query(default=10, ge=1, le=100),
):
    return engine.landing_site_report(
        latitude_deg=latitude,
        longitude_deg=longitude,
        solar_longitude_deg=solar_longitude,
        radius_km=radius_km,
        nearest_limit=nearest_limit,
    )


@app.get("/thermal/history")
def history(
    latitude: float,
    longitude: float,
    radius_km: float = Query(default=50.0, gt=0, le=500),
):
    return engine.seasonal_history(
        latitude_deg=latitude,
        longitude_deg=longitude,
        radius_km=radius_km,
    )
