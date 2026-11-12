"""MMGIS parsing, -9999 sentinels, longitude normalization and the offline snapshot (WS4)."""
from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from science.rovers import traverses

WAYPOINTS = {"features": [
    {"geometry": {"type": "Point", "coordinates": [437.23, 18.43, -1937.4]},
     "properties": {"RMC": "92_0", "site": 92, "drive": 0, "sol": 2009, "lon": 437.23, "lat": 18.43,
                    "elev_geoid": -9999.0, "tilt": 9.6, "roll": -9999, "pitch": 3.5, "yaw": 93.2, "dist_m": 6.2,
                    "dist_total_m": 45223.6}},
    {"geometry": {"type": "Point", "coordinates": [None, None]}, "properties": {"RMC": "bad"}},
]}
TRAVERSE = {"features": [
    {"geometry": {"type": "MultiLineString", "coordinates": [[[137.1, -4.6, -4400.0], [137.2, -4.6, -4401.0]],
                                                             [[137.2, -4.6], [137.3, -4.7]]]},
     "properties": {"Length": 12.6}},
    {"geometry": {"type": "LineString", "coordinates": [[-282.7, 18.4], [-282.6, 18.5]]},
     "properties": {"sol": 10, "fromRMC": "1_0", "toRMC": "1_2", "length": 3.0}},
]}


def test_sentinels_become_null_and_longitudes_normalize():
    rows = traverses.normalize_waypoints(WAYPOINTS)
    assert len(rows) == 1
    wp = rows[0]
    assert wp["elev_geoid"] is None and wp["roll"] is None
    assert wp["lon"] == pytest.approx(77.23)
    assert wp["sol"] == 2009 and wp["tilt"] == pytest.approx(9.6)


def test_traverse_parts_and_longitudes():
    drives = traverses.normalize_traverse(TRAVERSE)
    assert len(drives) == 3
    assert drives[2]["coordinates"][0][0] == pytest.approx(77.3)
    assert drives[2]["sol"] == 10 and drives[0]["length_m"] == pytest.approx(12.6)


def test_offline_falls_back_to_dated_snapshot(monkeypatch):
    monkeypatch.setattr(traverses, "_cache", {})

    def boom(*_a, **_k):
        raise OSError("network disabled")
    monkeypatch.setattr(traverses, "_fetch", boom)
    data = traverses.load("msl")
    assert data["origin"] == "snapshot" and "network disabled" in data["live_error"]
    assert len(data["waypoints"]) >= 1386
    tilts = np.array([w["tilt"] for w in data["waypoints"] if w["tilt"] is not None])
    assert 25.0 < tilts.max() < 35.0  # IMU tilt; MSL max about 29 deg


def test_api_serves_snapshot_offline_and_decimates_for_display(monkeypatch):
    monkeypatch.setattr(traverses, "_cache", {})
    monkeypatch.setattr(traverses, "_fetch", lambda *_a, **_k: (_ for _ in ()).throw(OSError("offline")))
    from science.weather.api.environment import app

    client = TestClient(app)
    trav = client.get("/rovers/m2020/traverse", params={"max_vertices": 500}).json()
    assert trav["display_only"] and trav["vertices_display"] <= 500 < trav["vertices_full"]
    assert trav["source"]["ledger_id"] == "MMGIS_M2020_TRAVERSE" and trav["source"]["origin"] == "snapshot"
    latest = client.get("/rovers/msl/latest").json()
    assert latest["latest"]["sol"] >= 5045 and "stand-in" in latest["habitat_stand_in"]
    assert client.get("/rovers/viking/latest").status_code == 404


def test_rdp_keeps_endpoints_and_corners():
    pts = np.array([[0, 0], [1, 0.01], [2, 0], [2, 1], [2, 2]], dtype=float)
    assert list(traverses.rdp(pts, 0.1)) == [0, 2, 4]
