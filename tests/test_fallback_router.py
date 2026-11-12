from __future__ import annotations

from unittest.mock import patch

import httpx

from science.ai import router


def test_fallback_stops_on_first_success(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "groq-token")
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-token")
    calls: list[str] = []

    def request(provider, messages, *, json_mode, model=None, read_timeout=None):
        calls.append(provider.name)
        if provider.name == "Groq":
            raise httpx.HTTPStatusError(
                "rate limited",
                request=httpx.Request("POST", provider.endpoint),
                response=httpx.Response(429),
            )
        return router.ProviderResponse(provider.name, provider.models[0], "answer", 1.0)

    with patch.object(router, "_request", side_effect=request):
        response, failures = router.fallback([{"role": "user", "content": "hello"}])

    assert response is not None
    assert response.provider == "Mistral"
    assert calls == ["Groq", "Groq", "Mistral"]  # each Groq model once (limits are per model), then Mistral
    assert failures[0]["provider"] == "Groq"


def test_fallback_skips_unconfigured_providers(monkeypatch):
    for provider in router.PROVIDERS:
        monkeypatch.delenv(provider.key_env, raising=False)
    with patch.object(router, "_request") as request:
        response, failures = router.fallback([{"role": "user", "content": "hello"}])
    assert response is None
    assert failures == []
    request.assert_not_called()


def test_approved_provider_order_and_fast_timeout():
    assert [provider.name for provider in router.PROVIDERS] == [
        "Groq", "Mistral", "NVIDIA NIM", "GitHub Models", "Cohere", "OpenRouter"]
    assert router.CONNECT_TIMEOUT_SECONDS <= 2.5
    assert {401, 403, 404, 410, 429, 500, 502, 503, 504} <= router.FAILOVER_CODES


def test_no_chinese_or_russian_models():
    deny = ("qwen", "alibaba", "deepseek", "baidu", "ernie", "tencent", "hunyuan", "bytedance", "doubao", "moonshot",
            "kimi", "zhipu", "glm", "minimax", "internlm", "yi-", "01-ai", "xingchen", "dots", "yandex", "gigachat", "sber")
    names = [m.lower() for p in router.PROVIDERS for m in (p.name, p.endpoint, *p.models)]
    assert not [n for n in names if any(d in n for d in deny)]


def _status_error(provider, code):
    return httpx.HTTPStatusError("x", request=httpx.Request("POST", provider.endpoint), response=httpx.Response(code))


def test_dead_model_moves_to_the_next_model_of_the_same_provider(monkeypatch):
    for provider in router.PROVIDERS:
        monkeypatch.delenv(provider.key_env, raising=False)
    monkeypatch.setenv("NVIDIA_API_KEY", "nv")
    monkeypatch.delenv("NVIDIA_NIM_MODEL", raising=False)
    tried = []

    def request(provider, messages, *, json_mode, model=None, read_timeout=None):
        tried.append(model)
        if model == provider.models[0]:
            raise _status_error(provider, 410)
        return router.ProviderResponse(provider.name, model, "answer", 1.0)

    with patch.object(router, "_request", side_effect=request):
        response, failures = router.fallback([{"role": "user", "content": "hello"}])
    assert response.model == router.PROVIDERS[2].models[1] and tried == list(router.PROVIDERS[2].models)


def test_refused_key_skips_the_rest_of_that_provider(monkeypatch):
    for provider in router.PROVIDERS:
        monkeypatch.delenv(provider.key_env, raising=False)
    monkeypatch.setenv("NVIDIA_API_KEY", "nv")
    monkeypatch.setenv("OPENROUTER_API_KEY", "or")
    tried = []

    def request(provider, messages, *, json_mode, model=None, read_timeout=None):
        tried.append(provider.name)
        if provider.name == "NVIDIA NIM":
            raise _status_error(provider, 401)
        return router.ProviderResponse(provider.name, model, "answer", 1.0)

    with patch.object(router, "_request", side_effect=request):
        response, _ = router.fallback([{"role": "user", "content": "hello"}])
    assert response.provider == "OpenRouter" and tried == ["NVIDIA NIM", "OpenRouter"]


def test_answer_calling_something_safe_is_rejected(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nv")
    provider = router.PROVIDERS[2]

    class Reply:
        status_code = 200
        request = None
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "The route is safe to walk."}}]}

    with patch.object(httpx.Client, "post", return_value=Reply()):
        try:
            router._request(provider, [{"role": "user", "content": "hi"}])
            raised = False
        except router.ProviderUnavailable:
            raised = True
    assert raised


def test_gemini_failure_is_labeled_on_the_fallback_answer(monkeypatch):
    monkeypatch.setattr(router.gemini, "chat", lambda *a, **k: {"status": "unavailable", "reason": "429 quota"})
    monkeypatch.setattr(router, "fallback", lambda messages, json_mode=False: (
        router.ProviderResponse("NVIDIA NIM", "nvidia/nemotron-3-ultra-550b-a55b", "Gale is a crater.", 5.0), []))
    out = router.chat([{"role": "user", "content": "What is Gale?"}], {})
    assert out["provider"] == "NVIDIA NIM" and out["fallback_from"] == "gemini: 429 quota"


def test_fallback_prompt_carries_knowledge_base_excerpts(monkeypatch):
    seen = {}
    monkeypatch.setattr(router.gemini, "chat", lambda *a, **k: {"status": "unavailable", "reason": "401"})

    def fake_fallback(messages, json_mode=False):
        seen["prompt"] = messages[-1]["content"]
        return router.ProviderResponse("NVIDIA NIM", "m", "Gale crater is a 154 km crater.", 1.0), []

    monkeypatch.setattr(router, "fallback", fake_fallback)
    router.chat([{"role": "user", "content": "What is Gale crater?"}], {})
    assert "Knowledge-base excerpts" in seen["prompt"] and "Gale" in seen["prompt"]


def test_chain_stops_at_the_time_budget(monkeypatch):
    for provider in router.PROVIDERS:
        monkeypatch.setenv(provider.key_env, "k")
    monkeypatch.setattr(router, "BUDGET_SECONDS", 0.5)
    with patch.object(router, "_request", side_effect=httpx.ReadTimeout("slow")) as request:
        response, failures = router.fallback([{"role": "user", "content": "hi"}])
    assert response is None and request.call_count == 0 and "budget" in failures[-1]["reason"]


def test_safe_haven_feature_name_is_not_a_safety_verdict():
    assert "banned_safety_term" not in router.guard.check("Mark a Safe Haven on the route; Safe Havens are retreat points.", "")["violations"]
    assert "banned_safety_term" in router.guard.check("The route is safe.", "")["violations"]
