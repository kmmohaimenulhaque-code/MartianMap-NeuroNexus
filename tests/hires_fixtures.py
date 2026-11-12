"""Synthetic GeoTIFFs in the HiRISE/CTX COG projection (eqc, lat_ts = 0, R = 3,396,190 m)."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from science.constants import MARS_RADIUS_M

PRODUCT_CRS = "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs"
HREF_PREFIX = "https://astrogeo-ard.s3-us-west-2.amazonaws.com/synthetic/"


def write_product(path: Path, lat0: float, lon0: float, func, half_m: float = 700.0, res: float = 1.0117,
                  nodata: float = -3.4028226550889045e38) -> Path:
    """Raster whose height is ``func(east_ground_m, north_ground_m)`` around (lat0, lon0)."""
    x0 = MARS_RADIUS_M * math.radians(lon0)
    y0 = MARS_RADIUS_M * math.radians(lat0)
    half_x = half_m / math.cos(math.radians(lat0))  # projected meters needed for half_m of ground
    nx, ny = int(2 * half_x / res), int(2 * half_m / res)
    xs = x0 - half_x + res * (np.arange(nx) + 0.5)
    ys = y0 + half_m - res * (np.arange(ny) + 0.5)
    xx, yy = np.meshgrid(xs, ys)
    lat = np.degrees(yy / MARS_RADIUS_M)
    lon = np.degrees(xx / MARS_RADIUS_M)
    east = MARS_RADIUS_M * np.cos(np.radians(lat)) * np.radians(lon - lon0)
    north = MARS_RADIUS_M * np.radians(lat - lat0)
    z = func(east, north).astype("float32")
    profile = {"driver": "GTiff", "width": nx, "height": ny, "count": 1, "dtype": "float32", "nodata": nodata,
               "crs": PRODUCT_CRS, "transform": from_origin(x0 - half_x, y0 + half_m, res, res)}
    with rasterio.open(path, "w", **profile) as ds:
        ds.write(z, 1)
    return path
