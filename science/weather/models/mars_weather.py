from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from science.weather.config import dust_file
from science.weather.ingestion.dust import DustDataset




class MarsWeatherModel:
    def __init__(self, dust_path: str | Path | None = None):
        self.dust = DustDataset(str(dust_path or dust_file()))

    def get_conditions(
        self,
        sol_index: int,
        latitude: float,
        longitude: float,
    ) -> dict:
        observation = self.dust.observation(
            sol_index=sol_index,
            latitude=latitude,
            longitude=longitude,
        )

        return {
            "sol": observation.sol_index,
            "location": {
                "latitude": observation.latitude,
                "longitude": observation.longitude,
            },
            "solar": {
                "areocentric_longitude_deg": observation.areocentric_longitude,
            },
            "dust": {
                "opacity": observation.opacity,
                "height_km": observation.height_km,
            },
        }

    def close(self) -> None:
        self.dust.close()
