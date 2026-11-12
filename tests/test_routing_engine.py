import math

import numpy as np
import pytest

from science.routing.engine import evaluate_route, plan_route_candidates, simplify
from science.routing.evidence import EvidenceItem
from science.routing.metrics import pareto_flags, terrain_risk_proxy, unwrap_longitude
from science.routing.objectives import OBJECTIVE_KEYS, PRESETS, normalise_weights
from tests.synthetic_terrain import ridge_grid

START = {"latitude_deg": -5.40, "longitude_deg": 137.70}
DESTINATION = {"latitude_deg": -5.40, "longitude_deg": 137.90}


@pytest.fixture(scope="module")
def grid():
    return ridge_grid()


@pytest.fixture(scope="module")
def evidence():
    return [
        # On the direct corridor: a science-weighted route can reach it cheaply.
        EvidenceItem("ev-1", "USGS test", "named_landform", "Target A", -5.395, 137.80, 1.5, "NASA REFERENCE", "test"),
        # Far off-corridor with a small engagement radius: must NOT be counted.
        EvidenceItem("ev-2", "THEMIS test", "thermal", "Target B", -5.60, 137.75, 0.5, "NASA OBSERVED", "test"),
    ]


@pytest.fixture(scope="module")
def result(grid, evidence):
    return plan_route_candidates(START, DESTINATION, grid=grid, evidence=evidence,
                                 weights={"eva": 35, "terrain": 30, "science": 20, "operational": 15})


# --------------------------------------------------------------- coordinates


@pytest.mark.parametrize("value,expected", [(350.0, -10.0), (10.0, 10.0), (190.0, -170.0), (-190.0, 170.0), (180.0, 180.0)])
def test_longitude_0_360_to_180(value, expected):
    from science.usgs.robinson import to_longitude_180

    assert to_longitude_180(value) == pytest.approx(expected)


def test_unwrap_longitude_across_prime_meridian():
    assert unwrap_longitude(359.0, 1.0) == pytest.approx(-1.0)
    assert unwrap_longitude(1.0, 359.0) == pytest.approx(361.0)


def test_candidate_coordinates_are_normalised_0_360(result):
    for candidate in result["candidates"]:
        for point in candidate["coordinates"]:
            assert 0.0 <= point["longitude_deg"] < 360.0
            assert -90.0 <= point["latitude_deg"] <= 90.0


# --------------------------------------------------------------- candidates


def test_candidates_start_and_end_exactly_on_request(result):
    for candidate in result["candidates"]:
        first, last = candidate["coordinates"][0], candidate["coordinates"][-1]
        assert first["latitude_deg"] == pytest.approx(START["latitude_deg"], abs=1e-6)
        assert first["longitude_deg"] == pytest.approx(START["longitude_deg"], abs=1e-6)
        assert last["longitude_deg"] == pytest.approx(DESTINATION["longitude_deg"], abs=1e-6)


def test_candidates_are_genuinely_different_not_perturbations(result):
    assert len(result["candidates"]) >= 3
    distances = sorted(c["metrics"]["distance_km"] for c in result["candidates"])
    burdens = sorted(c["metrics"]["terrain_burden_score"] for c in result["candidates"])
    assert distances[-1] - distances[0] > 0.5
    assert burdens[-1] - burdens[0] > 1.0


def test_low_terrain_candidate_beats_low_distance_on_burden(result):
    by_key = {c["key"]: c for c in result["candidates"]}
    by_key.update({k: c for c in result["candidates"] for k in c["also_optimal_for"]})
    assert by_key["LOW_TERRAIN"]["metrics"]["terrain_burden_score"] <= by_key["LOW_DISTANCE"]["metrics"]["terrain_burden_score"]
    assert by_key["LOW_DISTANCE"]["metrics"]["distance_km"] <= by_key["LOW_TERRAIN"]["metrics"]["distance_km"] + 1e-6


def test_waypoint_limit_respected_for_route_editor(result):
    for candidate in result["candidates"]:
        assert 2 <= len(candidate["coordinates"]) <= 32


