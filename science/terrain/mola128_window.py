from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from science.terrain.mola128_resolver import MOLA128Resolver


MARS_RADIUS_KM = 3396.0
MOLA_PPD = 128
MOLA_DEGREE_STEP = 1.0 / MOLA_PPD


@dataclass(frozen=True)
class TerrainWindow:
    elevations_m: np.ndarray
    latitudes_deg: np.ndarray
    longitudes_deg: np.ndarray
    center_latitude_deg: float
    center_longitude_deg: float
    width_km: float
    height_km: float
    pixels_per_degree: int

    @property
    def rows(self) -> int:
        return int(self.elevations_m.shape[0])

    @property
    def cols(self) -> int:
        return int(self.elevations_m.shape[1])

    @property
    def min_elevation_m(self) -> int:
        return int(self.elevations_m.min())

    @property
    def max_elevation_m(self) -> int:
        return int(self.elevations_m.max())


class MOLA128WindowExtractor:
    def __init__(self, resolver: MOLA128Resolver | None = None):
        self.resolver = resolver or MOLA128Resolver()

    @staticmethod
    def _km_to_lat_degrees(distance_km: float) -> float:
        return np.degrees(distance_km / MARS_RADIUS_KM)

    @staticmethod
    def _km_to_lon_degrees(
        distance_km: float,
        latitude_deg: float,
    ) -> float:
        cos_lat = np.cos(np.radians(latitude_deg))

        if cos_lat <= 1e-8:
            raise ValueError(
                "Longitude span becomes undefined near the poles."
            )

        return np.degrees(
            distance_km / (MARS_RADIUS_KM * cos_lat)
        )

    @staticmethod
    def _coordinate_axis(
        start: float,
        stop: float,
        step: float,
        descending: bool = False,
    ) -> np.ndarray:
        if descending:
            return np.arange(
                stop - step / 2.0,
                start - step / 2.0,
                -step,
                dtype=np.float64,
            )

        return np.arange(
            start + step / 2.0,
            stop + step / 2.0,
            step,
            dtype=np.float64,
        )

    @staticmethod
    def _lat_tile_bounds() -> tuple[tuple[float, float, str], ...]:
        return (
            (44.0, 88.0, "88n"),
            (0.0, 44.0, "44n"),
            (-44.0, 0.0, "00n"),
            (-88.0, -44.0, "44s"),
        )

    @staticmethod
    def _lon_tile_bounds() -> tuple[tuple[float, float, str], ...]:
        return (
            (0.0, 90.0, "000"),
            (90.0, 180.0, "090"),
            (180.0, 270.0, "180"),
            (270.0, 360.0, "270"),
        )

    def _tiles_intersecting(
        self,
        latitudes: np.ndarray,
        longitudes: np.ndarray,
    ) -> list[tuple[np.ndarray, np.ndarray, object]]:
        normalized_longitudes = np.mod(longitudes, 360.0)

        matches: list[tuple[np.ndarray, np.ndarray, object]] = []

        for lat_min, lat_max, lat_code in self._lat_tile_bounds():
            lat_mask = (
                (latitudes >= lat_min)
                & (latitudes <= lat_max)
            )

            if not np.any(lat_mask):
                continue

            lat_indices = np.flatnonzero(lat_mask)
            representative_lat = float(latitudes[lat_indices[0]])

            for lon_min, lon_max, lon_code in self._lon_tile_bounds():
                lon_mask = (
                    (normalized_longitudes >= lon_min)
                    & (normalized_longitudes <= lon_max)
                )

                if not np.any(lon_mask):
                    continue

                lon_indices = np.flatnonzero(lon_mask)
                representative_lon = float(
                    normalized_longitudes[lon_indices[0]]
                )

                tile = self.resolver.tile_for(
                    representative_lat,
                    representative_lon,
                )

                matches.append(
                    (
                        lat_indices,
                        lon_indices,
                        tile,
                    )
                )

        return matches

    @staticmethod
    def _read_tile_block(
        tile,
        latitudes: np.ndarray,
        longitudes: np.ndarray,
    ) -> np.ndarray:
        data = np.memmap(
            tile.path,
            dtype=">i2",
            mode="r",
            shape=(tile.rows, tile.cols),
        )

        local_rows = np.floor(
            (tile.lat_max - latitudes)
            * tile.pixels_per_degree
        ).astype(np.int64)

        normalized_longitudes = np.mod(longitudes, 360.0)

        local_cols = np.floor(
            (normalized_longitudes - tile.lon_min)
            * tile.pixels_per_degree
        ).astype(np.int64)

        local_rows = np.clip(
            local_rows,
            0,
            tile.rows - 1,
        )

        local_cols = np.clip(
            local_cols,
            0,
            tile.cols - 1,
        )

        return np.asarray(
            data[np.ix_(local_rows, local_cols)],
            dtype=np.int16,
        )

    def extract(
        self,
        latitude_deg: float,
        longitude_deg: float,
        width_km: float,
        height_km: float,
    ) -> TerrainWindow:
        if width_km <= 0:
            raise ValueError("width_km must be positive")

        if height_km <= 0:
            raise ValueError("height_km must be positive")

        longitude_deg = longitude_deg % 360.0

        lat_half_span = self._km_to_lat_degrees(
            height_km / 2.0
        )

        lon_half_span = self._km_to_lon_degrees(
            width_km / 2.0,
            latitude_deg,
        )

        lat_min = latitude_deg - lat_half_span
        lat_max = latitude_deg + lat_half_span

        if lat_min < -88.0 or lat_max > 88.0:
            raise ValueError(
                "Requested terrain window crosses the supported "
                "MOLA MEGDR latitude range."
            )

        latitudes = self._coordinate_axis(
            lat_min,
            lat_max,
            MOLA_DEGREE_STEP,
            descending=True,
        )

        longitudes = self._coordinate_axis(
            longitude_deg - lon_half_span,
            longitude_deg + lon_half_span,
            MOLA_DEGREE_STEP,
        )

        normalized_longitudes = np.mod(
            longitudes,
            360.0,
        )

        elevations = np.empty(
            (latitudes.size, longitudes.size),
            dtype=np.int16,
        )

        tile_groups = self._tiles_intersecting(
            latitudes,
            normalized_longitudes,
        )

        for lat_indices, lon_indices, tile in tile_groups:
            selected_latitudes = latitudes[lat_indices]
            selected_longitudes = normalized_longitudes[
                lon_indices
            ]

            block = self._read_tile_block(
                tile,
                selected_latitudes,
                selected_longitudes,
            )

            elevations[
                np.ix_(
                    lat_indices,
                    lon_indices,
                )
            ] = block

        return TerrainWindow(
            elevations_m=elevations,
            latitudes_deg=latitudes,
            longitudes_deg=normalized_longitudes,
            center_latitude_deg=float(latitude_deg),
            center_longitude_deg=float(longitude_deg),
            width_km=float(width_km),
            height_km=float(height_km),
            pixels_per_degree=MOLA_PPD,
        )
