from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd


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
        """Normalize longitude to the [0, 360) convention used by the dataset."""
        return float(longitude) % 360.0

    @staticmethod
    def _json_safe_value(value):
        """Convert pandas/NumPy missing values and scalars to JSON-safe values."""
        if value is None:
            return None

        try:
            if pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass

        if hasattr(value, "item"):
            try:
                return value.item()
            except (ValueError, TypeError):
                pass

        return value

    @classmethod
    def _row_to_dict(cls, row) -> dict:
        """Convert a GeoDataFrame row into a JSON-safe dictionary."""
        values = row.drop(labels=["geometry"]).to_dict()

        return {
            key: cls._json_safe_value(value)
            for key, value in values.items()
        }

    def all(self) -> tuple[dict, ...]:
        """Return all registered USGS Mars nomenclature features."""
        return tuple(
            self._row_to_dict(row)
            for _, row in self.data.iterrows()
        )

    def find(self, name: str) -> tuple[dict, ...]:
        """Find registered features whose names contain the supplied text."""
        needle = name.strip().lower()

        if not needle:
            return ()

        mask = self.data["feature_name"].str.lower().str.contains(
            needle,
            regex=False,
            na=False,
        )

        return tuple(
            self._row_to_dict(row)
            for _, row in self.data[mask].iterrows()
        )

    def nearest(
        self,
        latitude: float,
        longitude: float,
    ) -> dict | None:
        """Return the nearest registered USGS Mars feature."""

        if not -90.0 <= latitude <= 90.0:
            raise ValueError("latitude must be between -90 and 90")

        longitude = self.normalize_longitude(longitude)

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

        dlon = (
            (lon2 - lon1 + np.pi) % (2 * np.pi)
            - np.pi
        )

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

        index = int(np.argmin(distances_km))

        row = self.data.iloc[index]

        result = self._row_to_dict(row)

        result["distance_km"] = float(distances_km[index])

        return result

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

        dlon = (
            (lon2 - lon1 + np.pi) % (2 * np.pi)
            - np.pi
        )

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

            item = self._row_to_dict(row)

            item["distance_km"] = float(
                distances_km[index]
            )

            results.append(item)

        results.sort(
            key=lambda item: item["distance_km"]
        )

        return tuple(results)
