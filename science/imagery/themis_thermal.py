from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ThermalObservation:
    latitude_deg: float
    longitude_deg: float
    temperature_k: float | None
    temperature_c: float | None
    observation_time: str | None
    product_id: str | None
    source: str
    resolution_m: float | None
    confidence: float | None
    status: str = "observed"


class ThemisThermalAdapter:
    """
    Adapter boundary for NASA THEMIS thermal observations.

    Raw products remain external/native.
    The Master Query consumes normalized observations.
    """

    mission = "Mars Odyssey"
    instrument = "THEMIS"

    def query(
        self,
        latitude: float,
        longitude: float,
        *,
        observation_time: str | None = None,
    ) -> dict[str, Any]:

        return {
            "surface_temperature_k": None,
            "surface_temperature_c": None,
            "observation_time": observation_time,
            "source": "NASA THEMIS",
            "resolution_m": None,
            "confidence": None,
            "status": "awaiting_validated_thermal_product",
        }
