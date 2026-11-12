from __future__ import annotations

from pathlib import Path

from science.thermal.engine.thermal_engine import NeuroNexusThermalEngine
from science.weather.models.mars_weather import MarsWeatherModel


ROOT = Path(__file__).resolve().parents[3]

THEMIS_DATASET = (
    ROOT
    / "data/indexes/themis/final/parquet/"
    / "neuronexus_thermal_observations.parquet"
)

DUST_DATASET = (
    ROOT
    / "external/mars-gcm/data/"
    / "DustScenario_MY34.nc"
)


class MarsEnvironmentEngine:
    def __init__(
        self,
        themis_path: str | Path = THEMIS_DATASET,
        dust_path: str | Path = DUST_DATASET,
    ):
        self.thermal = NeuroNexusThermalEngine(themis_path)
        self.weather = MarsWeatherModel(dust_path)

    def get_environment(
        self,
        latitude: float,
        longitude: float,
        sol: int,
        solar_longitude: float | None = None,
    ) -> dict:
        thermal = self.thermal.nearest(
            latitude_deg=latitude,
            longitude_deg=longitude,
            solar_longitude_deg=solar_longitude,
            limit=1,
        )

        dust = self.weather.get_conditions(
            sol_index=sol,
            latitude=latitude,
            longitude=longitude,
        )

        return {
            "location": {
                "latitude_deg": latitude,
                "longitude_deg": longitude,
            },
            "thermal": {
                "source": "NASA THEMIS IR-PBT",
                "measurement": "brightness_temperature",
                "observations": thermal,
            },
            "dust": {
                **dust["dust"],
                "source": "NASA Ames Mars GCM dust scenario MY34",
            },
            "solar": dust["solar"],
        }