def test_every_required_metric_field_present(result):
    required = [
        "distance_km", "estimated_eva_hours", "mean_slope_deg", "max_slope_deg", "mean_roughness_m",
        "max_roughness_m", "elevation_min_m", "elevation_max_m", "elevation_gain_m", "elevation_loss_m",
        "terrain_burden_score", "terrain_risk_proxy", "science_opportunity_score", "science_evidence_count",
        "data_support_score", "objective_score", "route_generation_time_ms",
    ]
    for candidate in result["candidates"]:
        for field in required:
            assert field in candidate["metrics"]


def test_timing_is_recorded(result):
    for key in ("terrain_sampling_ms", "candidate_generation_ms", "scoring_ms", "total_ms"):
        assert result["timing_ms"][key] >= 0


def test_engine_rejects_windows_beyond_the_bounded_limit(grid):
    with pytest.raises(ValueError, match="bounded planning window|limit"):
        plan_route_candidates(START, {"latitude_deg": 20.0, "longitude_deg": 200.0}, grid=grid, evidence=[])


# --------------------------------------------------------------- objectives


def test_weights_always_sum_to_100():
    for weights in ({"eva": 1, "terrain": 1, "science": 1, "operational": 0}, {"eva": 33.3, "terrain": 33.3, "science": 33.3, "operational": 0.1}, {}, None):
        assert sum(normalise_weights(weights).values()) == 100


def test_preset_weights_sum_to_100():
    for preset in PRESETS.values():
        assert sum(preset["weights"][k] for k in OBJECTIVE_KEYS) == 100


def test_custom_weights_are_exposed_on_candidates(result):
    assert result["requested_weights"] == {"eva": 35, "terrain": 30, "science": 20, "operational": 15}
    custom = [c for c in result["candidates"] if c["key"] == "CUSTOM" or "CUSTOM" in c["also_optimal_for"]]
    assert custom, "a custom-weight candidate must exist"


def test_objective_score_uses_documented_scalarisation(result):
    for candidate in result["candidates"]:
        expected = sum(candidate["scoring_weights"][k] / 100.0 * candidate["normalised_objectives"][k] for k in OBJECTIVE_KEYS)
        assert candidate["metrics"]["objective_score"] == pytest.approx(expected, abs=5e-4)
        assert all(value >= 1.0 - 1e-6 for value in candidate["normalised_objectives"].values())


# --------------------------------------------------------------- science


def test_science_evidence_counted_only_within_engagement_radius(grid, evidence):
    science = plan_route_candidates(START, DESTINATION, grid=grid, evidence=evidence,
                                    weights={"eva": 0, "terrain": 0, "science": 100, "operational": 0})
    radii = {"ev-1": 1.5, "ev-2": 0.5}
    best = max(c["metrics"]["science_evidence_count"] for c in science["candidates"])
    assert best >= 1, "the reachable evidence item must be engaged by at least one candidate"
    for candidate in science["candidates"]:
        engaged = candidate["metrics"]["science_evidence"]
        # score is the engaged fraction of the catalogued items, never a guess
        assert candidate["metrics"]["science_opportunity_score"] == pytest.approx(100.0 * len(engaged) / 2)
        for item in engaged:
            assert item["min_distance_km"] <= radii[item["id"]] + 1e-6
        # the distant item with a 0.5 km engagement radius is never counted
        assert "ev-2" not in {item["id"] for item in engaged}


def test_science_unavailable_is_none_not_zero(grid):
    result = plan_route_candidates(START, DESTINATION, grid=grid, evidence=[])
    for candidate in result["candidates"]:
        assert candidate["metrics"]["science_opportunity_score"] is None
        assert candidate["metrics"]["science_evidence_count"] is None
        assert any("SCIENCE EVIDENCE UNAVAILABLE" in u for u in candidate["uncertainties"])


# --------------------------------------------------------------- risk / pareto


def test_terrain_risk_proxy_is_deterministic_and_bounded():
    args = dict(max_slope_deg=12.0, p90_slope_deg=8.0, max_roughness_m=40.0,
                elevation_gain_m=300.0, elevation_loss_m=250.0, distance_km=12.0)
    first, components = terrain_risk_proxy(**args)
    second, _ = terrain_risk_proxy(**args)
    assert first == second and 0.0 <= first <= 100.0
    assert sum(components.values()) > 0
    extreme, _ = terrain_risk_proxy(max_slope_deg=90.0, p90_slope_deg=60.0, max_roughness_m=500.0,
                                    elevation_gain_m=9000.0, elevation_loss_m=9000.0, distance_km=100.0)
    assert extreme == pytest.approx(100.0)


