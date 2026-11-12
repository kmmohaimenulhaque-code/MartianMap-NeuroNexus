from __future__ import annotations

from pathlib import Path
import sys

from fastapi import FastAPI, Query

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from science.weather.models.mars_weather import MarsWeatherModel


model = MarsWeatherModel()  # dataset resolved by science.weather.config.dust_file()

app = FastAPI(
    title="NeuroNexus Mars Weather Engine",
    version="1.0.0",
)


@app.get("/weather/conditions")
def conditions(
    sol: int = Query(..., ge=1),
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=360),
):
    return model.get_conditions(
        sol_index=sol,
        latitude=latitude,
        longitude=longitude,
    )
