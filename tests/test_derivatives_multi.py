"""Analytic plane, cone and sinusoid at 0, 18 and 60 degrees latitude (WS2 acceptance)."""
from __future__ import annotations

import math
import time

import numpy as np
import pytest

from science.hires import derivatives, reader
from science.hires.grid import LocalGrid
from tests.hires_fixtures import HREF_PREFIX, write_product

LATS = [0.0, 18.0, 60.0]


@pytest.fixture()
def corridor(tmp_path, monkeypatch):
    monkeypatch.setattr(reader, "corridor_dir", lambda: tmp_path)
    return tmp_path


def _read(corridor, name, lat, func):
    write_product(corridor / name, lat, 40.0, func)
    grid = LocalGrid(lat, 40.0, 300.0, 1.0)
    z, _ = reader.read_to_grid(HREF_PREFIX + name, grid)
    return z


@pytest.mark.parametrize("lat", LATS)
def test_plane(corridor, lat):
    z = _read(corridor, "plane.tif", lat, lambda e, n: math.tan(math.radians(18.0)) * n)
    for baseline in (1, 3, 10):
        slope, _ = derivatives.slope_at_baseline(z, 1.0, baseline)
        assert np.nanmedian(slope[40:-40, 40:-40]) == pytest.approx(18.0, abs=0.1)


@pytest.mark.parametrize("lat", LATS)
def test_cone(corridor, lat):
    z = _read(corridor, "cone.tif", lat, lambda e, n: -math.tan(math.radians(12.0)) * np.hypot(e, n))
    slope, _ = derivatives.slope_at_baseline(z, 1.0, 3.0)
    xs, ys = np.meshgrid(*LocalGrid(lat, 40.0, 300.0, 1.0).centers)
    ring = (np.hypot(xs, ys) > 40) & (np.hypot(xs, ys) < 250)
    assert np.nanmedian(slope[ring]) == pytest.approx(12.0, abs=0.15)


@pytest.mark.parametrize("lat", LATS)
def test_sinusoid_max_slope(corridor, lat):
    amplitude, wavelength = 5.0, 200.0
    z = _read(corridor, "sine.tif", lat, lambda e, n: amplitude * np.sin(2 * math.pi * e / wavelength))
    slope, _ = derivatives.slope_at_baseline(z, 1.0, 1.0)
    expected = math.degrees(math.atan(amplitude * 2 * math.pi / wavelength))
    assert np.nanmax(slope[20:-20, 20:-20]) == pytest.approx(expected, abs=0.2)


def test_baseline_dependence_smooths_short_wavelengths():
    xs = np.arange(400) * 1.0
    z = np.tile(0.5 * np.sin(2 * np.pi * xs / 6.0), (400, 1))  # 6 m ripples
    s1, _ = derivatives.slope_at_baseline(z, 1.0, 1.0)
    s20, b20 = derivatives.slope_at_baseline(z, 1.0, 20.0)
    assert b20 == 20.0
    assert np.nanmedian(s1) > 10.0 * np.nanmedian(s20)


def test_detrended_roughness_ignores_a_plane_and_sees_noise():
    rng = np.random.default_rng(2026)
    yy, xx = np.mgrid[0:200, 0:200].astype(float)
    plane = 0.3 * xx + 0.1 * yy
    assert np.nanmax(derivatives.detrended_roughness(plane, 1.0, 5.0)) < 1e-6
    noisy = plane + rng.normal(0, 0.2, plane.shape)
    assert np.nanmedian(derivatives.detrended_roughness(noisy, 1.0, 25.0)) == pytest.approx(0.2, rel=0.1)


def test_directional_slope_sign():
    p, q = np.array([0.1]), np.array([0.0])  # rises to the east
    assert derivatives.directional_slope(p, q, 90.0)[0] > 0 > derivatives.directional_slope(p, q, 270.0)[0]


def test_four_km_window_at_two_meters_slope_timing():
    rng = np.random.default_rng(1)
    z = np.cumsum(rng.normal(0, 0.05, (2000, 2000)), axis=1)
    start = time.perf_counter()
    derivatives.slope_at_baseline(z, 2.0, 3.0)
    assert time.perf_counter() - start < 3.0  # generous for CI runners; real timing is in PERFORMANCE.md
