"""Vertical datum normalization: every elevation is reported in meters above the MOLA areoid.

For each product, at least 200 valid pixels (a deterministic regular subsample of the
coarsest overview) are compared with MOLA MEGDR topography. HiRISE is accepted when
|median| <= 30 m, CTX when |median| <= 60 m. If the offset matches a sphere-vs-areoid
mismatch the product is converted with the MOLA areoid; otherwise it is excluded as
DATUM MISMATCH. The residual offset is recorded, never applied silently.
"""
from __future__ import annotations

import json
import math
from datetime import UTC, datetime

import numpy as np
import rasterio
from pyproj import Transformer
from scipy.ndimage import map_coordinates

from science import settings
from science.constants import MARS_RADIUS_M, MOLA_RADIUS_OFFSET_M
from science.hires import reader
from science.hires.grid import GEOGRAPHIC_CRS, LocalGrid
from science.terrain import mola_store

ACCEPT_MEDIAN_M = {"HIRISE": 30.0, "CTX": 60.0}
MIN_SAMPLES = 200
PPD = 128


class MolaSampler:
    """Bilinear samples of MEG128 topography (megt) or planetary radius (megr)."""

    def __init__(self):
        self._maps: dict[str, np.memmap] = {}

    def _tile(self, name: str) -> np.memmap:
        if name not in self._maps:
            self._maps[name] = np.memmap(mola_store.tile_path(name), dtype=">i2", mode="r",
                                         shape=(mola_store.ROWS, mola_store.COLS))
        return self._maps[name]

    def sample(self, lat, lon, kind: str = "t") -> np.ndarray:
        lat = np.asarray(lat, dtype="float64")
        lon = np.asarray(lon, dtype="float64") % 360.0
        out = np.full(lat.shape, np.nan)
        if np.any(np.abs(lat) > 88.0):
            raise ValueError("latitude outside MEG128 coverage (-88..88)")
        band = np.select([lat >= 44.0, lat >= 0.0, lat >= -44.0], [0, 1, 2], 3)
        tile_id = band * 4 + (lon // 90).astype(int)
        for tid in np.unique(tile_id):
            sel = tile_id == tid
            code = mola_store.LAT_BANDS[int(tid) // 4][0]
            name = f"meg{kind}{code}{(int(tid) % 4) * 90:03d}hb"
            lat_min, lat_max, lon_min, _ = mola_store.tile_bounds(name)
            rows = (lat_max - lat[sel]) * PPD - 0.5
            cols = (lon[sel] - lon_min) * PPD - 0.5
            r0, r1 = max(int(math.floor(rows.min())) - 1, 0), min(int(math.ceil(rows.max())) + 2, mola_store.ROWS)
            c0, c1 = max(int(math.floor(cols.min())) - 1, 0), min(int(math.ceil(cols.max())) + 2, mola_store.COLS)
            block = np.asarray(self._tile(name)[r0:r1, c0:c1], dtype="float64")
            vals = map_coordinates(block, [rows - r0, cols - c0], order=1, mode="nearest")
            if kind == "r":
                vals = vals + MOLA_RADIUS_OFFSET_M
            out[sel] = vals
        return out

    def areoid_radius(self, lat, lon) -> np.ndarray:
        return self.sample(lat, lon, "r") - self.sample(lat, lon, "t")

    def on_grid(self, grid: LocalGrid, kind: str = "t") -> np.ndarray:
        lat, lon = grid.latlon_grid
        return self.sample(lat, lon, kind).astype("float32")

    def sphere_to_areoid_offset(self, lat, lon) -> np.ndarray:
        """Add to a sphere-referenced height (r - 3,396,190 m) to get height above the areoid."""
        return MARS_RADIUS_M - self.areoid_radius(lat, lon)


SAMPLER = MolaSampler()


def nmad(values: np.ndarray) -> float:
    return float(1.4826 * np.median(np.abs(values - np.median(values))))


def _datum_path(product_id: str):
    path = settings.cache_root() / "hires" / "datum"
    path.mkdir(parents=True, exist_ok=True)
    return path / f"{product_id}.json"


def check_product(product, sampler: MolaSampler = SAMPLER, *, refresh: bool = False) -> dict:
    """Empirical datum check of one product against MOLA (cached per product id)."""
    path = _datum_path(product.product_id)
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    result = _check(product.dtm_href, product.family, sampler)
    result["checked_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    path.write_text(json.dumps(result, indent=1), encoding="utf-8")
    return result


def _check(href: str, family: str, sampler: MolaSampler) -> dict:
    with rasterio.Env(**reader.GDAL_ENV), rasterio.open(reader.open_path(href)) as ds:
        overviews = ds.overviews(1)
        factor = max(overviews) if overviews else max(1, int(max(ds.width, ds.height) / 1024))
        out_shape = (max(1, ds.height // factor), max(1, ds.width // factor))
        z = ds.read(1, out_shape=out_shape).astype("float64")
        valid = reader._valid(z, ds.nodata)
        sx, sy = ds.width / out_shape[1], ds.height / out_shape[0]
        rows, cols = np.nonzero(valid)
        if rows.size < MIN_SAMPLES:
            return {"accepted": False, "status": "INSUFFICIENT DATA", "n": int(rows.size),
                    "reason": f"only {rows.size} valid pixels at overview {factor}"}
        step = max(1, rows.size // 4000)  # deterministic regular subsample
        rows, cols = rows[::step], cols[::step]
        xs, ys = rasterio.transform.xy(ds.transform, (rows + 0.5) * sy - 0.5, (cols + 0.5) * sx - 0.5)
        lon, lat = Transformer.from_crs(ds.crs, GEOGRAPHIC_CRS, always_xy=True).transform(np.asarray(xs),
                                                                                        np.asarray(ys))
        heights = z[rows, cols]
    mola = sampler.sample(lat, lon, "t")
    ok = np.isfinite(mola)
    d = heights[ok] - mola[ok]
    threshold = ACCEPT_MEDIAN_M[family]
    stats = {"n": int(d.size), "median_m": float(np.median(d)), "nmad_m": nmad(d), "mean_m": float(d.mean()),
             "rmse_m": float(np.sqrt(np.mean(d * d))), "threshold_m": threshold, "overview_factor": int(factor)}
    if abs(stats["median_m"]) <= threshold:
        return {**stats, "accepted": True, "datum_detected": "areoid", "convert": "none",
                "status": "ACCEPTED", "reason": f"|median| {abs(stats['median_m']):.1f} m <= {threshold:.0f} m"}
    converted = d + sampler.sphere_to_areoid_offset(lat[ok], lon[ok])
    if abs(float(np.median(converted))) <= threshold:
        return {**stats, "median_m": float(np.median(converted)), "nmad_m": nmad(converted),
                "median_before_conversion_m": stats["median_m"], "accepted": True, "datum_detected": "sphere",
                "convert": "sphere_to_areoid", "status": "ACCEPTED (CONVERTED)",
                "reason": "offset matches the sphere-vs-areoid difference; converted with the MOLA areoid"}
    return {**stats, "accepted": False, "datum_detected": "unknown", "convert": "none",
            "status": "DATUM MISMATCH", "reason": f"|median| {abs(stats['median_m']):.1f} m > {threshold:.0f} m and "
                                                  "not explained by the sphere/areoid difference"}
