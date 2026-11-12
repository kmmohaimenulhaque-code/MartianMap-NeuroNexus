"""AI router: intent rules, Qwen guard, and every fallback edge (no network)."""

import pytest

from science.ai import context, intent, qwen, router

STATE = {
    "selection": {"latitude_deg": -4.5895, "longitude_deg": 137.4417, "label": "Curiosity landing", "mode": "coordinate"},
    "environment": {"thermal": {"observations": [{"brightness_temperature_k": 212.4, "product_id": "i12345pbt"}]},
                    "dust": {"opacity": 0.32}, "terrain": {"elevation_m": -4503, "slope_deg": 1.8}},
}
GEMINI_OK = {"status": "ok", "model": "gemini-test", "text": "Gemini answer.", "tool_calls": [{"name": "get_environment"}]}


@pytest.fixture
def qwen_up(monkeypatch):
    monkeypatch.setenv("QWEN_BASE_URL", "http://qwen.test")
    monkeypatch.setattr(qwen, "healthy", lambda force=False: (True, None))


def use_gemini(monkeypatch, result=GEMINI_OK):
    calls = []
    monkeypatch.setattr(router.gemini, "chat", lambda m, s, enable_search=False: calls.append(m) or dict(result))
    return calls


def use_qwen(monkeypatch, text):
    monkeypatch.setattr(qwen, "complete", lambda m, ctx: {"text": text(ctx) if callable(text) else text, "elapsed_ms": 1.0})


@pytest.mark.parametrize("question, route", [
    ("How steep is the terrain here?", "qwen"),
    ("What is the dose for a 4 hour EVA?", "qwen"),
    ("How do I use the command index?", "qwen"),
    ("Tell me about Olympus Mons.", "qwen"),
    ("Compare the saved routes and rank them.", "gemini"),
    ("What is the latest news from Perseverance?", "gemini"),
    ("Dose, dust and slope for this route?", "gemini"),
    ("Is it safe to walk here?", "qwen"),
])
def test_intent_rules(question, route):
    assert intent.classify(question).route == route


def test_safety_question_gets_terrain_and_dose_context():
    plan = intent.classify("Is it safe to walk here?")
    assert plan.families == ["site", "terrain", "dose"] and ("dose_screening", {}) in plan.tools


def test_search_flag_forces_gemini():
    assert intent.classify("Explain the slope.", enable_search=True).route == "gemini"


def test_context_carries_values_and_ledger_tags():
    text, log = context.build(STATE, intent.FAMILIES["terrain"] + intent.FAMILIES["environment"])
    assert "-4503 [MOLA_MEGDR]" in text and "212.4 [THEMIS]" in text and "0.32 [NASA_AMES_MGCM]" in text
    assert [entry["name"] for entry in log] == ["get_terrain_analysis", "get_environment"]


def test_explain_question_answered_by_qwen(monkeypatch, qwen_up):
    use_qwen(monkeypatch, "Elevation -4503 m, slope 1.8 deg [MOLA_MEGDR]. REVIEW REQUIRED until 1 m terrain is loaded.")
    calls = use_gemini(monkeypatch)
    out = router.chat([{"role": "user", "content": "How steep is the terrain here?"}], STATE)
    assert out["provider"] == "qwen" and out["status"] == "ok" and out["fallback_from"] is None
    assert out["tool_calls"][0]["name"] == "get_terrain_analysis" and not calls


def test_guard_failure_reroutes_to_gemini(monkeypatch, qwen_up):
    use_qwen(monkeypatch, "Slope is 7.5 deg, totally safe.")
    use_gemini(monkeypatch)
    out = router.chat([{"role": "user", "content": "How steep is the terrain here?"}], STATE)
    assert out["provider"] == "gemini" and out["fallback_from"].startswith("qwen: guard:")
    assert out["guard"]["ok"] is False


def test_qwen_down_falls_back_to_gemini(monkeypatch):
    monkeypatch.setenv("QWEN_BASE_URL", "http://qwen.test")
    monkeypatch.setattr(qwen, "healthy", lambda force=False: (False, "unreachable"))
    use_gemini(monkeypatch)
    out = router.chat([{"role": "user", "content": "Explain the slope."}], STATE)
    assert out["provider"] == "gemini" and "unreachable" in out["fallback_from"]


def test_multi_step_goes_to_gemini_then_qwen_when_gemini_fails(monkeypatch, qwen_up):
    calls = use_gemini(monkeypatch)
    out = router.chat([{"role": "user", "content": "Compare the terrain and rank the sites."}], STATE)
    assert out["provider"] == "gemini" and out["route"] == "gemini" and len(calls) == 1
    use_gemini(monkeypatch, {"status": "unavailable", "reason": "The Gemini API quota or rate limit was reached."})
    use_qwen(monkeypatch, "Elevation -4503 m [MOLA_MEGDR].")
    out = router.chat([{"role": "user", "content": "Compare the terrain and rank the sites."}], STATE)
    assert out["provider"] == "qwen" and out["fallback_from"].startswith("gemini: The Gemini API quota")


def test_both_down_is_unavailable_not_invented(monkeypatch):
    monkeypatch.setenv("QWEN_BASE_URL", "http://qwen.test")
    monkeypatch.setattr(qwen, "healthy", lambda force=False: (False, "unreachable"))
    use_gemini(monkeypatch, {"status": "unavailable", "reason": "GEMINI_API_KEY is not configured on the server."})
    out = router.chat([{"role": "user", "content": "Explain the slope."}], STATE)
    assert out["status"] == "unavailable" and out["provider"] == "none" and "text" not in out


def test_without_qwen_configured_it_is_plain_gemini(monkeypatch):
    monkeypatch.delenv("QWEN_BASE_URL", raising=False)
    use_gemini(monkeypatch)
    out = router.chat([{"role": "user", "content": "Explain the slope."}], STATE)
    assert out["provider"] == "gemini" and out["fallback_from"] is None


def test_status_reports_both_providers_and_recent_decisions(monkeypatch):
    monkeypatch.delenv("QWEN_BASE_URL", raising=False)
    monkeypatch.setattr(router.gemini, "service_status", lambda: {"configured": False})
    payload = router.service_status()["router"]
    assert payload["providers"]["qwen"]["configured"] is False and "recent_decisions" in payload
