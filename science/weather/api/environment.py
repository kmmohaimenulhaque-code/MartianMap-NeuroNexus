from __future__ import annotations

from fastapi import FastAPI, Query

from science.weather.models.mars_environment import MarsEnvironmentEngine


app = FastAPI(
    title="NeuroNexus Mars Environment Engine",
    version="1.0.0",
)

engine = MarsEnvironmentEngine()


@app.get("/environment")
def environment(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=360),
    sol: int = Query(..., ge=1),
    solar_longitude: float | None = Query(None, ge=0, le=360),
):
    return engine.get_environment(
        latitude=latitude,
        longitude=longitude,
        sol=sol,
        solar_longitude=solar_longitude,
    )
