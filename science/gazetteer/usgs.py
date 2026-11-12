from __future__ import annotations

from pathlib import Path

import geopandas as gpd


class USGSMarsGazetteer:
    """Authoritative USGS Mars nomenclature backed by GeoParquet."""

    def __init__(self, parquet_path: str | Path) -> None:
        self.path = Path(parquet_path)

        if not self.path.exists():
            raise FileNotFoundError(self.path)

        self.data = gpd.read_parquet(self.path)

        if len(self.data) != 2052:
            raise RuntimeError(
                f"Expected 2052 USGS Mars features, got {len(self.data)}"
            )

        required = {
            "feature_name",
            "feature_type",
            "diameter_km",
            "latitude_deg",
            "longitude_deg",
            "naming_origin",
            "approval_status",
            "usgs_feature_url",
            "geometry",
        }

        missing = required - set(self.data.columns)

        if missing:
            raise RuntimeError(
                f"Missing Gazetteer fields: {sorted(missing)}"
            )

    @staticmethod
    def normalize_longitude(longitude: float) -> float:
        return float(longitude) % 360.0

    def all(self) -> tuple[dict, ...]:
        return tuple(
            row.drop(labels=["geometry"]).to_dict()
            for _, row in self.data.iterrows()
        )

    def find(self, name: str) -> tuple[dict, ...]:
        needle = name.strip().lower()

        if not needle:
            return ()

        mask = self.data["feature_name"].str.lower().str.contains(
            needle,
            regex=False,
            na=False,
        )

        return tuple(
            row.drop(labels=["geometry"]).to_dict()
            for _, row in self.data[mask].iterrows()
        )

    def nearby(
        self,
        latitude: float,
        longitude: float,
        radius_km: float = 100.0,
    ) -> tuple[dict, ...]:
        """Return USGS features within approximately radius_km."""

        if not -90.0 <= latitude <= 90.0:
            raise ValueError("latitude must be between -90 and 90")

        longitude = self.normalize_longitude(longitude)

        if radius_km < 0:
            raise ValueError("radius_km must be non-negative")

        # Mars spherical approximation for fast spatial lookup.
        import numpy as np

        radius_m = 3_389_500.0
        lat1 = np.radians(latitude)

        lat2 = np.radians(
            self.data["latitude_deg"].to_numpy()
        )

        lon1 = np.radians(longitude)
        lon2 = np.radians(
            self.data["longitude_deg"].to_numpy()
        )

        dlat = lat2 - lat1
        dlon = (lon2 - lon1 + np.pi) % (2 * np.pi) - np.pi

        a = (
            np.sin(dlat / 2) ** 2
            + np.cos(lat1)
            * np.cos(lat2)
            * np.sin(dlon / 2) ** 2
        )

        distances_km = (
            2
            * radius_m
            * np.arcsin(np.sqrt(a))
            / 1000.0
        )

        mask = distances_km <= radius_km

        indices = np.flatnonzero(mask)

        results = []

        for index in indices:
            row = self.data.iloc[index]

            item = row.drop(labels=["geometry"]).to_dict()
            item["distance_km"] = float(distances_km[index])

            results.append(item)

        results.sort(key=lambda item: item["distance_km"])

        return tuple(results)
