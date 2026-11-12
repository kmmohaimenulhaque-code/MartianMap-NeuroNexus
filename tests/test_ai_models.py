"""Mars Intelligence: dynamic model discovery, auto-fallback, thinking negotiation, web search, persona."""

from __future__ import annotations

import pytest

import science.ai.config as config
from science.ai import gemini, intent, web_search
from science.ai.config import ENV_KEY, ENV_MODEL, ENV_PREFERENCE
from science.ai.tools import DECLARATIONS, TOOLS

STATE = {"selection": {"latitude_deg": -4.59, "longitude_deg": 137.44}}
ASK = [{"role": "user", "content": "hello"}]


class ApiError(Exception):
    def __init__(self, code: int, text: str):
        self.code = code
        super().__init__(f"{code} {text}")


class _Part:
    def __init__(self, text=None, thought=False, call=None):
        self.text, self.thought, self.function_call = text, thought, call


class _Call:
    def __init__(self, name, args):
        self.name, self.args = name, args


class _Response:
    def __init__(self, parts, chunks=None):
        class _Candidate:
            pass

        cand = _Candidate()
        cand.content = type("C", (), {"parts": parts})()
        cand.grounding_metadata = (type("G", (), {"grounding_chunks": [
            type("K", (), {"web": type("W", (), {"title": t, "uri": u})()})() for t, u in chunks]})() if chunks else None)
        self.candidates = [cand]
        self.text = "".join(p.text or "" for p in parts if not p.thought and p.function_call is None)


class FakeClient:
    """Lists `names`; generate_content delegates to script(model, config) and records every call."""

    def __init__(self, names, script=None):
        self.names, self.calls, self.configs = names, [], []
        script = script or (lambda model, cfg: _Response([_Part("ok")]))
        outer = self

        class _Models:
            list_calls = 0

            @staticmethod
            def list():
                outer.models.list_calls += 1
                return [type("M", (), {"name": f"models/{n}", "supported_actions": ["generateContent"]})() for n in outer.names] + [
                    type("M", (), {"name": "models/text-embedding-004", "supported_actions": ["embedContent"]})(),
                    type("M", (), {"name": "models/gemini-3.1-flash-preview-tts", "supported_actions": ["generateContent"]})(),
                    type("M", (), {"name": "models/gemini-3.1-flash-image", "supported_actions": ["generateContent"]})()]

            @staticmethod
            def generate_content(model, contents, config):
                outer.calls.append(model)
                outer.configs.append(config)
                return script(model, config)

        self.models = _Models()


def tool_names(cfg):
    names, native = [], False
    for t in cfg.tools or []:
        native = native or t.google_search is not None
        names += [d.name for d in (t.function_declarations or [])]
    return names, native


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.setenv(ENV_KEY, "k-models")
    monkeypatch.delenv(ENV_MODEL, raising=False)
    monkeypatch.delenv(ENV_PREFERENCE, raising=False)
    config._cache.update(at=0.0, models=None, key_fingerprint=None)
    config._health.update(working=None, working_at=0.0, cooldown={})


def use(monkeypatch, client):
    monkeypatch.setattr(gemini, "_client", lambda: client)
    return client


# --------------------------------------------------------------- discovery and ranking

def test_discovery_keeps_only_generate_content_text_models_and_caches_for_an_hour(monkeypatch):
    client = FakeClient(["gemini-3.6-flash", "gemini-3.1-flash-lite"])
    assert config.list_available_models(client) == ["gemini-3.6-flash", "gemini-3.1-flash-lite"]
    config.list_available_models(client)
    assert client.models.list_calls == 1  # second call served from the cache
    now = config.time.time()
    monkeypatch.setattr(config.time, "time", lambda: now + 3599)
    config.list_available_models(client)
    assert client.models.list_calls == 1
    monkeypatch.setattr(config.time, "time", lambda: now + 3601)
    config.list_available_models(client)
    assert client.models.list_calls == 2  # TTL is one hour


