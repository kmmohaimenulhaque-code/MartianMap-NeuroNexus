"""Mission Console v2: dust endpoints, MIN/MEAN/MAX triplets, route profiles,
multi-route snapshot requests and the Mars Intelligence knowledge layer."""

from datetime import datetime, timezone

import numpy as np
import pytest

from science.routing.engine import evaluate_route, merge_profiles
from science.terrain.api import _window_summary
from science.weather.models.environment_assessment import DUST_LEVELS, classify_dust
from tests.synthetic_terrain import ridge_grid

ROUTE = [{"latitude_deg": -5.5, "longitude_deg": 137.7}, {"latitude_deg": -5.3, "longitude_deg": 137.9}]


# ------------------------------------------------------------------ dust


@pytest.fixture(scope="module")
def dust():
    module = pytest.importorskip("science.weather.api.dust")
    try:
        module.dataset()
    except FileNotFoundError:
        pytest.skip("DustScenario_MY34.nc not available")
    return module


def test_dust_timeseries_covers_the_whole_year(dust):
    series = dust.timeseries(latitude=-5.4, longitude=137.8)
    assert len(series["sol"]) == len(series["tau"]) == len(series["zmax_km"]) == len(series["ls_deg"]) == 668
    assert series["data_class"] == "MODELED"
    stats = series["stats"]["tau"]
    assert stats["min"] <= stats["mean"] <= stats["max"]
    assert series["tau"][series["stats"]["peak_sol"] - 1] == pytest.approx(stats["max"], abs=1e-4)


@pytest.mark.parametrize("lon", [-42.0, 318.0])
def test_dust_longitude_wraps(dust, lon):
    assert dust.timeseries(latitude=20, longitude=lon)["cell"] == dust.timeseries(latitude=20, longitude=-42.0)["cell"]


def test_dust_map_shape_and_bounds(dust):
    payload = dust.dust_map(sol=300)
    assert len(payload["tau"]) == 60 and len(payload["tau"][0]) == 120
    with pytest.raises(Exception):
        dust.dust_map(sol=669)


def test_dust_levels_are_the_assessment_classes():
    for band in DUST_LEVELS:
        assert classify_dust(band["min"]) == band["level"]


# ------------------------------------------------------------------ terrain triplets


def test_window_summary_triplets_ignore_invalid_pixels():
    elevation = np.array([[1.0, 2.0], [3.0, np.nan]])
    slope = np.array([[1.0, 5.0], [9.0, 2.0]])
    rough = np.array([[2.0, 4.0], [6.0, 8.0]])
    summary = _window_summary(elevation, slope, rough)
    assert summary["elevation_m"] == {"min": 1.0, "mean": 2.0, "max": 3.0}
    assert summary["slope_deg"]["min"] == 1.0 and summary["slope_deg"]["max"] == 9.0
    assert summary["valid_pixels"] == 3 and summary["total_pixels"] == 4
    assert summary["slope_max_deg"] == summary["slope_deg"]["max"]  # legacy key kept


# ------------------------------------------------------------------ along-track triplets + profile


def test_evaluate_route_returns_triplets_and_profile():
    result = evaluate_route(ROUTE, grid=ridge_grid(), include_science=False, include_profile=True)
    m = result["metrics"]
    assert m["min_slope_deg"] <= m["mean_slope_deg"] <= m["max_slope_deg"]
    assert m["min_roughness_m"] <= m["mean_roughness_m"] <= m["max_roughness_m"]
    assert m["elevation_min_m"] <= m["mean_elevation_m"] <= m["elevation_max_m"]
    profile = m["profile"]
    assert 2 <= len(profile) <= 256
    distances = [row[0] for row in profile]
    assert distances == sorted(distances) and distances[0] == 0.0
    assert distances[-1] == pytest.approx(m["distance_km"], rel=0.02)


def test_profile_is_opt_in():
    assert "profile" not in evaluate_route(ROUTE, grid=ridge_grid(), include_science=False)["metrics"]


def test_merge_profiles_offsets_legs():
    merged = merge_profiles([[[0.0, 1, 1], [2.0, 2, 1]], [[0.0, 2, 1], [3.0, 5, 1]]])
    assert [row[0] for row in merged] == [0.0, 2.0, 5.0]


# ------------------------------------------------------------------ multi-route snapshot request


def test_snapshot_request_accepts_several_routes():
    from science.usgs.api import SnapshotRequest

    request = SnapshotRequest(routes=[{"name": "A", "colour": "#75e6ff", "coordinates": ROUTE},
                                      {"name": "B", "coordinates": list(reversed(ROUTE))}])
    assert request.coordinates is None and len(request.routes) == 2


# ------------------------------------------------------------------ Mars Intelligence knowledge layer


def test_knowledge_base_finds_cited_sections():
    from science.ai.knowledge_base import KNOWLEDGE

    hits = KNOWLEDGE.search("2018 global dust storm Opportunity", k=3, kinds=("reference",))
    assert hits and hits[0]["evidence_class"] == "NASA REFERENCE"
    assert any("Opportunity" in h["text"] for h in hits)
    ui = KNOWLEDGE.search("compare saved routes 3D", k=3, kinds=("ui",))
    assert ui and ui[0]["kind"] == "ui"


def test_project_scope_excludes_non_partner_programs():
    from science.ai.knowledge_base import KNOWLEDGE

    KNOWLEDGE.ensure()
    text = " ".join(c.text for c in KNOWLEDGE.chunks if c.kind == "reference").lower()
    for term in ("soviet", "ussr", "roscosmos", "tianwen", "zhurong", "cnsa"):
        assert term not in text


def test_new_tools_are_registered_with_declarations():
    from science.ai.tools import DECLARATIONS, TOOLS

    names = {d["name"] for d in DECLARATIONS}
    for name in ("search_mars_knowledge", "search_project_docs", "get_ui_guide", "lookup_mars_place",
                 "get_landing_sites", "get_dust_scenario", "get_terrain_statistics", "mars_calculator"):
        assert name in names and name in TOOLS


@pytest.mark.parametrize("date, ls, my", [
    ("2012-08-06", 150.6, 31),   # Curiosity landing (Ls ≈ 150.7°)
    ("2018-06-10", 190.5, 34),   # MY34 global dust storm, Opportunity's last contact
    ("2024-11-12", 359.8, 37),   # one day before MY38 starts
])
def test_mars_time_matches_known_dates(date, ls, my):
    from science.ai.knowledge_tools import mars_time

    result = mars_time(datetime.fromisoformat(date).replace(tzinfo=timezone.utc))
    assert result["ls_deg"] == pytest.approx(ls, abs=0.5)
    assert result["mars_year"] == my


def test_calculator_rejects_unknown_operations():
    from science.ai.knowledge_tools import mars_calculator

    assert "error" in mars_calculator({}, operation="warp_speed", value="1")
    assert mars_calculator({}, operation="sols_to_earth_days", value="668")["result"] == pytest.approx(686.37, abs=0.1)
