from __future__ import annotations

from pathlib import Path

from science.gazetteer.usgs import USGSMarsGazetteer
from science.thermal.engine.thermal_engine import NeuroNexusThermalEngine
from science.weather.models.mars_weather import MarsWeatherModel
from science.weather.models.terrain_assessment import MarsTerrainAssessment


ROOT = Path(__file__).resolve().parents[3]

THEMIS_DATASET = (
    ROOT
    / "data"
    / "indexes"
    / "themis"
    / "final"
    / "parquet"
    / "neuronexus_thermal_observations.parquet"
)

DUST_DATASET = (
    ROOT
    / "external"
    / "mars-gcm"
    / "data"
    / "DustScenario_MY34.nc"
)

GAZETTEER_DATASET = (
    ROOT
    / "data"
    / "processed"
    / "gazetteer"
    / "mars_nomenclature_center_pts.parquet"
)


class MarsEnvironmentEngine:
    """Unified Mars environmental context engine."""

    def __init__(
        self,
        themis_path: str | Path = THEMIS_DATASET,
        dust_path: str | Path = DUST_DATASET,
        gazetteer_path: str | Path = GAZETTEER_DATASET,
    ) -> None:
        self.thermal = NeuroNexusThermalEngine(themis_path)
        self.weather = MarsWeatherModel(dust_path)
        self.terrain = MarsTerrainAssessment()
        self.gazetteer = USGSMarsGazetteer(gazetteer_path)

    def get_environment(
        self,
        latitude: float,
        longitude: float,
        sol: int,
        solar_longitude: float | None = None,
    ) -> dict:
        """Return a unified environmental context for a Mars coordinate."""

        gazetteer_feature = self.gazetteer.nearest(
            latitude=latitude,
            longitude=longitude,
        )

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

        terrain = self.terrain.assess(
            latitude=latitude,
            longitude=longitude,
        )

        return {
            "location": {
                "latitude_deg": latitude,
                "longitude_deg": longitude,
            },
            "gazetteer": {
                "source": "USGS Gazetteer of Planetary Nomenclature",
                "nearest_feature": gazetteer_feature,
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
            "terrain": terrain,
        }
