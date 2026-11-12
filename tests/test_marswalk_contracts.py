"""Marswalk API contracts: schemas, input caps, uniform error JSON, every ledger id resolves (T8.3)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from science.hires import ladder
from science.marswalk import planner
from science.sources import ledger
from tests.marswalk_fixtures import synthetic_window

REQ = {"base": {"lat": -4.70, "lon": 137.396}, "targets": [{"lat": -4.70, "lon": 137.404}], "eva_hours": 4, "res_m": 2}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(ladder, "build_window", lambda lat, lon, hw, res, mode="ladder":
                        synthetic_window(lambda xx, yy: -4400.0 + 0.05 * xx, lat, lon, hw, res, mode))
    monkeypatch.setattr(planner, "_layer_cache", type(planner._layer_cache)())
    monkeypatch.setattr(planner, "science_stops", lambda ev, points, window: [])
    from science.weather.api.environment import app
    return TestClient(app)


def _ledger_ids(node, found):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "ledger_id" and v is not None:
                found.add(v)
            else:
                _ledger_ids(v, found)
    elif isinstance(node, list):
        for v in node:
            _ledger_ids(v, found)
    return found


def test_plan_contract(client):
    body = client.post("/marswalk/plan", json=REQ).json()
    for key in ("plan_id", "engine_version", "config_hash", "data_versions", "source_ids", "geometry", "segments",
                "profile", "turnaround", "budget", "summary", "dose", "science_stops", "warnings", "limitations", "status"):
        assert key in body, key
    assert set(body["turnaround"]) >= {"distance_m", "lat", "lon", "reached_target"}
    assert set(body["budget"]) >= {"outbound_h", "return_h", "reserve_h", "margin_h", "metabolic_kcal_est", "o2_kg_est",
                                   "water_l_est"}
    assert body["status"]["value"] in {"WITHIN PLANNING LIMITS", "REVIEW REQUIRED", "EXCEEDS PLANNING LIMIT"}
    assert "SAFE" not in body["status"]["value"]
    ids = _ledger_ids(body, set()) | set(body["source_ids"])
    assert ids and all(ledger.resolve(i) for i in ids), [i for i in ids if not ledger.resolve(i)]


def test_brief_round_trip(client):
    plan_id = client.post("/marswalk/plan", json=REQ).json()["plan_id"]
    brief = client.get(f"/marswalk/brief/{plan_id}").json()
    assert brief["schema"] == "neuronexus.eva-brief.v1"
    assert all(ledger.resolve(v["ledger_id"]) for v in brief["values"].values())
    assert {s["ledger_id"] for s in brief["sources"]} >= {"NEURONEXUS_METABOLIC_PROXY", "HIRISE_STAC_DTM"}
    page = client.get(f"/marswalk/brief/{plan_id}?format=html")
    assert page.status_code == 200 and "Sources used" in page.text and "Radiation screening" in page.text
    assert "🏷" not in page.text  # no emoji in printed output
    assert brief["dose"]["ledger_id"] == "NEURONEXUS_DOSE_SCREENING"


@pytest.mark.parametrize("payload,status", [
    ({**REQ, "targets": []}, 422),
    ({**REQ, "terrain_mode": "lidar"}, 422),
    ({**REQ, "targets": [{"lat": -4.70, "lon": 137.60}]}, 422),  # > 8 km
    ({**REQ, "overrides": {"slope_limit_deg": 99}}, 400),
    ({"targets": REQ["targets"]}, 400),
])
def test_input_caps_and_uniform_errors(client, payload, status):
    response = client.post("/marswalk/plan", json=payload)
    assert response.status_code == status
    body = response.json()
    assert set(body) >= {"error", "reason", "hint", "detail"}


def test_evaluate_and_config(client):
    ev = client.post("/marswalk/evaluate", json={"polyline": [[-4.70, 137.396], [-4.70, 137.404]], "eva_hours": 4})
    assert ev.status_code == 200 and ev.json()["segments"]
    # A repeated vertex (drag dropped on its neighbour) used to make NaN and an HTTP 500.
    dup = client.post("/marswalk/evaluate", json={"polyline": [[-4.70, 137.396], [-4.70, 137.396], [-4.70, 137.404]], "eva_hours": 4})
    assert dup.status_code == 200 and dup.json()["summary"]["length_m"]["value"] == ev.json()["summary"]["length_m"]["value"]
    same = client.post("/marswalk/evaluate", json={"polyline": [[-4.70, 137.396], [-4.70, 137.396]], "eva_hours": 4})
    assert same.status_code == 422
    cfg = client.get("/marswalk/config").json()
    assert cfg["parameters"]["slope_limit_deg"]["kind"] == "planning choice"
    assert all(ledger.resolve(p["ledger_id"]) for p in cfg["parameters"].values())
    assert client.get("/marswalk/brief/zzzz").status_code == 400
    assert client.get("/marswalk/brief/0123456789abcdef").status_code == 404


def test_exceeds_status_names_the_slope_limit(monkeypatch):
    # A 31 deg plane: every cell is above the 25 deg limit, and the status must say so.
    monkeypatch.setattr(ladder, "build_window", lambda lat, lon, hw, res, mode="ladder":
                        synthetic_window(lambda xx, yy: -4400.0 + 0.6 * xx, lat, lon, hw, res, mode))
    monkeypatch.setattr(planner, "_layer_cache", type(planner._layer_cache)())
    monkeypatch.setattr(planner, "science_stops", lambda ev, points, window: [])
    from science.weather.api.environment import app
    body = TestClient(app).post("/marswalk/evaluate", json={"polyline": [[-4.70, 137.396], [-4.70, 137.400]], "eva_hours": 4}).json()
    assert body["status"]["value"] == "EXCEEDS PLANNING LIMIT"
    assert any("25 deg slope limit" in r for r in body["status"]["reasons"]), body["status"]["reasons"]
