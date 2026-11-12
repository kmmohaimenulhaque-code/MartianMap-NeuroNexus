from __future__ import annotations

from pathlib import Path

ROOT = (
    Path(__file__)
    .resolve()
    .parents[3]
)


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
    """
    Unified Mars environmental context engine.
    """

    def __init__(
        self,
        themis_path: str | Path = THEMIS_DATASET,
        dust_path: str | Path = DUST_DATASET,
        gazetteer_path: str | Path = GAZETTEER_DATASET,
    ) -> None:
        from science.gazetteer.usgs import USGSMarsGazetteer
        from science.thermal.engine.thermal_engine import (
            NeuroNexusThermalEngine,
        )
        from science.weather.models.mars_weather import MarsWeatherModel
        from science.weather.models.terrain_assessment import (
            MarsTerrainAssessment,
        )

        self.thermal = (
            NeuroNexusThermalEngine(
                themis_path
            )
        )

        self.weather = (
            MarsWeatherModel(
                dust_path
            )
        )

        self.terrain = (
            MarsTerrainAssessment()
        )

        self.gazetteer = (
            USGSMarsGazetteer(
                gazetteer_path
            )
        )

    def get_environment(
        self,
        latitude: float,
        longitude: float,
        sol: int,
        solar_longitude: float | None = None,
    ) -> dict:
        """
        Return a unified Mars environmental context.
        """

        gazetteer_feature = (
            self.gazetteer.nearest(
                latitude=latitude,
                longitude=longitude,
            )
        )

        thermal_report = (
            self.thermal.landing_site_report(
                latitude_deg=latitude,
                longitude_deg=longitude,
                solar_longitude_deg=solar_longitude,
                radius_km=50.0,
                nearest_limit=1,
            )
        )

        thermal_observations = thermal_report.get(
            "nearest_observations",
            [],
        )
        report_thermal = thermal_report.get("thermal") or {}
        report_coverage = thermal_report.get("coverage") or {}
        report_landing_site = thermal_report.get("landing_site") or {}
        report_query = thermal_report.get("query") or {}

        sample_count = report_coverage.get(
            "observation_count",
            0,
        )
        search_radius_km = report_landing_site.get(
            "search_radius_km",
            report_query.get("radius_km", 50.0),
        )
        seasonal_coverage = report_coverage.get(
            "seasonal_coverage_fraction",
        )
        if seasonal_coverage is None and sample_count == 0:
            seasonal_coverage = 0.0

        historical_summary = {
            "status": thermal_report.get(
                "status",
                "no_historical_themis_observations"
                if sample_count == 0
                else "historical_themis_report",
            ),
            "source": thermal_report.get(
                "source",
                "NASA THEMIS IR-PBT",
            ),
            "measurement_note": thermal_report.get(
                "measurement_note",
                (
                    "THEMIS IR-PBT provides brightness temperature, "
                    "not a direct measurement of physical surface temperature."
                ),
            ),
            "min_k": report_thermal.get("min_k"),
            "max_k": report_thermal.get("max_k"),
            "mean_k": report_thermal.get("mean_k"),
            "min_c": report_thermal.get("min_c"),
            "max_c": report_thermal.get("max_c"),
            "mean_c": report_thermal.get("mean_c"),
            "coverage": {
                "sample_count": sample_count,
                "valid_sample_count": report_coverage.get(
                    "valid_sample_count",
                    sample_count,
                ),
                "search_radius_km": search_radius_km,
                "years": report_coverage.get("years", 0),
                "observation_years": report_coverage.get(
                    "observation_years",
                    [],
                ),
                "seasonal_coverage": seasonal_coverage,
                "seasonal_coverage_fraction": seasonal_coverage,
                "seasonal_bins": report_coverage.get(
                    "seasonal_bins",
                    0,
                ),
                "seasonal_bins_total": report_coverage.get(
                    "seasonal_bins_total",
                    24,
                ),
            },
        }

        if "day_night" in report_thermal:
            historical_summary["day_night"] = report_thermal[
                "day_night"
            ]
            if all(
                condition in report_thermal["day_night"]
                for condition in ("day", "night")
            ):
                historical_summary["condition_note"] = (
                    "Overall statistics may mix source-classified day "
                    "and night observations."
                )

        dust = (
            self.weather.get_conditions(
                sol_index=sol,
                latitude=latitude,
                longitude=longitude,
            )
        )

        terrain = (
            self.terrain.assess(
                latitude=latitude,
                longitude=longitude,
            )
        )

        return {
            "location": {
                "latitude_deg": latitude,
                "longitude_deg": longitude,
            },
            "gazetteer": {
                "source": (
                    "USGS Gazetteer of "
                    "Planetary Nomenclature"
                ),
                "nearest_feature": (
                    gazetteer_feature
                ),
            },
            "thermal": {
                "source":
                    "NASA THEMIS IR-PBT",
                "measurement":
                    "brightness_temperature",
                "observations":
                    thermal_observations,
                "historical_summary": historical_summary,
            },
            "dust": {
                **dust["dust"],
                "source": (
                    "NASA Ames Mars GCM "
                    "dust scenario MY34"
                ),
            },
            "solar": dust["solar"],
            "terrain": terrain,
        }
