from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class MarsQueryResult:
    location: dict[str, float]
    terrain: dict[str, Any] = field(default_factory=dict)
    thermal: dict[str, Any] = field(default_factory=dict)
    imagery: dict[str, Any] = field(default_factory=dict)
    geology: dict[str, Any] = field(default_factory=dict)
    mineralogy: dict[str, Any] = field(default_factory=dict)
    water_ice: dict[str, Any] = field(default_factory=dict)
    atmosphere: dict[str, Any] = field(default_factory=dict)
    weather: dict[str, Any] = field(default_factory=dict)
    dust: dict[str, Any] = field(default_factory=dict)
    subsurface: dict[str, Any] = field(default_factory=dict)
    missions: dict[str, Any] = field(default_factory=dict)
    solar_environment: dict[str, Any] = field(default_factory=dict)
    asteroids: dict[str, Any] = field(default_factory=dict)
    survival: dict[str, Any] = field(default_factory=dict)
    provenance: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "location": self.location,
            "terrain": self.terrain,
            "thermal": self.thermal,
            "imagery": self.imagery,
            "geology": self.geology,
            "mineralogy": self.mineralogy,
            "water_ice": self.water_ice,
            "atmosphere": self.atmosphere,
            "weather": self.weather,
            "dust": self.dust,
            "subsurface": self.subsurface,
            "missions": self.missions,
            "solar_environment": self.solar_environment,
            "asteroids": self.asteroids,
            "survival": self.survival,
            "provenance": self.provenance,
        }


