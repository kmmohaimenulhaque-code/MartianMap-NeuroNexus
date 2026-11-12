"""Planner: walls and nodata avoided, determinism, turnaround, pace and metabolic formulas (WS3)."""
from __future__ import annotations

import json
import math

import numpy as np
import pytest

from science.hires import datum, ladder
from science.marswalk import config, eva_model, planner
from tests.marswalk_fixtures import nodata_with_gap, synthetic_window, wall_with_gap

LAT, LON = -4.70, 137.40
WEST = {"lat": LAT, "lon": LON - 0.004}   # about 237 m west of the wall
EAST = {"lat": LAT, "lon": LON + 0.004}


@pytest.fixture()
def terrain(monkeypatch):
    def use(func):
        monkeypatch.setattr(ladder, "build_window", lambda lat, lon, hw, res, mode="ladder":
                            synthetic_window(lambda xx, yy: func(*_shift(xx, yy, lat, lon)), lat, lon, hw, res, mode))
        monkeypatch.setattr(planner, "_layer_cache", type(planner._layer_cache)())
        monkeypatch.setattr(planner, "science_stops", lambda ev, points, window: [])
        monkeypatch.setattr(datum.SAMPLER, "sample", lambda lat, lon, kind="t": -4400.0 + 0.0 * np.asarray(lat))
    return use


def _shift(xx, yy, lat, lon):
    """Window-local x/y -> coordinates relative to the fixed scene origin (LAT, LON)."""
    from science.constants import MARS_RADIUS_M
    dx = MARS_RADIUS_M * math.cos(math.radians(lat)) * math.radians(lon - LON)
    dy = MARS_RADIUS_M * math.radians(lat - LAT)
    return xx + dx, yy + dy


def _plan(**kw):
    req = {"base": WEST, "targets": [EAST], "eva_hours": 4, "terrain_mode": "ladder", "res_m": 2}
    req.update(kw)
    return planner.plan(req)


def _crossing_y(result):
    coords = np.array(result["geometry"]["coordinates"])
    i = int(np.argmin(np.abs(coords[:, 0] - LON)))
    from science.constants import MARS_RADIUS_M
    return MARS_RADIUS_M * math.radians(coords[i, 1] - LAT)


def test_wall_is_avoided_through_the_gap(terrain):
    terrain(wall_with_gap)
    result = _plan()
    assert 145 < _crossing_y(result) < 185
    assert "EXCEEDS PLANNING LIMIT" not in result["summary"]["segments_by_class"]
    assert result["summary"]["length_m"]["value"] > 474  # longer than the straight line


def test_nodata_is_avoided(terrain):
    terrain(nodata_with_gap)
    result = _plan()
    assert -185 < _crossing_y(result) < -145
    assert "UNAVAILABLE" not in result["summary"]["segments_by_class"]


def test_two_runs_are_byte_identical(terrain):
    terrain(wall_with_gap)
    assert json.dumps(_plan(), sort_keys=True) == json.dumps(_plan(), sort_keys=True)


def test_turnaround_before_an_unreachable_target(terrain):
    terrain(lambda xx, yy: -4400.0 + 0.0 * xx)
    result = _plan(eva_hours=0.5, overrides={"reserve_fraction": 0.5})
    assert not result["turnaround"]["reached_target"]
    assert result["turnaround"]["distance_m"] < result["summary"]["length_m"]["value"]
    assert result["status"]["value"] == "EXCEEDS PLANNING LIMIT"
    usable = 0.5 * 0.5
    assert result["budget"]["usable_h"] == pytest.approx(usable)


def test_mola_only_mode_reports_the_coarse_rung(terrain):
    terrain(lambda xx, yy: -4400.0 + 0.0 * xx)
    result = _plan(terrain_mode="mola")
    assert result["summary"]["length_by_source_pct"] == {"MOLA": 100.0}
    assert result["status"]["value"] == "REVIEW REQUIRED"


def test_plan_id_changes_with_config(terrain):
    terrain(lambda xx, yy: -4400.0 + 0.0 * xx)
    assert _plan()["plan_id"] != _plan(overrides={"eva_pace_kmh": 2.0})["plan_id"]


def test_tobler_is_normalized_to_the_flat_pace():
    assert eva_model.tobler_speed_kmh(0.0, 2.5) == pytest.approx(2.5)
    best = math.degrees(math.atan(-0.05))
    assert eva_model.tobler_speed_kmh(best, 2.5) == pytest.approx(2.5 * math.exp(0.175))
    assert eva_model.tobler_speed_kmh(10.0, 2.5) < eva_model.tobler_speed_kmh(-10.0, 2.5) < 2.5 * math.exp(0.175)


def test_naismith_adds_ascent_time():
    v = config.values(config.resolve({"pace_model": "naismith"}))
    t = eva_model.step_times_s(np.array([100.0]), np.array([10.0]), v)[0]
    assert t == pytest.approx(100 / (2.5 / 3.6) + 10 / (600 / 3600))


def test_metabolic_rate_matches_hand_calculation():
    v = config.values(config.resolve())
    speed = 2.5 / 3.6
    gamma = 3.721 / 9.81
    expected = 1.5 * 80 + gamma * (2.0 * 145 * (65 / 80) ** 2 + 1.0 * 145 * (1.5 * speed ** 2))
    assert eva_model.metabolic_rate_w(speed, 0.0, 1.0, v) == pytest.approx(expected)
    uphill = eva_model.metabolic_rate_w(speed, 10.0, 1.0, v)
    assert uphill == pytest.approx(expected + gamma * 145 * 0.35 * speed * 100 * math.tan(math.radians(10)))
    assert eva_model.metabolic_rate_w(speed, -10.0, 1.0, v) == pytest.approx(expected)  # no downhill credit


def test_consumables_formulas_and_band():
    v = config.values(config.resolve())
    c = eva_model.consumables(20.1e6, v)  # 20.1 MJ -> 1000 L O2
    assert c["o2_kg_est"]["value"] == pytest.approx(1.429)
    assert c["water_l_est"]["value"] == pytest.approx(0.5 * 20.1e6 / 2.45e6)
    assert c["metabolic_kcal_est"]["low"] == pytest.approx(c["metabolic_kcal_est"]["value"] * 0.7)


def test_turnaround_rule():
    cum = np.arange(0, 1001, 100.0)
    step = np.full(10, 360.0)  # 0.1 h per 100 m each way
    tp = eva_model.turnaround(cum, step, step, eva_h=1.0, reserve=0.0)
    assert tp["distance_m"] == pytest.approx(500.0) and not tp["reached_target"]


def test_config_rejects_bad_overrides():
    with pytest.raises(ValueError):
        config.resolve({"slope_limit_deg": 90})
    with pytest.raises(ValueError):
        config.resolve({"slope_review_deg": 30, "slope_limit_deg": 20})
    with pytest.raises(ValueError):
        config.resolve({"g_mars": 1.0, "unknown": 1})