def test_models_are_ranked_flash_then_pro_then_lite_without_a_hardcoded_default():
    names = ["gemini-3.1-flash-lite", "gemini-4.0-pro", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-4.1-flash-lite"]
    order = config.model_attempt_order(names, config.configured_model())
    # The old default (3.6) is not locked in: the newest discovered Flash leads.
    assert order == ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-4.0-pro", "gemini-4.1-flash-lite", "gemini-3.1-flash-lite"][:5]


def test_preference_env_list_goes_first(monkeypatch):
    monkeypatch.setenv(ENV_PREFERENCE, "gemini-3.1-flash-lite, models/gemini-3.6-flash, not-listed")
    order = config.model_attempt_order(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"], config.configured_model())
    assert order[:3] == ["gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"]


# --------------------------------------------------------------- auto-fallback

@pytest.mark.parametrize("code,text,short", [(429, "RESOURCE_EXHAUSTED quota", "429"), (403, "PERMISSION_DENIED tier", "403"),
                                              (404, "NOT_FOUND retired", "404"), (503, "UNAVAILABLE high demand", "503")])
def test_failed_model_falls_back_and_reports_the_chain(monkeypatch, code, text, short):
    def script(model, cfg):
        if model == "gemini-3.8-flash":
            raise ApiError(code, text)
        return _Response([_Part("hi")])

    client = use(monkeypatch, FakeClient(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"], script))
    reply = gemini.chat(ASK, STATE)
    assert reply["status"] == "ok" and reply["model_used"] == reply["model"] == "gemini-3.6-flash"
    assert [f["model"] for f in reply["fallback_chain_tried"]] == ["gemini-3.8-flash"]
    assert short in reply["fallback_chain_tried"][0]["reason"]
    assert client.calls == ["gemini-3.8-flash", "gemini-3.6-flash"]


def test_cooldown_is_sixty_seconds_then_the_best_model_returns(monkeypatch):
    state = {"fail": True}

    def script(model, cfg):
        if model == "gemini-3.8-flash" and state["fail"]:
            raise ApiError(429, "RESOURCE_EXHAUSTED")
        return _Response([_Part("hi")])

    client = use(monkeypatch, FakeClient(["gemini-3.8-flash", "gemini-3.6-flash"], script))
    gemini.chat(ASK, STATE)
    client.calls.clear()
    assert gemini.chat(ASK, STATE)["model_used"] == "gemini-3.6-flash" and client.calls == ["gemini-3.6-flash"]  # skipped
    state["fail"] = False
    now = config.time.time()
    monkeypatch.setattr(config.time, "time", lambda: now + 61)
    client.calls.clear()
    assert gemini.chat(ASK, STATE)["model_used"] == "gemini-3.8-flash"  # cooldown over


def test_no_fallback_noise_when_the_first_model_answers(monkeypatch):
    use(monkeypatch, FakeClient(["gemini-3.8-flash", "gemini-3.6-flash"]))
    reply = gemini.chat(ASK, STATE)
    assert reply["fallback_chain_tried"] == [] and reply["model_notice"] is None


# --------------------------------------------------------------- thinking mode

def test_thinking_config_is_sent_and_thoughts_are_extracted(monkeypatch):
    script = lambda model, cfg: _Response([_Part("Weighing dust against slope.", thought=True), _Part("Answer.")])
    client = use(monkeypatch, FakeClient(["gemini-3.6-flash"], script))
    reply = gemini.chat(ASK, STATE, thinking_mode=True)
    assert client.configs[0].thinking_config.include_thoughts is True
    assert reply["thoughts"] == "Weighing dust against slope." and reply["text"] == "Answer." and reply["thinking_applied"] is True


def test_thinking_is_off_by_default(monkeypatch):
    client = use(monkeypatch, FakeClient(["gemini-3.6-flash"]))
    reply = gemini.chat(ASK, STATE)
    assert client.configs[0].thinking_config is None and reply["thoughts"] == "" and reply["thinking_applied"] is False


def test_model_rejecting_thinking_is_retried_without_it_on_the_same_model(monkeypatch):
    def script(model, cfg):
        if cfg.thinking_config is not None:
            raise ApiError(400, "INVALID_ARGUMENT: thinking_config is not supported by this model")
        return _Response([_Part("plain answer")])

    client = use(monkeypatch, FakeClient(["gemini-3.6-flash", "gemini-3.1-flash-lite"], script))
    reply = gemini.chat(ASK, STATE, thinking_mode=True)
    assert reply["status"] == "ok" and reply["model_used"] == "gemini-3.6-flash" and client.calls == ["gemini-3.6-flash"] * 2
    assert reply["thinking_applied"] is False and reply["thoughts"] == "" and "Thinking mode is not supported" in reply["model_notice"]
    assert reply["fallback_chain_tried"] == []


def test_thinking_is_negotiated_per_model(monkeypatch):
    def script(model, cfg):
        if model == "gemini-3.8-flash" and cfg.thinking_config is not None:
            raise ApiError(400, "INVALID_ARGUMENT thinking")
        if model == "gemini-3.8-flash":
            raise ApiError(429, "RESOURCE_EXHAUSTED")
        return _Response([_Part("deep", thought=True), _Part("ok")])

    use(monkeypatch, FakeClient(["gemini-3.8-flash", "gemini-3.6-flash"], script))
    reply = gemini.chat(ASK, STATE, thinking_mode=True)
    assert reply["model_used"] == "gemini-3.6-flash" and reply["thinking_applied"] is True and reply["thoughts"] == "deep"


# --------------------------------------------------------------- web search

GENERAL = [{"role": "user", "content": "Who runs the Hope orbiter mission?"}]
CONSOLE = [{"role": "user", "content": "What is the slope along my route right now?"}]


def test_native_google_search_is_path_a_for_general_questions(monkeypatch):
    script = lambda model, cfg: _Response([_Part("The UAE's MBRSC.")], chunks=[("MBRSC", "https://www.mbrsc.ae/"), ("MBRSC", "https://www.mbrsc.ae/")])
    client = use(monkeypatch, FakeClient(["gemini-3.6-flash"], script))
    reply = gemini.chat(GENERAL, STATE, enable_search=True)
    names, native = tool_names(client.configs[0])
    assert native and names == [] and reply["web_search_mode"] == "native"
    assert reply["web_sources"] == [{"title": "MBRSC", "uri": "https://www.mbrsc.ae/"}] == reply["search_grounding"]


@pytest.mark.parametrize("code,text", [(400, "INVALID_ARGUMENT: Search grounding is not supported"), (403, "PERMISSION_DENIED search"),
                                       (429, "RESOURCE_EXHAUSTED grounding quota")])
def test_blocked_native_search_falls_back_to_the_search_web_tool(monkeypatch, code, text):
    monkeypatch.setattr(web_search, "PROVIDERS", (("fake", lambda q: [{"title": "Hope probe", "url": "https://en.wikipedia.org/wiki/Hope_(spacecraft)",
                                                                        "snippet": "UAE orbiter", "source": "Wikipedia"}]),))
    step = {"n": 0}

    def script(model, cfg):
        names, native = tool_names(cfg)
        if native:
            raise ApiError(code, text)
        assert "search_web" in names and "get_selected_location" in names  # console tools and web search together
        step["n"] += 1
        if step["n"] == 1:
            return _Response([_Part(call=_Call("search_web", {"query": "Hope orbiter"}))])
        return _Response([_Part("It is run by MBRSC.")])

    client = use(monkeypatch, FakeClient(["gemini-3.6-flash"], script))
    reply = gemini.chat(GENERAL, STATE, enable_search=True)
    assert reply["status"] == "ok" and reply["web_search_mode"] == "tool" and client.calls == ["gemini-3.6-flash"] * 3
    assert reply["web_sources"] == [{"title": "Hope probe", "uri": "https://en.wikipedia.org/wiki/Hope_(spacecraft)"}]
    assert "search_web tool" in reply["model_notice"] and reply["fallback_chain_tried"] == []


def test_console_questions_use_console_tools_plus_search_web_without_native_grounding(monkeypatch):
    assert intent.needs_console_tools(CONSOLE[0]["content"]) and not intent.needs_console_tools(GENERAL[0]["content"])
    client = use(monkeypatch, FakeClient(["gemini-3.6-flash"]))
    reply = gemini.chat(CONSOLE, STATE, enable_search=True)
    names, native = tool_names(client.configs[0])
    assert not native and "search_web" in names and "get_selected_location" in names and reply["web_search_mode"] == "tool"


def test_search_web_is_not_offered_when_web_search_is_off(monkeypatch):
    client = use(monkeypatch, FakeClient(["gemini-3.6-flash"]))
    gemini.chat(CONSOLE, STATE)
    names, native = tool_names(client.configs[0])
    assert "search_web" not in names and not native


def test_search_web_tool_is_registered_and_stays_inside_the_host_allowlist(monkeypatch):
    assert "search_web" in TOOLS and "search_web" in {d["name"] for d in DECLARATIONS}
    hosts = []

    class Resp:
        status_code = 200
        text = ""

        def raise_for_status(self):
            pass

        def json(self):
            return {"pages": [{"key": "Mars", "title": "Mars", "excerpt": "Fourth <b>planet</b>"}], "collection": {"items": []}}

    monkeypatch.setattr(web_search.requests, "get", lambda url, **kw: hosts.append(url.split("/")[2]) or Resp())
    result = TOOLS["search_web"]({}, query="Mars")
    assert result["status"] == "ok" and result["results"][0]["snippet"] == "Fourth planet" and result["evidence_class"] == "WEB"
    assert set(hosts) <= {"en.wikipedia.org", "images-api.nasa.gov", "html.duckduckgo.com"}
    with pytest.raises(ValueError):
        web_search._get("https://example.com/")
    with pytest.raises(ValueError):
        web_search._get("http://en.wikipedia.org/")


def test_search_web_degrades_to_no_results_and_respects_demo_pack_mode(monkeypatch):
    monkeypatch.setattr(web_search.requests, "get", lambda *a, **k: (_ for _ in ()).throw(OSError("offline")))
    assert TOOLS["search_web"]({}, query="Mars")["status"] == "NO RESULTS"
    monkeypatch.setenv("DEMO_PACK", "1")
    assert TOOLS["search_web"]({}, query="Mars")["status"] == "UNAVAILABLE"


# --------------------------------------------------------------- persona and guardrails

def test_persona_is_conversational_and_keeps_every_guardrail():
    text = gemini.SYSTEM_INSTRUCTION
    assert "Mission Scientist and Polymath Co-Pilot" in text and "mission-console brief" not in text
    for status in ("WITHIN PLANNING LIMITS", "REVIEW REQUIRED", "EXCEEDS PLANNING LIMIT"):
        assert status in text
    assert "never call a route, site or Safe Haven safe" in text.lower().replace("\n  ", " ") or "Never call a route, site or Safe Haven safe" in text.replace("\n  ", " ")
    assert "Never invent coordinates" in text and "never recompute" in text.lower()
    for scope in ("NASA", "ESA", "ISRO", "JAXA", "MBRSC/UAE", "SpaceX", "Space Apps 2026"):
        assert scope in text
    assert "—" not in text and "–" not in text  # no em or en dashes


def test_chat_temperature_is_no_longer_flat(monkeypatch):
    client = use(monkeypatch, FakeClient(["gemini-3.6-flash"]))
    gemini.chat(ASK, STATE)
    assert client.configs[0].temperature == gemini.CHAT_TEMPERATURE >= 0.5


# --------------------------------------------------------------- API surface

def test_api_accepts_thinking_mode_and_passes_it_down(monkeypatch):
    from fastapi.testclient import TestClient

    from science.serve import app

    seen = {}
    monkeypatch.setattr("science.ai.api.chat", lambda messages, state, **kw: seen.update(kw) or {"status": "ok", "text": "x"})
    reply = TestClient(app).post("/api/ai/chat", json={"messages": ASK, "enable_search": True, "thinking_mode": True})
    assert reply.status_code == 200 and seen == {"enable_search": True, "thinking_mode": True}
