from __future__ import annotations

from unittest.mock import patch

import httpx

from science.ai import router


def test_fallback_stops_on_first_success(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "groq-token")
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-token")
    calls: list[str] = []

    def request(provider, messages, *, json_mode):
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
    assert calls == ["Groq", "Mistral"]
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
        "Groq",
        "Mistral",
        "NVIDIA NIM",
        "GitHub Models",
        "Cohere",
    ]
    assert router.REQUEST_TIMEOUT_SECONDS <= 2.5
    assert router.FAILOVER_CODES == {401, 403, 429, 500, 502, 503, 504}