def test_terrain_risk_proxy_unavailable_inputs_give_none_not_zero():
    score, components = terrain_risk_proxy(max_slope_deg=None, p90_slope_deg=1.0, max_roughness_m=1.0,
                                           elevation_gain_m=1.0, elevation_loss_m=1.0, distance_km=1.0)
    assert score is None and components is None


def test_pareto_filter_marks_dominated_candidates():
    flags, used = pareto_flags([[1.0, 5.0], [2.0, 6.0], [5.0, 1.0]])
    assert flags == [True, False, True] and used == [0, 1]


def test_pareto_excludes_dimensions_with_missing_values():
    flags, used = pareto_flags([[1.0, None], [2.0, None]])
    assert used == [0] and flags == [True, False]


def test_pareto_flags_present_on_candidates(result):
    assert any(c["pareto_non_dominated"] for c in result["candidates"])
    for candidate in result["candidates"]:
        assert candidate["pareto_label"] in ("PARETO / NON-DOMINATED", "DOMINATED IN THIS SET")


# --------------------------------------------------------------- EVA / evaluate


def test_eva_estimate_uses_configured_pace(grid, evidence):
    slow = plan_route_candidates(START, DESTINATION, grid=grid, evidence=evidence, eva_pace_kmh=1.0, ascent_allowance_m_per_h=0.0)
    candidate = slow["candidates"][0]["metrics"]
    assert candidate["estimated_eva_hours"] == pytest.approx(candidate["distance_km"] / 1.0, rel=1e-6)
    assert candidate["eva_pace_kmh"] == 1.0
    assert slow["candidates"][0]["provenance"]["eva_pace_kmh"] == 1.0


def test_evaluate_route_matches_manual_polyline(grid):
    payload = evaluate_route([{"latitude_deg": -5.40, "longitude_deg": 137.70},
                              {"latitude_deg": -5.40, "longitude_deg": 137.90}], grid=grid, evidence=[])
    assert payload["status"] == "ok"
    assert payload["metrics"]["distance_km"] > 10.0
    assert payload["metrics"]["data_support_score"] == 100.0


def test_simplify_keeps_endpoints_and_vertex_budget():
    coordinates = [(-5.4 + i * 0.001, 137.7 + i * 0.002) for i in range(200)]
    simple, tolerance = simplify(coordinates, cell_km=0.46, limit=8)
    assert simple[0] == coordinates[0] and simple[-1] == coordinates[-1]
    assert len(simple) <= 8 and tolerance > 0


# --------------------------------------------------------------- long traverses


def _synthetic_loader(window):
    """Per-window synthetic terrain so segmentation is testable without MOLA LFS."""
    from tests.synthetic_terrain import ridge_grid

    span = 1.2 * max(window["width_km"], window["height_km"]) / (3396.0 * math.pi / 180.0)
    return ridge_grid(window["center_latitude_deg"], window["center_longitude_deg"], span_deg=span)


def test_long_traverse_is_segmented_not_refused(monkeypatch):
    import science.routing.engine as engine

    monkeypatch.setattr(engine, "load_grid", _synthetic_loader)
    start = {"latitude_deg": -5.0, "longitude_deg": 137.0}
    end = {"latitude_deg": -2.0, "longitude_deg": 141.0}
    result = engine.plan_route_candidates(start, end, evidence=[])
    seg = result["segmentation"]
    assert seg["segmented"] and seg["segment_count"] >= 4
    assert result["message"].startswith("Long traverse detected")
    assert f"{seg['segment_count']} local MOLA segments" in result["message"]
    ids = [c["id"] for c in result["candidates"]]
    assert len(ids) == len(set(ids)) and len(ids) >= 2
    for candidate in result["candidates"]:
        first, last = candidate["coordinates"][0], candidate["coordinates"][-1]
        assert first["latitude_deg"] == pytest.approx(-5.0, abs=1e-6)
        assert first["longitude_deg"] == pytest.approx(137.0, abs=1e-6)
        assert last["latitude_deg"] == pytest.approx(-2.0, abs=1e-6)
        assert last["longitude_deg"] == pytest.approx(141.0, abs=1e-6)
        assert len(candidate["coordinates"]) <= engine.MAX_ROUTE_VERTICES
        m = candidate["metrics"]
        assert m["segment_count"] == seg["segment_count"]
        assert m["distance_km"] == pytest.approx(sum(m["segment_distances_km"]), abs=0.01)
        assert m["distance_km"] >= m["displacement_km"] - 1e-6


