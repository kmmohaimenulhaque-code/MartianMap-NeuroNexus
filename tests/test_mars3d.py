import pytest

from science.mars3d.layers import (
    exploration_context,
    local_terrain_grid,
    rover_traverses,
    walkability,
)


def test_walkability_is_bounded_monotonic_and_documented():
    assert walkability(0, 0, 0) == 100.0
    assert walkability(90, 500, 5000) == 0.0
    assert walkability(5, 10, 50) > walkability(15, 10, 50) > walkability(15, 40, 50)


def test_traverses_are_parsed_deduplicated_and_decimated():
    line = {"type": "LineString", "coordinates": [[137.0 + i * 1e-4, -4.5, -4500] for i in range(10000)] + [[137.999, -4.5, 0]] * 3}
    multi = {"type": "MultiLineString", "coordinates": [[[77.4, 18.4], [77.41, 18.41]], [[77.41, 18.41], [77.42, 18.43]]]}

    def fake(url):
        geometry = line if "MSL" in url else multi
        return {"features": [{"geometry": geometry, "properties": {"sol": 1980}}]}

    payload = rover_traverses(fetch=fake, use_cache=False)
    msl, m20 = payload["rovers"]
    assert payload["status"] == "ok"
    assert msl["status"] == "OBSERVED" and msl["vertex_count_source"] == 10001
    assert msl["vertex_count_rendered"] <= 4001 and msl["path"][-1] == [137.999, -4.5]
    assert m20["path"] == [[77.4, 18.4], [77.41, 18.41], [77.42, 18.43]] and m20["latest_sol"] == 1980


def test_traverse_source_failure_is_unavailable_not_faked():
    def down(url):
        raise OSError("offline")

    payload = rover_traverses(fetch=down, use_cache=False)
    assert payload["status"] == "unavailable"
    assert all(r["status"] == "UNAVAILABLE" and r["path"] == [] for r in payload["rovers"])


def test_local_grid_is_bounded_and_derived(monkeypatch):
    from tests.synthetic_terrain import ridge_grid

    seen = {}

    def loader(window):
        seen.update(window)
        return ridge_grid(window["center_latitude_deg"], window["center_longitude_deg"], span_deg=0.8)

    payload = local_terrain_grid(-5.4, 137.8, half_width_km=500.0, max_cells=20, loader=loader)
    assert payload["half_width_km"] == 60.0  # clamped to half of the 120 km window
    assert seen["width_km"] <= 120.0
    assert 0 < len(payload["cells"]) <= 21 * 21
    cell = payload["cells"][0]
    assert {"slope_deg", "roughness_m", "relief_m", "walkability", "elevation_m"} <= set(cell)
    assert payload["layers"]["walkability"]["status"] == "DERIVED"
    assert "not a NASA or mission safety certification" in payload["layers"]["walkability"]["method"]


def test_exploration_context_labels_and_honesty():
    payload = exploration_context()
    names = {s["name"] for s in payload["ancient_habitability"]}
    assert {"Gale", "Jezero"} <= names
    assert all("not present-day" in s["classification"] for s in payload["ancient_habitability"])
    regions = {s["name"] for s in payload["ice_study_regions"]}
    assert {"Arcadia Planitia", "Deuteronilus Mensae"} <= regions
    assert all(30 <= s["latitude_deg"] <= 60 for s in payload["ice_study_regions"])
    assert payload["layers"]["swim_water_ice"]["status"] == "UNAVAILABLE"
    assert "certified safe" in payload["boundary"]
