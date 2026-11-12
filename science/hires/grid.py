"""LocalGrid: a local metric frame centered on the window (1 unit = 1 m).

The HiRISE/CTX COGs are equirectangular with lat_ts = 0, so their true east-west ground
spacing is res_x * cos(lat) (Appendix A1). LocalGrid reprojects into
``+proj=eqc +lat_ts=<lat0> +lat_0=<lat0> +lon_0=<lon0> +R=3396190``, where x and y are
ground meters at the window center (scale error < 0.3% across a 10 km window at 60°).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from functools import cached_property

import numpy as np
from rasterio.crs import CRS
from rasterio.transform import Affine

from science.constants import MARS_RADIUS_M

MAX_PIXELS_PER_SIDE = 2500
GEOGRAPHIC_CRS = CRS.from_proj4(f"+proj=longlat +R={MARS_RADIUS_M:.0f} +no_defs")


@dataclass(frozen=True)
class LocalGrid:
    lat0: float
    lon0: float
    half_width_m: float
    res_m: float

    def __post_init__(self):
        if not -88.0 <= self.lat0 <= 88.0:
            raise ValueError("latitude outside -88..88")
        if self.res_m <= 0 or self.half_width_m <= 0:
            raise ValueError("half_width_m and res_m must be positive")
        if self.size > MAX_PIXELS_PER_SIDE:
            raise ValueError(f"window would be {self.size} px per side (cap {MAX_PIXELS_PER_SIDE}); raise res_m")

    @property
    def size(self) -> int:
        return int(round(2.0 * self.half_width_m / self.res_m))

    @property
    def shape(self) -> tuple[int, int]:
        return self.size, self.size

    @cached_property
    def crs(self) -> CRS:
        return CRS.from_proj4(
            f"+proj=eqc +lat_ts={self.lat0:.8f} +lat_0={self.lat0:.8f} +lon_0={self.lon0:.8f} "
            f"+x_0=0 +y_0=0 +R={MARS_RADIUS_M:.0f} +units=m +no_defs"
        )

    @property
    def extent_m(self) -> float:
        return self.size * self.res_m / 2.0

    @property
    def transform(self) -> Affine:
        e = self.extent_m
        return Affine(self.res_m, 0.0, -e, 0.0, -self.res_m, e)

    def to_xy(self, lat, lon):
        lat, lon = np.asarray(lat, float), np.asarray(lon, float)
        dlon = (lon - self.lon0 + 180.0) % 360.0 - 180.0
        x = MARS_RADIUS_M * math.cos(math.radians(self.lat0)) * np.radians(dlon)
        y = MARS_RADIUS_M * np.radians(lat - self.lat0)
        return x, y

    def to_latlon(self, x, y):
        x, y = np.asarray(x, float), np.asarray(y, float)
        lat = self.lat0 + np.degrees(y / MARS_RADIUS_M)
        lon = self.lon0 + np.degrees(x / (MARS_RADIUS_M * math.cos(math.radians(self.lat0))))
        return lat, (lon + 180.0) % 360.0 - 180.0

    def to_rowcol(self, x, y):
        e = self.extent_m
        return (e - np.asarray(y, float)) / self.res_m - 0.5, (np.asarray(x, float) + e) / self.res_m - 0.5

    @cached_property
    def centers(self) -> tuple[np.ndarray, np.ndarray]:
        """(x, y) of pixel centers, 1-D each (x grows east, y grows north, row 0 is north)."""
        e, r = self.extent_m, self.res_m
        coords = -e + r * (np.arange(self.size) + 0.5)
        return coords, coords[::-1].copy()

    @cached_property
    def latlon_grid(self) -> tuple[np.ndarray, np.ndarray]:
        xs, ys = self.centers
        xx, yy = np.meshgrid(xs, ys)
        return self.to_latlon(xx, yy)

    def lonlat_bbox(self, pad_m: float = 0.0) -> list[float]:
        e = self.extent_m + pad_m
        lat, lon = self.to_latlon(np.array([-e, e, e, -e]), np.array([-e, -e, e, e]))
        return [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())]

    def key(self) -> str:
        return f"{self.lat0:.6f}_{self.lon0:.6f}_{self.half_width_m:.0f}_{self.res_m:g}"
