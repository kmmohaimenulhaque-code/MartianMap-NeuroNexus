from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .matcher import ThemisThermalMatcher
from .validators import ThemisThermalValidator


class ThemisThermalIndex:
    """Searchable index of validated historical THEMIS observations."""

    def __init__(
        self,
        index_path: str | Path | None = None,
    ) -> None:

        self.index_path = Path(
            index_path
            or "data/indexes/themis/themis_thermal_observations.json"
        )

        self.matcher = ThemisThermalMatcher()
        self.validator = ThemisThermalValidator()

    def load(self) -> list[dict[str, Any]]:
        if not self.index_path.exists():
            return []

        with self.index_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)

        if not isinstance(data, list):
            raise ValueError("THEMIS thermal index must contain a list.")

        valid_records: list[dict[str, Any]] = []

        for record in data:
            result = self.validator.validate(record)

            if result["valid"]:
                valid_records.append(record)

        return valid_records

    def query(
        self,
        latitude_deg: float,
        longitude_deg: float,
        *,
        solar_longitude_deg: float | None = None,
    ) -> dict[str, Any]:

        observations = self.load()

        if not observations:
            return {
                "surface_temperature_k": None,
                "surface_temperature_c": None,
                "observation_time": None,
                "solar_longitude_deg": None,
                "day_night": None,
                "product_id": None,
                "resolution_m": None,
                "source": "NASA THEMIS",
                "status": "no_historical_observation_indexed",
            }

        ranked = self.matcher.rank(
            observations,
            latitude_deg=latitude_deg,
            longitude_deg=longitude_deg,
            solar_longitude_deg=solar_longitude_deg,
        )

        best = ranked[0]

        return {
            **best,
            "status": "historical_observation",
            "source": "NASA THEMIS",
        }
