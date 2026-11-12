from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from science.gazetteer.mars_places import MarsGazetteer
from science.spatial.mola_unified import MolaUnified
from science.terrain.derivatives import calculate_derivatives
from science.terrain.mola_terrain import MolaTerrainSampler


@dataclass(frozen=True)
class MarsSpatialResult:
    """Combined scientific result for one Mars coordinate."""

    latitude: float
    longitude: float
    place_names: tuple[str, ...]
    elevation_m: float
    slope_deg: float
    aspect_deg: float
    roughness_m: float
    coverage: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "place_names": list(self.place_names),
            "elevation_m": self.elevation_m,
            "slope_deg": self.slope_deg,
            "aspect_deg": self.aspect_deg,
            "roughness_m": self.roughness_m,
            "coverage": self.coverage,
        }


class MarsSpatialQuery:
    """
    Coordinate-first scientific query layer.

    Current sources:
        - unified MOLA elevation
        - MOLA-derived terrain derivatives
        - Mars gazetteer

    Additional datasets will plug into this layer later.
    """

    def __init__(
        self,
        mola: MolaUnified | None = None,
        terrain_sampler: MolaTerrainSampler | None = None,
        gazetteer: MarsGazetteer | None = None,
    ) -> None:
        self.mola = mola or MolaUnified()
        self.terrain_sampler = terrain_sampler or MolaTerrainSampler(
            self.mola
        )
        self.gazetteer = gazetteer or MarsGazetteer()

    def query(
        self,
        latitude: float,
        longitude: float,
        *,
        gazetteer_radius_km: float = 100.0,
    ) -> MarsSpatialResult:
        mola_result = self.mola.query(
            latitude,
            longitude,
        )

        terrain_window = self.terrain_sampler.sample(
            latitude,
            longitude,
            radius=2,
        )

        derivatives = calculate_derivatives(
            terrain_window
        )

        nearby_places = self.gazetteer.nearby(
            latitude,
            longitude,
            radius_km=gazetteer_radius_km,
        )

        place_names = tuple(
            place.name
            for place, _distance in nearby_places
        )

        return MarsSpatialResult(
            latitude=float(latitude),
            longitude=float(longitude % 360.0),
            place_names=place_names,
            elevation_m=float(mola_result["elevation_m"]),
            slope_deg=derivatives.slope_deg,
            aspect_deg=derivatives.aspect_deg,
            roughness_m=derivatives.roughness_m,
            coverage=str(mola_result["coverage"]),
        )
