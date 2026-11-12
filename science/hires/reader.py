"""Windowed COG reads into a LocalGrid: local corridor COGs first, then /vsicurl/.

Reads only the source window that covers the grid, at the coarsest overview that is still
at least as fine as the grid, then reprojects in memory. Nodata stays NaN: a grid pixel is
valid only if its nearest source pixel is valid (no filling across gaps).
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

from science import settings
from science.hires.grid import LocalGrid

GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_TIMEOUT": "30",
    "GDAL_HTTP_CONNECTTIMEOUT": "10",
    "GDAL_HTTP_MAX_RETRY": "2",
    "VSI_CACHE": "TRUE",
}
VALID_RANGE_M = (-1.0e5, 1.0e5)  # Mars topography spans about -8.2 km to +21.2 km
WARP_MEM_MB = 32  # GDAL warp working memory per reproject; chunking only, results are unchanged


def corridor_dir() -> Path:
    return settings.PROJECT_ROOT / "data" / "derived" / "corridors"


def local_path_for(href: str) -> Path | None:
    name = href.rsplit("/", 1)[-1]
    candidate = corridor_dir() / name
    return candidate if candidate.exists() else None


def open_path(href: str) -> str:
    local = local_path_for(href)
    if local is not None:
        return str(local)
    if settings.demo_pack_mode():
        raise FileNotFoundError(f"DEMO_PACK: {href.rsplit('/', 1)[-1]} is not in the demo pack")
    settings.check_url(href)
    return "/vsicurl/" + href


def _valid(array: np.ndarray, nodata) -> np.ndarray:
    ok = np.isfinite(array) & (array > VALID_RANGE_M[0]) & (array < VALID_RANGE_M[1])
    if nodata is not None and np.isfinite(nodata):
        ok &= array != nodata
    return ok


def read_to_grid(href: str, grid: LocalGrid, *, resampling: Resampling = Resampling.bilinear,
                 band: int = 1, is_elevation: bool = True) -> tuple[np.ndarray, dict]:
    """Return (float32 array on ``grid`` with NaN for nodata, read metadata)."""
    with rasterio.Env(**GDAL_ENV), rasterio.open(open_path(href)) as ds:
        left, bottom, right, top = transform_bounds(grid.crs, ds.crs, *_grid_bounds(grid), densify_pts=21)
        pad = 2 * max(abs(ds.res[0]), abs(ds.res[1]))
        window = from_bounds(left - pad, bottom - pad, right + pad, top + pad, ds.transform)
        window = window.round_offsets().round_lengths().intersection(Window(0, 0, ds.width, ds.height))
        if window.width <= 0 or window.height <= 0:
            raise ValueError("window outside product footprint")
        native_res = abs(ds.res[0]) * math.cos(math.radians(grid.lat0)), abs(ds.res[1])
        factor = 1
        for ovr in sorted(ds.overviews(band)):
            if min(native_res) * ovr <= grid.res_m:
                factor = ovr
        out_h = max(1, int(math.ceil(window.height / factor)))
        out_w = max(1, int(math.ceil(window.width / factor)))
        # float32 is the products' own dtype; GDAL's bilinear kernel accumulates in double either way, so
        # this halves the source copy (about 35 MB instead of 70 MB for a 1 m HiRISE frame) at no cost.
        data = ds.read(band, window=window, out_shape=(out_h, out_w), resampling=Resampling.nearest,
                       masked=False).astype("float32", copy=False)
        src_transform = ds.window_transform(window) @ rasterio.Affine.scale(window.width / out_w,
                                                                           window.height / out_h)
        valid = _valid(data, ds.nodata) if is_elevation else np.isfinite(data)
        data[~valid] = np.nan
        meta = {"crs": ds.crs.to_proj4(), "native_res_m": [float(abs(ds.res[0])), float(abs(ds.res[1]))],
                "overview_factor": factor, "nodata": None if ds.nodata is None else float(ds.nodata),
                "dtype": ds.dtypes[band - 1], "source_window": [int(window.col_off), int(window.row_off),
                                                              int(window.width), int(window.height)]}
        src_crs = ds.crs
    out = np.full(grid.shape, np.nan, dtype="float32")
    reproject(data, out, src_transform=src_transform, src_crs=src_crs, src_nodata=np.nan,
              dst_transform=grid.transform, dst_crs=grid.crs, dst_nodata=np.nan, resampling=resampling,
              warp_mem_limit=WARP_MEM_MB)
    del data
    # Validity follows the nearest source pixel, so bilinear never extends a product past its gaps.
    mask = np.zeros(grid.shape, dtype="uint8")
    reproject(valid.view("uint8"), mask, src_transform=src_transform, src_crs=src_crs,
              dst_transform=grid.transform, dst_crs=grid.crs, dst_nodata=0, resampling=Resampling.nearest,
              warp_mem_limit=WARP_MEM_MB)
    del valid
    out[mask == 0] = np.nan
    meta["valid_fraction"] = float(np.isfinite(out).mean())
    return out, meta


def _grid_bounds(grid: LocalGrid) -> tuple[float, float, float, float]:
    e = grid.extent_m
    return -e, -e, e, e


def cache_key(*parts) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:20]
