from __future__ import annotations

from pathlib import Path
from typing import Any

from science.spatial.mola_core import MolaSpatialCore
from science.spatial.mola_polar import MolaPolar


class MolaUnified:
    """
    Unified MOLA elevation lookup.

    Routing:
        |latitude| <= 88°  -> MOLA MEGDR 128 ppd global
        |latitude| >  88°  -> MOLA MEGDR 512 ppd polar

    The underlying global and polar engines are independently
    validated against NASA MOLA products.
    """

    GLOBAL_LIMIT = 88.0

    def __init__(
        self,
        catalog_path: str | Path = "data/manifests/mola_tiles.json",
        polar_data_root: str | Path = "data/raw/mola/polar512",
    ):
        self.global_engine = MolaSpatialCore(Path(catalog_path))
        self.polar_engine = MolaPolar(Path(polar_data_root))

    @staticmethod
    def normalize_longitude(longitude: float) -> float:
        return longitude % 360.0

    @classmethod
    def region_for(cls, latitude: float) -> str:
        if not -90.0 <= latitude <= 90.0:
            raise ValueError("latitude must be between -90 and 90 degrees")

        if abs(latitude) <= cls.GLOBAL_LIMIT:
            return "global"

        return "polar"

    def elevation_at(
        self,
        latitude: float,
        longitude: float,
    ) -> float:
        region = self.region_for(latitude)

        if region == "global":
            return self.global_engine.elevation_at(
                latitude,
                longitude,
            )

        return self.polar_engine.elevation_at(
            latitude,
            longitude,
        )

    def query(
        self,
        latitude: float,
        longitude: float,
    ) -> dict[str, Any]:
        normalized_lon = self.normalize_longitude(longitude)
        region = self.region_for(latitude)

        if region == "global":
            result = self.global_engine.query(
                latitude,
                normalized_lon,
            )
        else:
            result = self.polar_engine.query(
                latitude,
                normalized_lon,
            )

        result["coverage"] = region

        return result
