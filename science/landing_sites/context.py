from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from science.gazetteer.mars_places import MarsGazetteer
from science.landing_sites import LandingSite
from science.spatial.mola_core import MolaSpatialCore
from science.terrain.derivatives import calculate_derivatives
from science.terrain.mola_terrain import MolaTerrainSampler


@dataclass(frozen=True)
class LandingSiteContext:
    site_id: str
    mission: str
    spacecraft: str
    region: str
    latitude_deg: float
    longitude_deg: float

    elevation_m: float
    slope_deg: float
    aspect_deg: float
    roughness_m: float

    nearby_places: tuple[str, ...]


class LandingSiteContextBuilder:
    """
    Builds a scientific spatial context around a Mars landing site.

    Sources:
      - NASA landing-site registry
      - MOLA topography
      - MOLA-derived terrain derivatives
      - Mars gazetteer
    """

    def __init__(
        self,
        mola_catalog: str | Path,
        gazetteer: MarsGazetteer,
    ) -> None:
        self.mola = MolaSpatialCore(Path(mola_catalog))
        self.terrain = MolaTerrainSampler(self.mola)
        self.gazetteer = gazetteer

    def build(self, site: LandingSite) -> LandingSiteContext:
        result = self.mola.query(
            site.latitude_deg,
            site.longitude_deg,
        )

        window = self.terrain.sample(
            site.latitude_deg,
            site.longitude_deg,
            radius=1,
        )

        derivatives = calculate_derivatives(window)

        nearby = self.gazetteer.nearby(
            site.latitude_deg,
            site.longitude_deg,
            radius_km=100.0,
        )

        return LandingSiteContext(
            site_id=site.site_id,
            mission=site.mission,
            spacecraft=site.spacecraft,
            region=site.region,
            latitude_deg=site.latitude_deg,
            longitude_deg=site.longitude_deg,
            elevation_m=result["elevation_m"],
            slope_deg=derivatives.slope_deg,
            aspect_deg=derivatives.aspect_deg,
            roughness_m=derivatives.roughness_m,
            nearby_places=tuple(
                place.name for place in nearby
            ),
        )
