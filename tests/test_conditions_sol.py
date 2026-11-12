import math

import pytest

from science.conditions import solar


def test_declination_follows_obliquity():
    assert solar.declination_deg(0) == pytest.approx(0, abs=1e-9)
    assert solar.declination_deg(90) == pytest.approx(25.19, abs=1e-6)
    assert solar.declination_deg(270) == pytest.approx(-25.19, abs=1e-6)


def test_equator_day_is_twelve_hours_and_polar_night_is_zero():
    assert solar.solar(0.0, 120.0)["daylight_h"] == pytest.approx(12.0, abs=1e-6)
    assert solar.solar(-80.0, 90.0)["daylight_h"] == 0.0
    assert solar.solar(80.0, 90.0)["daylight_h"] == 24.0


def test_dust_class_and_direct_beam():
    clear = solar.solar(-4.7, 48.0, tau=0.3)
    storm = solar.solar(-4.7, 196.0, tau=4.6)
    assert clear["dust_class"] == "WITHIN" and storm["dust_class"] == "EXCEED"
    mu = math.sin(math.radians(clear["noon_elevation_deg"]))
    assert clear["noon_direct_beam_fraction"] == pytest.approx(math.exp(-0.3 / mu), abs=1e-3)
    assert solar.solar(-4.7, 48.0, tau=0.7)["dust_class"] == "REVIEW"


def test_conditions_follow_the_console_sol():
    pytest.importorskip("xarray")
    from fastapi.testclient import TestClient

    from science.serve import app

    client = TestClient(app)
    r = client.get("/api/conditions", params={"site": "gale", "sol": 400})
    if r.status_code != 200 or r.json()["dust"].get("status") == "UNAVAILABLE":
        pytest.skip("MY34 dust scenario not present")
    body = r.json()
    assert body["season"]["sol"] == 400 and body["dust"]["my34_sol"] == 400
    assert body["solar"]["ls_deg"] == body["season"]["ls"]


def test_validation_figures_are_downloadable_and_path_safe():
    import json
    from pathlib import Path

    from fastapi.testclient import TestClient

    from science.serve import app

    latest = Path("validation/reports/latest.json")
    if not latest.exists():
        pytest.skip("no validation report")
    fig = json.loads(latest.read_text())["sites"]["gale"]["figures"][0]
    client = TestClient(app)
    r = client.get("/api/" + fig.replace("validation/reports/", "validation/figure/"))
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert client.get("/api/validation/figure/gale/20261020-4c5fb3e5/figures/..%2Fsecret.png").status_code in (400, 404)
    assert client.get("/api/validation/figure/mars/20261020-4c5fb3e5/figures/a.png").status_code == 400