def test_every_segment_window_respects_the_bound():
    import science.routing.engine as engine

    a, b = (-5.0, 137.0), (10.0, 150.0)
    anchors = engine.segment_anchors(a, b)
    assert anchors[0] == a and anchors[-1] == b
    for p, q in zip(anchors, anchors[1:]):
        window = engine.planning_window([p, q])
        assert max(window["width_km"], window["height_km"]) <= engine.MAX_WINDOW_KM


def test_great_circle_anchors_lie_on_the_direct_path():
    import science.routing.engine as engine
    from science.routing.metrics import haversine_km

    a, b = (-5.0, 137.0), (0.0, 145.0)
    points = engine.great_circle_points(a, b, 5)
    total = float(haversine_km(*a, *b))
    walked = sum(float(haversine_km(*p, *q)) for p, q in zip(points, points[1:]))
    assert walked == pytest.approx(total, rel=1e-6)


def test_long_polyline_evaluation_is_segmented(monkeypatch):
    import science.routing.engine as engine

    monkeypatch.setattr(engine, "load_grid", _synthetic_loader)
    payload = engine.evaluate_route([{"latitude_deg": -5.0, "longitude_deg": 137.0},
                                     {"latitude_deg": -2.0, "longitude_deg": 141.0}], evidence=[])
    assert payload["segmentation"]["segmented"] and payload["status"] == "ok"
    assert payload["metrics"]["distance_km"] > 250


def test_leg_metric_aggregation_is_exact():
    from science.routing.engine import aggregate_leg_metrics

    legs = [
        {"distance_km": 10.0, "mean_slope_deg": 2.0, "max_slope_deg": 5.0, "p90_slope_deg": 4.0, "mean_roughness_m": 3.0,
         "max_roughness_m": 9.0, "elevation_min_m": -100.0, "elevation_max_m": 50.0, "elevation_gain_m": 100.0,
         "elevation_loss_m": 20.0, "terrain_burden_score": 10.0, "operational_burden_score": 20.0,
         "max_distance_from_safe_haven_km": 5.0, "science_opportunity_score": None, "data_support_score": 100.0,
         "sample_count": 40, "sample_spacing_km": 0.2},
        {"distance_km": 30.0, "mean_slope_deg": 6.0, "max_slope_deg": 12.0, "p90_slope_deg": 9.0, "mean_roughness_m": 7.0,
         "max_roughness_m": 20.0, "elevation_min_m": -300.0, "elevation_max_m": 10.0, "elevation_gain_m": 200.0,
         "elevation_loss_m": 400.0, "terrain_burden_score": 30.0, "operational_burden_score": 40.0,
         "max_distance_from_safe_haven_km": 25.0, "science_opportunity_score": None, "data_support_score": 90.0,
         "sample_count": 120, "sample_spacing_km": 0.2},
    ]
    m = aggregate_leg_metrics(legs, [(0.0, 0.0), (0.0, 1.0)], pace_kmh=2.0, ascent_m_per_h=0.0)
    assert m["distance_km"] == 40.0 and m["estimated_eva_hours"] == pytest.approx(20.0)
    assert m["mean_slope_deg"] == pytest.approx(5.0) and m["max_slope_deg"] == 12.0
    assert m["elevation_gain_m"] == 300.0 and m["elevation_loss_m"] == 420.0
    assert m["elevation_min_m"] == -300.0 and m["elevation_max_m"] == 50.0
    assert m["science_opportunity_score"] is None and m["science_evidence_count"] is None
    assert m["data_support_score"] == pytest.approx(92.5)