class MasterMarsQuery:
    """
    Canonical orchestration layer for NeuroNexus.

    Individual scientific datasets plug into this layer.
    The master query owns the common spatial context contract.
    """

    SUPPORTED_VARIABLES = {
        "terrain",
        "temperature",
        "thermal",
        "imagery",
        "geology",
        "mineralogy",
        "water",
        "water_ice",
        "atmosphere",
        "weather",
        "dust",
        "subsurface",
        "missions",
        "solar_environment",
        "asteroids",
        "survival",
    }

    def query(
        self,
        latitude: float,
        longitude: float,
        *,
        variables: list[str] | None = None,
        include_provenance: bool = True,
    ) -> MarsQueryResult:

        if not -90.0 <= latitude <= 90.0:
            raise ValueError("latitude must be between -90 and 90")

        longitude %= 360.0

        requested = variables or sorted(self.SUPPORTED_VARIABLES)

        unknown = set(requested) - self.SUPPORTED_VARIABLES
        if unknown:
            raise ValueError(
                f"Unsupported variables: {sorted(unknown)}"
            )

        result = MarsQueryResult(
            location={
                "latitude_deg": latitude,
                "longitude_deg": longitude,
            }
        )

        # Existing validated terrain engine.
        if "terrain" in requested:
            result.terrain = self._terrain(latitude, longitude)

        # Temperature is intentionally a first-class field.
        # Actual NASA thermal products will populate this adapter.
        if "temperature" in requested or "thermal" in requested:
            try:
                from science.imagery.themis_thermal import ThemisThermalAdapter

                thermal = ThemisThermalAdapter().query(
                    latitude,
                    longitude,
                )
            except Exception as exc:
                thermal = self._thermal_placeholder()
                thermal["error"] = str(exc)

        if "imagery" in requested:
            result.imagery = {
                "status": "adapter_pending",
                "sources": ["THEMIS VIS-GEO"],
            }

        if "geology" in requested:
            result.geology = {"status": "adapter_pending"}

        if "mineralogy" in requested:
            result.mineralogy = {
                "status": "adapter_pending",
                "candidate_sources": ["CRISM"],
            }

        if "water" in requested or "water_ice" in requested:
            result.water_ice = {
                "status": "adapter_pending",
                "candidate_sources": ["GRS", "SHARAD"],
            }

        if "atmosphere" in requested:
            result.atmosphere = {"status": "adapter_pending"}

        if "weather" in requested:
            result.weather = {"status": "adapter_pending"}

        if "dust" in requested:
            result.dust = {"status": "adapter_pending"}

        if "subsurface" in requested:
            result.subsurface = {
                "status": "adapter_pending",
                "candidate_sources": ["SHARAD"],
            }

        if "missions" in requested:
            result.missions = self._mission_context(
                latitude,
                longitude,
            )

        if "solar_environment" in requested:
            result.solar_environment = {"status": "adapter_pending"}

        if "asteroids" in requested:
            result.asteroids = {"status": "adapter_pending"}

        if "survival" in requested:
            result.survival = {
                "status": "derived_engine_pending"
            }

        if include_provenance:
            result.provenance.append({
                "component": "MasterMarsQuery",
                "project": "NeuroNexus",
                "status": "orchestration_contract",
            })

        # Survival indicators are derived only from validated query evidence.
        try:
            from science.survival.mars_survival import MarsSurvivalEngine

            survival = MarsSurvivalEngine().evaluate({
                "terrain": result.terrain,
                "thermal": result.thermal,
                "missions": result.missions,
            })
        except Exception as exc:
            survival = {
                "status": "survival_engine_error",
                "error": str(exc),
            }

        result.survival = survival

        return result

    @staticmethod
    def _thermal_placeholder() -> dict[str, Any]:
        return {
            "surface_temperature_k": None,
            "surface_temperature_c": None,
            "day_night_context": None,
            "observation_time": None,
            "source": None,
            "resolution_m": None,
            "confidence": None,
            "status": "thermal_adapter_pending",
        }


    @staticmethod
    def _mission_context(latitude: float, longitude: float) -> dict[str, Any]:
        context: dict[str, Any] = {
            "landing_sites": [],
            "nearby_features": [],
        }

        try:
            from science.landing_sites.registry import LandingSiteRegistry

            registry = LandingSiteRegistry(
                "data/manifests/mars_landing_sites.json"
            )

            nearest = registry.nearest(
                latitude,
                longitude,
                radius_km=100.0,
            )

            context["landing_sites"] = [
                {
                    "site_id": site.site_id,
                    "mission": site.mission,
                    "spacecraft": site.spacecraft,
                    "landing_date": site.landing_date,
                    "region": site.region,
                    "latitude_deg": site.latitude_deg,
                    "longitude_deg": site.longitude_deg,
                    "distance_km": round(
                        3389.5
                        * 2.0
                        * __import__("math").asin(
                            min(
                                1.0,
                                __import__("math").sqrt(
                                    __import__("math").sin(
                                        __import__("math").radians(
                                            site.latitude_deg - latitude
                                        ) / 2.0
                                    ) ** 2
                                    + __import__("math").cos(
                                        __import__("math").radians(latitude)
                                    )
                                    * __import__("math").cos(
                                        __import__("math").radians(site.latitude_deg)
                                    )
                                    * __import__("math").sin(
                                        __import__("math").radians(
                                            site.longitude_deg - longitude
                                        ) / 2.0
                                    ) ** 2
                                ),
                            )
                        ),
                        3,
                    ),
                }
                for site in nearest
            ]

        except Exception as exc:
            context["landing_sites_error"] = str(exc)

        try:
            from science.gazetteer.usgs import USGSMarsGazetteer

            gaz = USGSMarsGazetteer(
                "data/processed/gazetteer/mars_nomenclature_center_pts.parquet"
            )

            nearby = gaz.nearby(
                latitude,
                longitude,
                radius_km=100.0,
            )

            context["nearby_features"] = [
                {
                    **item,
                    "distance_km": float(item["distance_km"]),
                }
                for item in nearby[:10]
            ]

        except Exception as exc:
            context["gazetteer_error"] = str(exc)

        return context

    @staticmethod
    def _terrain(latitude: float, longitude: float) -> dict[str, Any]:
        try:
            from science.spatial.mola_unified import MolaUnified
            from science.terrain.mola_terrain import MolaTerrainSampler
            from science.terrain.derivatives import calculate_derivatives

            mola = MolaUnified()
            sampler = MolaTerrainSampler(mola)
            window = sampler.sample(
                latitude,
                longitude,
                radius=2,
                spacing_deg=1 / 128,
            )
            derivatives = calculate_derivatives(window)

            return {
                "elevation_m": float(window.elevations_m[2, 2]),
                "slope_deg": float(derivatives.slope_deg),
                "aspect_deg": float(derivatives.aspect_deg),
                "roughness_m": float(derivatives.roughness_m),
                "source": "NASA MOLA MEGDR",
            }

        except Exception as exc:
            return {
                "status": "terrain_query_failed",
                "error": str(exc),
            }


if __name__ == "__main__":
    engine = MasterMarsQuery()

    result = engine.query(
        -4.5895,
        137.4417,
        variables=[
            "terrain",
            "temperature",
            "imagery",
            "water_ice",
            "missions",
            "survival",
        ],
    )

    import json
    print(json.dumps(result.to_dict(), indent=2))
