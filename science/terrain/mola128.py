from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class MOLA128Tile:
    path: Path
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    rows: int = 5632
    cols: int = 11520
    pixels_per_degree: int = 128

    def __post_init__(self) -> None:
        expected_bytes = self.rows * self.cols * 2
        actual_bytes = self.path.stat().st_size

        if actual_bytes != expected_bytes:
            raise ValueError(
                f"Unexpected MOLA tile size: "
                f"{actual_bytes} bytes, expected {expected_bytes}"
            )

    @property
    def latitude_step(self) -> float:
        return 1.0 / self.pixels_per_degree

    @property
    def longitude_step(self) -> float:
        return 1.0 / self.pixels_per_degree

    def _validate_coordinate(
        self,
        latitude: float,
        longitude: float,
    ) -> None:
        if not self.lat_min <= latitude <= self.lat_max:
            raise ValueError(
                f"Latitude {latitude} outside tile range "
                f"{self.lat_min} to {self.lat_max}"
            )

        if not self.lon_min <= longitude <= self.lon_max:
            raise ValueError(
                f"Longitude {longitude} outside tile range "
                f"{self.lon_min} to {self.lon_max}"
            )

    def pixel_index(
        self,
        latitude: float,
        longitude: float,
    ) -> tuple[int, int]:
        self._validate_coordinate(latitude, longitude)

        row = int(np.floor((self.lat_max - latitude) * self.pixels_per_degree))
        col = int(np.floor((longitude - self.lon_min) * self.pixels_per_degree))

        row = min(max(row, 0), self.rows - 1)
        col = min(max(col, 0), self.cols - 1)

        return row, col

    def pixel_center(
        self,
        row: int,
        col: int,
    ) -> tuple[float, float]:
        latitude = (
            self.lat_max
            - (row + 0.5) / self.pixels_per_degree
        )
        longitude = (
            self.lon_min
            + (col + 0.5) / self.pixels_per_degree
        )

        return latitude, longitude

    def elevation(
        self,
        latitude: float,
        longitude: float,
    ) -> int:
        row, col = self.pixel_index(latitude, longitude)

        data = np.memmap(
            self.path,
            dtype=">i2",
            mode="r",
            shape=(self.rows, self.cols),
        )

        return int(data[row, col])
