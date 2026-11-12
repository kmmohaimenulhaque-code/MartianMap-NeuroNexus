from __future__ import annotations

import math
from pathlib import Path

import numpy as np


class MolaPolar:
    """
    MOLA MEGDR 512 ppd polar stereographic topography lookup.

    Projection equations follow the official MOLA
    DSMAP_POLAR.CAT definition.

    North:
        LAT = 90 - 2 * atan(R*pi/360) * 180/pi

    South:
        LAT = -90 + 2 * atan(R*pi/360) * 180/pi

    Raster encoding:
        big-endian unsigned 16-bit
        elevation_m = stored * 0.25 - 8000
    """

    RESOLUTION = 512.0
    SIZE = 12288
    OFFSET = 8000.0
    SCALE = 0.25

    def __init__(self, data_root: str | Path = "data/raw/mola/polar512"):
        self.data_root = Path(data_root)

        self.paths = {
            "north": self.data_root / "north" / "megt_n_512_1.img",
            "south": self.data_root / "south" / "megt_s_512_1.img",
        }

        self._rasters: dict[str, np.memmap] = {}

    @staticmethod
    def normalize_longitude(longitude: float) -> float:
        return longitude % 360.0

    @classmethod
    def pixel_from_latlon(
        cls,
        latitude: float,
        longitude: float,
        hemisphere: str,
    ) -> tuple[int, int]:
        """
        Convert planetocentric latitude/longitude to zero-based
        NumPy row/column coordinates.

        Uses the inverse form of the official MOLA polar
        stereographic equations.
        """

        if hemisphere not in {"north", "south"}:
            raise ValueError("hemisphere must be 'north' or 'south'")

        if not -90.0 <= latitude <= 90.0:
            raise ValueError("latitude must be between -90 and 90 degrees")

        longitude = cls.normalize_longitude(longitude)

        if hemisphere == "north" and latitude < 0:
            raise ValueError("north polar lookup requires latitude >= 0")

        if hemisphere == "south" and latitude > 0:
            raise ValueError("south polar lookup requires latitude <= 0")

        if hemisphere == "north":
            angular = (90.0 - latitude) * math.pi / 360.0
        else:
            angular = (90.0 + latitude) * math.pi / 360.0

        r = math.tan(angular) * 360.0 / math.pi

        theta = math.radians(longitude)

        x = r * math.sin(theta)
        y = r * math.cos(theta)

        center = cls.SIZE / 2.0

        sample_pds = x * cls.RESOLUTION + center + 0.5
        line_pds = y * cls.RESOLUTION + center + 0.5

        column = int(math.floor(sample_pds)) - 1
        row = int(math.floor(line_pds)) - 1

        if not (0 <= row < cls.SIZE and 0 <= column < cls.SIZE):
            raise ValueError(
                f"coordinate outside {hemisphere} polar raster: "
                f"lat={latitude}, lon={longitude}"
            )

        return row, column

    @classmethod
    def latlon_from_pixel(
        cls,
        row: int,
        column: int,
        hemisphere: str,
    ) -> tuple[float, float]:
        """
        Convert zero-based NumPy row/column coordinates to
        planetocentric latitude/longitude using the official
        MOLA DSMAP_POLAR.CAT equations.
        """

        if hemisphere not in {"north", "south"}:
            raise ValueError("hemisphere must be 'north' or 'south'")

        if not (0 <= row < cls.SIZE):
            raise ValueError("row outside raster")

        if not (0 <= column < cls.SIZE):
            raise ValueError("column outside raster")

        # Convert zero-based NumPy indices to PDS 1-based coordinates.
        i = column + 1
        j = row + 1

        center = cls.SIZE / 2.0

        x = (i - center - 0.5) / cls.RESOLUTION
        y = (j - center - 0.5) / cls.RESOLUTION

        r = math.sqrt(x * x + y * y)

        longitude = math.degrees(math.atan2(x, y))
        longitude %= 360.0

        angle = 2.0 * math.atan(r * math.pi / 360.0)

        if hemisphere == "north":
            latitude = 90.0 - math.degrees(angle)
        else:
            latitude = -90.0 + math.degrees(angle)

        return latitude, longitude

    def _open(self, hemisphere: str) -> np.memmap:
        if hemisphere in self._rasters:
            return self._rasters[hemisphere]

        path = self.paths[hemisphere]

        if not path.exists():
            raise FileNotFoundError(path)

        expected_bytes = self.SIZE * self.SIZE * 2
        actual_bytes = path.stat().st_size

        if actual_bytes != expected_bytes:
            raise ValueError(
                f"{path} has {actual_bytes} bytes; "
                f"expected {expected_bytes}"
            )

        raster = np.memmap(
            path,
            dtype=">u2",
            mode="r",
            shape=(self.SIZE, self.SIZE),
        )

        self._rasters[hemisphere] = raster

        return raster

    @classmethod
    def decode_elevation(cls, stored_value: int) -> float:
        return float(stored_value) * cls.SCALE - cls.OFFSET

    def elevation_at(
        self,
        latitude: float,
        longitude: float,
    ) -> float:
        if latitude == 0:
            raise ValueError("polar lookup requires non-zero latitude")

        hemisphere = "north" if latitude > 0 else "south"

        row, column = self.pixel_from_latlon(
            latitude,
            longitude,
            hemisphere,
        )

        raster = self._open(hemisphere)

        stored = int(raster[row, column])

        return self.decode_elevation(stored)

    def query(
        self,
        latitude: float,
        longitude: float,
    ) -> dict[str, object]:
        hemisphere = "north" if latitude > 0 else "south"

        row, column = self.pixel_from_latlon(
            latitude,
            longitude,
            hemisphere,
        )

        raster = self._open(hemisphere)

        stored = int(raster[row, column])
        elevation = self.decode_elevation(stored)

        return {
            "latitude": latitude,
            "longitude": self.normalize_longitude(longitude),
            "hemisphere": hemisphere,
            "row": row,
            "column": column,
            "stored_value": stored,
            "elevation_m": elevation,
            "dataset": "MOLA MEGDR Polar 512 ppd",
            "projection": "POLAR STEREOGRAPHIC",
        }
