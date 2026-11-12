from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class HistoricalThermalObservation:
    latitude_deg: float
    longitude_deg: float

    temperature_k: float | None
    temperature_c: float | None

    observation_time: str | None
    solar_longitude_deg: float | None

    day_night: str | None

    product_id: str | None
    resolution_m: float | None

    source: str = "NASA THEMIS"
    status: str = "historical_observation"

    spatial_distance_km: float | None = None
    seasonal_distance_deg: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "latitude_deg": self.latitude_deg,
            "longitude_deg": self.longitude_deg,
            "temperature_k": self.temperature_k,
            "temperature_c": self.temperature_c,
            "observation_time": self.observation_time,
            "solar_longitude_deg": self.solar_longitude_deg,
            "day_night": self.day_night,
            "product_id": self.product_id,
            "resolution_m": self.resolution_m,
            "source": self.source,
            "status": self.status,
            "spatial_distance_km": self.spatial_distance_km,
            "seasonal_distance_deg": self.seasonal_distance_deg,
        }
