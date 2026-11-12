"""Landing-site manifest and /landing-sites: complete in scope, cited, never invented, every id on the ledger."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from science.landing_sites import LandingSiteRegistry
from science.sources import ledger

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "manifests" / "mars_landing_sites.json"
EXPECTED = {"viking_1", "viking_2", "mars_pathfinder", "mer_a_spirit", "mer_b_opportunity", "phoenix", "msl_curiosity",
            "mars_insight", "mars_2020_perseverance", "beagle_2", "exomars_2016_schiaparelli"}
STATUSES = {"successful_landing", "landed_not_operational", "crash_site"}


@pytest.fixture(scope="module")
def manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def api_body():
    from science.weather.api.environment import app

    return TestClient(app).get("/landing-sites").json()


def test_registry_loads_every_site_in_scope():
    registry = LandingSiteRegistry(MANIFEST)
    assert {s.site_id for s in registry.all()} == EXPECTED


def test_new_landers_carry_published_hirise_positions(manifest):
    sites = {s["site_id"]: s for s in manifest["sites"]}
    beagle = sites["beagle_2"]
    assert (beagle["latitude_deg"], beagle["longitude_deg"]) == (11.52879, 90.43139)  # Bridges et al. 2017
    assert beagle["site_status"] == "landed_not_operational"
    assert "10.1098/rsos.170785" in beagle["source_url"]
    edm = sites["exomars_2016_schiaparelli"]
    assert (edm["latitude_deg"], edm["longitude_deg"]) == (-2.047, 353.79)  # HiRISE ESP_062731_1780
    assert edm["site_status"] == "crash_site"
    assert "ESP_062731_1780" in edm["source_url"]


def test_every_site_is_cited_labeled_and_on_the_ledger(manifest):
    for s in manifest["sites"]:
        assert s["source_url"].startswith("https://"), s["site_id"]
        assert s["coordinate_provenance"], s["site_id"]
        assert s["label"] and s["agency"], s["site_id"]
        assert s["site_status"] in STATUSES, s["site_id"]
        assert ledger.resolve(s["ledger_id"]) is not None, s["ledger_id"]
        assert -90 <= s["latitude_deg"] <= 90 and 0 <= s["longitude_deg"] < 360


def test_scope_exclusions_and_unknown_locations_have_no_coordinates(manifest):
    names = json.dumps([[s["mission"], s["spacecraft"], s["agency"]] for s in manifest["sites"]]).lower()
    for excluded in ("zhurong", "tianwen", "cnsa", "ussr", "mars 2\"", "mars 3\"", "mars 6\"", "polar lander", "deep space 2"):
        assert excluded not in names
    scope = manifest["scope"]
    assert {e["mission"] for e in scope["excluded_by_scope"]} >= {"Mars 2", "Mars 3", "Mars 6", "Tianwen-1 / Zhurong"}
    for entry in scope["omitted_location_unknown"]:
        assert "latitude_deg" not in entry and "longitude_deg" not in entry
    assert set(scope["site_status_values"]) == STATUSES


def test_api_serves_every_site_with_label_status_and_ledger(api_body, manifest):
    assert api_body["count"] == len(manifest["sites"]) == len(EXPECTED)
    by_id = {s["site_id"]: s for s in api_body["sites"]}
    assert set(by_id) == EXPECTED
    for s in api_body["sites"]:
        assert s["label"] and s["site_status"] in STATUSES
        assert ledger.resolve(s["source"]["ledger_id"]) is not None
    assert by_id["beagle_2"]["source"]["ledger_id"] == "HIRISE"
    assert by_id["msl_curiosity"]["source"]["ledger_id"] == "NASA_MARS"
    assert by_id["exomars_2016_schiaparelli"]["label"] == "Schiaparelli"
    assert api_body["scope"]["omitted_location_unknown"]
