import json

import pytest

from science.ai.config import DEFAULT_MODEL, ENV_KEY, ENV_MODEL, model_name, status
from science.ai.gemini import ROUTE_ANALYSIS_SCHEMA, analyse_routes, chat
from science.ai.tools import DECLARATIONS, TOOLS, call_tool

STATE = {
    "selection": {"latitude_deg": -4.5895, "longitude_deg": 137.4417, "label": "Curiosity landing", "mode": "coordinate"},
    "environment": {"thermal": {"observations": [{"brightness_temperature_k": 212.4, "product_id": "i12345pbt"}]},
                    "dust": {"opacity": 0.32}, "terrain": {"elevation_m": -4503}},
    "route_candidates": {"candidates": [{"id": "cand-balanced", "name": "Balanced",
                                          "metrics": {"distance_km": 9.2, "estimated_eva_hours": 4.2, "terrain_risk_proxy": 33.0}}],
                          "selected_id": "cand-balanced"},
    "mission_console": {"mission": {"id": "NN-MARS-01"}},
}


def test_every_declaration_has_an_implementation():
    assert {d["name"] for d in DECLARATIONS} == set(TOOLS)
    for declaration in DECLARATIONS:
        assert declaration["description"] and declaration["parameters"]["type"] == "object"


def test_tools_read_project_state_not_guesses():
    assert call_tool("get_selected_location", {}, STATE)["latitude_deg"] == -4.5895
    assert call_tool("get_environment", {}, STATE)["thermal_nearest"]["brightness_temperature_k"] == 212.4
    candidates = call_tool("get_route_candidates", {}, STATE)
    assert candidates["count"] == 1 and candidates["candidates"][0]["metrics"]["distance_km"] == 9.2


def test_missing_data_returns_unavailable_not_invented_values():
    for name in ("get_route_plan", "get_saved_routes", "get_safe_havens", "get_custom_places"):
        assert call_tool(name, {}, {})["status"] == "UNAVAILABLE"
    assert call_tool("get_rover_photos", {}, {})["status"] == "NO PHOTOS AVAILABLE"
    assert call_tool("get_selected_feature", {}, STATE)["status"] == "NO NAMED FEATURE SELECTED"


def test_unknown_and_failing_tools_do_not_raise():
    assert "error" in call_tool("nonexistent_tool", {}, STATE)
    assert call_tool("get_USGS_features", {}, {})["status"] == "UNAVAILABLE"


def test_tool_results_are_size_bounded():
    state = {"saved_routes": [{"id": f"r{i}", "name": "x" * 400, "metrics": {"distance_km": i}} for i in range(400)]}
    assert len(json.dumps(call_tool("get_saved_routes", {}, state))) < 20000


def test_model_is_configurable_with_a_gemini_default(monkeypatch):
    monkeypatch.delenv(ENV_MODEL, raising=False)
    assert model_name() == DEFAULT_MODEL == "gemini-3.5-flash"
    monkeypatch.setenv(ENV_MODEL, "gemini-2.5-pro")
    assert model_name() == "gemini-2.5-pro"


def test_key_is_server_side_only(monkeypatch):
    monkeypatch.setenv(ENV_KEY, "test-key")
    payload = status()
    assert payload["configured"] is True and payload["key_exposed_to_browser"] is False
    assert "test-key" not in json.dumps(payload)


def test_gemini_absent_degrades_gracefully(monkeypatch):
    monkeypatch.delenv(ENV_KEY, raising=False)
    monkeypatch.setattr("science.ai.config._load_dotenv_once", lambda: None)
    reply = chat([{"role": "user", "content": "Explain the trade-offs."}], STATE)
    assert reply["status"] == "unavailable" and "GEMINI_API_KEY" in reply["reason"]
    analysis = analyse_routes({"candidates": []})
    assert analysis["status"] == "unavailable"


def test_gemini_api_failure_is_reported_not_faked(monkeypatch):
    monkeypatch.setenv(ENV_KEY, "test-key")

    class Boom:
        class models:
            @staticmethod
            def generate_content(**_):
                raise RuntimeError("404 model not found")

    monkeypatch.setattr("science.ai.gemini._client", lambda: Boom())
    reply = chat([{"role": "user", "content": "hello"}], STATE)
    assert reply["status"] == "unavailable" and "GEMINI_MODEL" in reply["reason"]


def test_route_analysis_schema_matches_the_required_contract():
    assert set(ROUTE_ANALYSIS_SCHEMA["required"]) == {
        "summary", "selected_candidate", "tradeoffs", "evidence", "uncertainties",
        "recommendation_basis", "confidence", "sources"}
    evidence_enum = ROUTE_ANALYSIS_SCHEMA["properties"]["evidence"]["items"]["properties"]["evidence_class"]["enum"]
    assert {"NASA OBSERVED", "MODELED", "DERIVED", "COMPUTED", "SIMULATED", "UNAVAILABLE"} <= set(evidence_enum)


def test_provenance_ledger_separates_ai_from_nasa_observation():
    from science.provenance import source_ledger

    ledger = source_ledger()
    classes = {entry["class"] for entry in ledger["entries"]}
    assert {"EXTERNAL SOURCE", "DERIVED OUTPUT", "TEAM METHOD", "AI INTERPRETATION"} <= classes
    gemini = next(entry for entry in ledger["entries"] if entry["id"] == "gemini")
    assert gemini["class"] == "AI INTERPRETATION"



class _FakeModel:
    def __init__(self, name, actions=("generateContent",)):
        self.name = f"models/{name}"
        self.supported_actions = list(actions)


class _FakeClient:
    def __init__(self, names):
        self._names = names

        class _Models:
            @staticmethod
            def list():
                return [_FakeModel(n) for n in names] + [_FakeModel("text-embedding-004", ("embedContent",)),
                                                         _FakeModel("gemini-3.1-flash-image")]

        self.models = _Models()


def _resolve(monkeypatch, names, configured=None):
    import science.ai.config as config

    monkeypatch.setenv(ENV_KEY, f"key-{len(names)}-{configured}")
    if configured:
        monkeypatch.setenv(ENV_MODEL, configured)
    else:
        monkeypatch.delenv(ENV_MODEL, raising=False)
    config._cache.update(at=0.0, models=None)
    return config.resolve_model(_FakeClient(names))


def test_configured_model_is_used_when_available(monkeypatch):
    info = _resolve(monkeypatch, ["gemini-3.5-flash", "gemini-3.6-flash"], configured="gemini-3.5-flash")
    assert info["model"] == "gemini-3.5-flash" and info["notice"] is None and not info["substituted"]


def test_retired_model_is_replaced_with_an_available_one_and_explained(monkeypatch):
    info = _resolve(monkeypatch, ["gemini-3.6-flash", "gemini-3.1-flash-lite"], configured="gemini-2.5-flash")
    assert info["model"] == "gemini-3.6-flash" and info["substituted"]
    assert "gemini-2.5-flash" in info["notice"] and "unavailable" in info["notice"]
    assert "GEMINI_MODEL" in info["notice"]


def test_non_text_models_are_never_chosen(monkeypatch):
    info = _resolve(monkeypatch, [], configured=None)
    assert info["model"] is None and "no Gemini text-generation model" in info["notice"]


def test_unknown_future_flash_model_is_picked_by_version(monkeypatch):
    info = _resolve(monkeypatch, ["gemini-4.2-flash", "gemini-4.0-pro"], configured="gemini-9-flash")
    assert info["model"] == "gemini-4.2-flash"
