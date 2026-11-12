"""Synthetic terrain windows for planner tests (no network, no MOLA tiles)."""
from __future__ import annotations

import numpy as np

from science.hires.grid import LocalGrid
from science.hires.ladder import TerrainWindow


def synthetic_window(func, lat, lon, half_width_m, res_m, mode="ladder"):
    grid = LocalGrid(float(lat), float(lon), float(half_width_m), float(res_m))
    xs, ys = grid.centers
    xx, yy = np.meshgrid(xs, ys)
    z = func(xx, yy).astype("float32")
    code = 3 if mode == "mola" else 1
    source = np.where(np.isfinite(z), code, 0).astype("uint8")
    index = np.where(np.isfinite(z), 0, -1).astype("int16")
    product = {"product_id": "SYNTHETIC_DTM", "family": "MOLA" if code == 3 else "HIRISE",
               "ledger_id": "MOLA_MEGDR" if code == 3 else "HIRISE_STAC_DTM", "gsd_m": 1.0, "dtm_href": "synthetic"}
    return TerrainWindow(grid, mode, z, source, index, [product], [], np.zeros(z.shape, bool), [])


def wall_with_gap(xx, yy):
    """Flat plain with a 40 m-high, 6 m-thick N-S wall at x = 0 except a 30 m gap at y in [150, 180]."""
    z = np.full(xx.shape, -4400.0)
    wall = (np.abs(xx) < 3) & ~((yy > 150) & (yy < 180))
    z[wall] = -4360.0
    return z


def nodata_with_gap(xx, yy):
    z = -4400.0 + 0.0 * xx
    hole = (np.abs(xx) < 15) & ~((yy < -150) & (yy > -180))
    return np.where(hole, np.nan, z)
