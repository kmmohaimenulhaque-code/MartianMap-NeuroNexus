from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from science.gazetteer.usgs import USGSMarsGazetteer
from science.landing_sites.registry import LandingSiteRegistry
from science.spatial.mola_unified import MolaUnified
from science.terrain.derivatives import calculate_derivatives
from science.terrain.mola_terrain import MolaTerrainSampler


DEFAULT_GAZETTEER = (
    "data/processed/gazetteer/"
    "mars_nomenclature_center_pts.parquet"
)

DEFAULT_LANDING_SITES = (
    "data/manifests/mars_landing_sites.json"
)


@dataclass(frozen=True)
class MarsSpatialResult:
    """Combined coordinate-first scientific context for Mars."""

    latitude: float
    longitude: float
    terrain: dict[str, float]
    nearby_features: tuple[dict[str, Any], ...]
    nearby_landing_sites: tuple[dict[str, Any], ...]
    coverage: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "location": {
                "latitude_deg": self.latitude,
                "longitude_deg": self.longitude,
            },
            "terrain": self.terrain,
            "gazetteer": {
                "nearby_features": list(self.nearby_features),
            },
            "landing_sites": {
                "nearby_sites": list(self.nearby_landing_sites),
            },
            "coverage": self.coverage,
        }


class MarsSpatialQuery:
    """
    Coordinate-first Mars scientific query layer.

    Current authoritative sources:

        MOLA
            - elevation
            - terrain derivatives

        USGS Gazetteer
            - named features
            - feature types
            - diameters
            - namesake metadata
            - IAU approval metadata
            - quadrangles
            - geographic bounds

        NASA landing-site registry
            - mission
            - spacecraft
            - landing date
            - region
            - coordinates
            - provenance
    """

    def __init__(
        self,
        mola: MolaUnified | None = None,
        terrain_sampler: MolaTerrainSampler | None = None,
        gazetteer: USGSMarsGazetteer | None = None,
        landing_sites: LandingSiteRegistry | None = None,
    ) -> None:

        self.mola = mola or MolaUnified()

        self.terrain_sampler = (
            terrain_sampler
            or MolaTerrainSampler(self.mola)
        )

        self.gazetteer = (
            gazetteer
            or USGSMarsGazetteer(DEFAULT_GAZETTEER)
        )

        self.landing_sites = (
            landing_sites
            or LandingSiteRegistry(DEFAULT_LANDING_SITES)
        )

    def query(
        self,
        latitude: float,
        longitude: float,
        *,
        gazetteer_radius_km: float = 100.0,
        landing_site_radius_km: float = 1000.0,
    ) -> MarsSpatialResult:

        if not -90.0 <= latitude <= 90.0:
            raise ValueError(
                "latitude must be between -90 and 90"
            )

        if gazetteer_radius_km < 0:
            raise ValueError(
                "gazetteer_radius_km must be non-negative"
            )

        if landing_site_radius_km < 0:
            raise ValueError(
                "landing_site_radius_km must be non-negative"
            )

        longitude = float(longitude) % 360.0

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

        nearby_features = self.gazetteer.nearby(
            latitude,
            longitude,
            radius_km=gazetteer_radius_km,
        )

        # LandingSiteRegistry returns sites ordered by
        # great-circle distance, but does not expose distance.
        # Calculate it here so the AI receives explicit spatial
        # separation rather than an implicit ordering.
        nearby_sites = self.landing_sites.nearest(
            latitude,
            longitude,
            radius_km=landing_site_radius_km,
        )

        import math

        def distance_km(
            lat1: float,
            lon1: float,
            lat2: float,
            lon2: float,
        ) -> float:

            radius = 3389.5

            phi1 = math.radians(lat1)
            phi2 = math.radians(lat2)

            dphi = phi2 - phi1
            dlambda = math.atan2(
                math.sin(
                    math.radians(lon2 - lon1)
                ),
                math.cos(
                    math.radians(lon2 - lon1)
                ),
            )

            a = (
                math.sin(dphi / 2) ** 2
                + math.cos(phi1)
                * math.cos(phi2)
                * math.sin(dlambda / 2) ** 2
            )

            return (
                radius
                * 2
                * math.atan2(
                    math.sqrt(a),
                    math.sqrt(
                        max(0.0, 1.0 - a)
                    ),
                )
            )

        landing_records = []

        for site in nearby_sites:
            record = {
                "site_id": site.site_id,
                "mission": site.mission,
                "spacecraft": site.spacecraft,
                "landing_date": site.landing_date,
                "region": site.region,
                "latitude_deg": site.latitude_deg,
                "longitude_deg": site.longitude_deg,
                "site_status": site.site_status,
                "source_url": site.source_url,
                "coordinate_provenance": (
                    site.coordinate_provenance
                ),
                "distance_km": distance_km(
                    latitude,
                    longitude,
                    site.latitude_deg,
                    site.longitude_deg,
                ),
            }

            landing_records.append(record)

        terrain = {
            "elevation_m": float(
                mola_result["elevation_m"]
            ),
            "slope_deg": float(
                derivatives.slope_deg
            ),
            "aspect_deg": float(
                derivatives.aspect_deg
            ),
            "roughness_m": float(
                derivatives.roughness_m
            ),
        }

        return MarsSpatialResult(
            latitude=float(latitude),
            longitude=longitude,
            terrain=terrain,
            nearby_features=nearby_features,
            nearby_landing_sites=tuple(
                landing_records
            ),
            coverage=str(
                mola_result["coverage"]
            ),
        )
