"""LocalGrid scale correction, reader nodata handling and the 10-degree plane acceptance test (T1.5)."""
from __future__ import annotations

import math

import numpy as np
import pytest

from science.hires import derivatives, reader
from science.hires.grid import LocalGrid
from tests.hires_fixtures import HREF_PREFIX, write_product


@pytest.fixture()
def corridor(tmp_path, monkeypatch):
    monkeypatch.setattr(reader, "corridor_dir", lambda: tmp_path)
    return tmp_path


def test_grid_round_trip_and_cap():
    grid = LocalGrid(18.4, 77.4, 500.0, 1.0)
    lat, lon = grid.to_latlon(*grid.to_xy(18.401, 77.399))
    assert lat == pytest.approx(18.401, abs=1e-9) and lon == pytest.approx(77.399, abs=1e-9)
    assert grid.shape == (1000, 1000)
    with pytest.raises(ValueError, match="cap"):
        LocalGrid(18.4, 77.4, 5000.0, 1.0)


@pytest.mark.parametrize("azimuth", [0.0, 45.0, 90.0, 135.0])
def test_ten_degree_plane_at_jezero_latitude_reads_ten_degrees(corridor, azimuth):
    a = math.radians(azimuth)
    tilt = math.tan(math.radians(10.0))
    write_product(corridor / "plane.tif", 18.4, 77.4,
                  lambda e, n: tilt * (e * math.sin(a) + n * math.cos(a)) - 2500.0)
    grid = LocalGrid(18.4, 77.4, 300.0, 1.0)
    z, meta = reader.read_to_grid(HREF_PREFIX + "plane.tif", grid)
    assert meta["valid_fraction"] > 0.95
    slope, baseline = derivatives.slope_at_baseline(z, grid.res_m, 3.0)
    assert baseline == 3.0
    assert np.nanmedian(slope[20:-20, 20:-20]) == pytest.approx(10.0, abs=0.1)


def test_ignoring_cos_lat_would_inflate_east_west_distances(corridor):
    # The plane rises 10 deg to the east; reading pixels as if x spacing were res_x would give ~9.5 deg.
    tilt = math.tan(math.radians(10.0))
    write_product(corridor / "east.tif", 18.4, 77.4, lambda e, n: tilt * e)
    grid = LocalGrid(18.4, 77.4, 300.0, 1.0)
    z, _ = reader.read_to_grid(HREF_PREFIX + "east.tif", grid)
    good, _ = derivatives.slope_at_baseline(z, 1.0, 3.0)
    naive, _ = derivatives.slope_at_baseline(z, 1.0 / math.cos(math.radians(18.4)), 3.0)
    assert np.nanmedian(good) == pytest.approx(10.0, abs=0.1)
    assert np.nanmedian(naive) < 9.6


def test_nodata_stays_nodata(corridor):
    def func(e, n):
        z = 0.01 * e
        z[np.abs(e) < 50] = -3.4028226550889045e38  # a nodata stripe
        return z
    write_product(corridor / "gap.tif", -4.7, 137.4, func)
    grid = LocalGrid(-4.7, 137.4, 300.0, 1.0)
    z, _ = reader.read_to_grid(HREF_PREFIX + "gap.tif", grid)
    xs, _ys = grid.centers
    stripe = np.abs(xs) < 45
    assert np.isnan(z[:, stripe]).all()
    assert np.isfinite(z[50:-50, np.abs(xs) > 60]).all()
