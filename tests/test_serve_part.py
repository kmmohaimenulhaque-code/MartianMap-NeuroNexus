"""API parts for 512 MB hosts: slim routing, health, and selective layers that match the full set."""
from __future__ import annotations

import importlib
import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient

from science.hires import ladder, layers
from science.marswalk import config, planner
from tests.marswalk_fixtures import synthetic_window


def _part(monkeypatch, name):
    # The part sets these module-wide; monkeypatch restores them for the rest of the suite.
    monkeypatch.setattr(ladder, "CACHE_WINDOWS", ladder.CACHE_WINDOWS)
    monkeypatch.setattr(planner, "LAYER_CACHE", planner.LAYER_CACHE)
    monkeypatch.setattr(planner, "MAX_FRAME_SIDE", planner.MAX_FRAME_SIDE)
    monkeypatch.setenv("NN_PART", name)
    sys.modules.pop("science.serve_part", None)
    return importlib.import_module("science.serve_part")


@pytest.mark.parametrize("name,route", [("terrain-window", "/terrain/hires/window"),
                                        ("terrain-image", "/terrain/hires/image"),
                                        ("marswalk", "/marswalk/plan"),
                                        ("usgs", "/usgs/route-snapshot")])
def test_part_serves_only_its_router(monkeypatch, name, route):
    part = _part(monkeypatch, name)
    client = TestClient(part.app)
    health = client.get("/api/health").json()
    assert (health["status"], health["part"], health["heavy_concurrency"]) == ("ok", name, 1)
    assert health["window_cache"] == 2 and health["layer_cache"] == 1
    assert client.get("/api/health").headers["x-neuronexus-served-by"] == name
    paths = client.get("/api/openapi.json").json()["paths"]
    assert route in paths
    assert "/environment" not in paths and "/dust/meta" not in paths  # the full app stays in science.serve


def test_unknown_part_is_refused(monkeypatch):
    with pytest.raises(RuntimeError):
        _part(monkeypatch, "everything")
    sys.modules.pop("science.serve_part", None)


def test_part_keeps_error_contract(monkeypatch):
    client = TestClient(_part(monkeypatch, "terrain-image").app)
    body = client.get("/api/terrain/hires/image?layer=nope&lat=-4.8&lon=137.4").json()
    assert body["error"] and body["reason"]


@pytest.mark.parametrize("only", [{"elevation", "slope_3m", "walk_class", "source"}, {"walkability"},
                                  {"slope_20m", "roughness_25m"}, {"local_relief_3x3"}, set()])
def test_selective_layers_equal_full_compute(only):
    window = synthetic_window(lambda xx, yy: 0.02 * xx + 0.5 * np.sin(yy / 7.0), -4.6, 137.4, 120, 1.0)
    v = config.values(config.resolve())
    full = layers.compute(window, v)
    part = layers.compute(window, v, only=only)
    for name in only | {"elevation", "source"}:
        np.testing.assert_array_equal(part[name], full[name])
    assert "roughness_25m" not in part or "roughness_25m" in only


def test_frame_cap_coarsens_resolution_instead_of_growing_the_frame(monkeypatch):
    """512 MB hosts plan on at most NN_MAX_FRAME_SIDE px per side; the resolution coarsens to fit."""
    pts = [{"lat": -4.8247, "lon": 137.3876}, {"lat": -4.8247, "lon": 137.3673}]  # about 1.2 km apart
    monkeypatch.setattr(planner, "MAX_FRAME_SIDE", 2500)  # the full app
    full = planner._frame(pts, 1.0, 300.0)
    monkeypatch.setattr(planner, "MAX_FRAME_SIDE", 1500)
    capped = planner._frame(pts, 1.0, 300.0)
    assert full[:3] == capped[:3]  # same frame
    assert full[3] == 1.0 and capped[3] > 1.0
    assert 2 * capped[2] / capped[3] <= 1500
