from __future__ import annotations

from pathlib import Path
from math import radians, sin, cos, asin, sqrt
import pyarrow.parquet as pq


MARS_RADIUS_KM = 3396.19


class NeuroNexusThermalEngine:
    def __init__(self, parquet_path: str | Path):
        self.path = Path(parquet_path)
        self.table = pq.read_table(self.path)
        self.rows = self.table.to_pylist()

    @staticmethod
    def _distance_km(lat1, lon1, lat2, lon2):
        p1 = radians(lat1)
        p2 = radians(lat2)
        dp = radians(lat2 - lat1)
        dl = radians(lon2 - lon1)

        a = (
            sin(dp / 2) ** 2
            + cos(p1) * cos(p2) * sin(dl / 2) ** 2
        )

        return 2 * MARS_RADIUS_KM * asin(sqrt(a))

    @staticmethod
    def _seasonal_distance(a, b):
        d = abs(a - b) % 360.0
        return min(d, 360.0 - d)

    def nearest(
        self,
        latitude_deg: float,
        longitude_deg: float,
        solar_longitude_deg: float | None = None,
        limit: int = 10,
    ):
        candidates = []

        for row in self.rows:
            spatial = self._distance_km(
                latitude_deg,
                longitude_deg,
                row["latitude_deg"],
                row["longitude_deg"],
            )

            seasonal = (
                self._seasonal_distance(
                    solar_longitude_deg,
                    row["solar_longitude_deg"],
                )
                if solar_longitude_deg is not None
                else 0.0
            )

            candidates.append(
                (spatial, seasonal, row)
            )

        candidates.sort(key=lambda x: (x[0], x[1]))

        results = []

        for spatial, seasonal, row in candidates[:limit]:
            result = dict(row)
            result["spatial_distance_km"] = round(spatial, 4)
            result["seasonal_distance_deg"] = round(seasonal, 4)
            results.append(result)

        return results

    def seasonal_history(
        self,
        latitude_deg: float,
        longitude_deg: float,
        radius_km: float = 50.0,
    ):
        results = []

        for row in self.rows:
            distance = self._distance_km(
                latitude_deg,
                longitude_deg,
                row["latitude_deg"],
                row["longitude_deg"],
            )

            if distance <= radius_km:
                result = dict(row)
                result["spatial_distance_km"] = round(
                    distance, 4
                )
                results.append(result)

        results.sort(
            key=lambda r: r["solar_longitude_deg"]
        )

        return results


    def landing_site_report(
        self,
        latitude_deg: float,
        longitude_deg: float,
        solar_longitude_deg: float | None = None,
        radius_km: float = 50.0,
        nearest_limit: int = 10,
    ) -> dict:
        """Return a scientifically explicit thermal report for a landing site."""

        observations = self.seasonal_history(
            latitude_deg=latitude_deg,
            longitude_deg=longitude_deg,
            radius_km=radius_km,
        )

        if not observations:
            return {
                "landing_site": {
                    "latitude_deg": latitude_deg,
                    "longitude_deg": longitude_deg,
                },
                "query": {
                    "solar_longitude_deg": solar_longitude_deg,
                    "radius_km": radius_km,
                },
                "coverage": {
                    "observation_count": 0,
                    "seasonal_bins": 0,
                    "years": 0,
                },
                "thermal": None,
                "observations": [],
                "status": "no_historical_themis_observations",
                "source": "NASA THEMIS IR-PBT",
                "measurement_note": (
                    "THEMIS IR-PBT provides brightness temperature, "
                    "not a direct measurement of physical surface temperature."
                ),
            }

        temps = [
            float(o["brightness_temperature_k"])
            for o in observations
            if o.get("brightness_temperature_k") is not None
        ]

        ls_values = [
            float(o["solar_longitude_deg"])
            for o in observations
            if o.get("solar_longitude_deg") is not None
        ]

        years = sorted({
            str(o["observation_start"])[:4]
            for o in observations
            if o.get("observation_start")
        })

        lst_values = [
            float(o["local_solar_time_hours"])
            for o in observations
            if o.get("local_solar_time_hours") is not None
        ]

        # 15-degree seasonal bins, matching the archive sampling strategy.
        seasonal_bins = sorted({
            int(float(o["solar_longitude_deg"]) // 15)
            for o in observations
            if o.get("solar_longitude_deg") is not None
        })

        # Circular largest gap between observations in Ls.
        largest_ls_gap = None
        if len(ls_values) >= 2:
            ordered = sorted(set(ls_values))
            gaps = [
                ordered[i + 1] - ordered[i]
                for i in range(len(ordered) - 1)
            ]
            gaps.append((ordered[0] + 360.0) - ordered[-1])
            largest_ls_gap = max(gaps)

        # Re-query with seasonal preference when an Ls target was supplied.
        nearest = self.nearest(
            latitude_deg=latitude_deg,
            longitude_deg=longitude_deg,
            solar_longitude_deg=solar_longitude_deg,
            limit=nearest_limit,
        )

        return {
            "landing_site": {
                "latitude_deg": latitude_deg,
                "longitude_deg": longitude_deg,
                "search_radius_km": radius_km,
            },
            "query": {
                "solar_longitude_deg": solar_longitude_deg,
            },
            "coverage": {
                "observation_count": len(observations),
                "seasonal_bins": len(seasonal_bins),
                "seasonal_bins_total": 24,
                "seasonal_coverage_fraction": round(
                    len(seasonal_bins) / 24.0, 4
                ),
                "years": len(years),
                "observation_years": years,
                "largest_ls_gap_deg": (
                    round(largest_ls_gap, 3)
                    if largest_ls_gap is not None
                    else None
                ),
                "local_solar_time_min_hours": (
                    round(min(lst_values), 3) if lst_values else None
                ),
                "local_solar_time_max_hours": (
                    round(max(lst_values), 3) if lst_values else None
                ),
            },
            "thermal": {
                "measurement": "BRIGHTNESS_TEMPERATURE",
                "unit": "KELVIN",
                "min_k": round(min(temps), 3) if temps else None,
                "max_k": round(max(temps), 3) if temps else None,
                "mean_k": round(sum(temps) / len(temps), 3)
                if temps else None,
                "min_c": round(min(temps) - 273.15, 3)
                if temps else None,
                "max_c": round(max(temps) - 273.15, 3)
                if temps else None,
                "mean_c": round(
                    sum(temps) / len(temps) - 273.15, 3
                ) if temps else None,
            },
            "nearest_observations": nearest,
            "scientific_constraints": [
                "Brightness temperature is not equivalent to physical surface temperature.",
                "Observations span multiple Mars years and are not one continuous Mars-year time series.",
                "Missing seasonal intervals are not interpolated.",
                "Spatially nearby observations are not assumed to represent the exact landing-site pixel.",
                "Thermal values retain the original THEMIS IR-PBT Kelvin measurement.",
            ],
            "status": "historical_themis_report",
            "source": "NASA THEMIS IR-PBT",
        }

    def coverage_summary(self):
        cells = {
            (
                r["spatial_cell_lat"],
                r["spatial_cell_lon"],
            )
            for r in self.rows
        }

        ls_bins = {
            int(r["solar_longitude_deg"] // 15)
            for r in self.rows
        }

        return {
            "observations": len(self.rows),
            "spatial_cells": len(cells),
            "seasonal_bins": len(ls_bins),
            "seasonal_bins_total": 24,
            "measurement": "BRIGHTNESS_TEMPERATURE",
            "unit": "KELVIN",
            "source": "NASA THEMIS IR-PBT",
        }
