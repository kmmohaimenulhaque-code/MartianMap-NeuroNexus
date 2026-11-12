"""Fast, single-pass fallback routing for AI text generation."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from science.ai import gemini

FAILOVER_CODES = frozenset({401, 403, 429, 500, 502, 503, 504})
REQUEST_TIMEOUT_SECONDS = 2.5


@dataclass(frozen=True)
class Provider:
    name: str
    key_env: str
    endpoint: str
    models: tuple[str, ...]
    kind: str = "openai"


@dataclass(frozen=True)
class ProviderResponse:
    provider: str
    model: str
    text: str
    elapsed_ms: float


PROVIDERS = (
    Provider("Groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1/chat/completions",
             ("llama-3.3-70b-versatile", "openai/gpt-oss-120b")),
    Provider("Mistral", "MISTRAL_API_KEY", "https://api.mistral.ai/v1/chat/completions",
             ("mistral-large-latest", "mistral-small-latest")),
    Provider("NVIDIA NIM", "NVIDIA_API_KEY", "https://integrate.api.nvidia.com/v1/chat/completions",
             ("nvidia/nemotron-3.5", "meta/llama-3.1-70b-instruct")),
    Provider("GitHub Models", "GITHUB_TOKEN", "https://models.inference.ai.azure.com/chat/completions",
             ("gpt-4o", "Phi-4")),
    Provider("Cohere", "COHERE_API_KEY", "https://api.cohere.com/v2/chat",
             ("command-r-plus",), kind="cohere"),
)


class ProviderUnavailable(RuntimeError):
    """Raised when a configured provider cannot return usable content."""


def _configured(provider: Provider) -> bool:
    return bool((os.environ.get(provider.key_env) or "").strip())


def _model(provider: Provider) -> str:
    key = f"{provider.name.upper().replace(' ', '_').replace('-', '_')}_MODEL"
    return (os.environ.get(key) or "").strip() or provider.models[0]


def _request(provider: Provider, messages: list[dict[str, str]], *, json_mode: bool = False) -> ProviderResponse:
    model = _model(provider)
    if provider.kind == "cohere":
        payload: dict[str, Any] = {"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 2048}
    else:
        payload = {"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 2048}
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
    started = time.perf_counter()
    headers = {"Authorization": f"Bearer {os.environ[provider.key_env].strip()}",
               "Content-Type": "application/json"}
    with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = client.post(provider.endpoint, headers=headers, json=payload)
        if response.status_code in FAILOVER_CODES:
            raise httpx.HTTPStatusError(
                f"{provider.name} returned HTTP {response.status_code}",
                request=response.request,
                response=response,
            )
        response.raise_for_status()
        body = response.json()
    if provider.kind == "cohere":
        content = (body.get("message") or {}).get("content") or []
        text = "".join(str(item.get("text", "")) for item in content if isinstance(item, dict)).strip()
    else:
        choices = body.get("choices") or []
        message = (choices[0] or {}).get("message") if choices else {}
        text = str((message or {}).get("content") or "").strip()
    if not text:
        raise ProviderUnavailable(f"{provider.name} returned an empty response")
    return ProviderResponse(provider.name, model, text, (time.perf_counter() - started) * 1000)


def fallback(messages: list[dict[str, str]], *, json_mode: bool = False) -> tuple[ProviderResponse | None, list[dict[str, str]]]:
    """Try configured providers once each, without sleeping or retrying."""
    failures: list[dict[str, str]] = []
    for provider in PROVIDERS:
        if not _configured(provider):
            continue
        try:
            return _request(provider, messages, json_mode=json_mode), failures
        except (httpx.HTTPError, TimeoutError, ValueError, ProviderUnavailable) as exc:
            code = getattr(getattr(exc, "response", None), "status_code", None)
            failures.append({"provider": provider.name, "reason": f"{code or type(exc).__name__}: {str(exc)[:160]}"})
    return None, failures


def _fallback_chat(messages: list[dict[str, str]], state: dict[str, Any], failures: list[dict[str, Any]]) -> dict[str, Any] | None:
    prompt = [
        {"role": "system", "content": "Answer using only the supplied mission state. Do not invent unavailable values."},
        *messages,
        {"role": "user", "content": "Mission state JSON:\n" + json.dumps(state, default=str)[:30000]},
    ]
    response, provider_failures = fallback(prompt)
    if response is None:
        return None
    return {
        "status": "ok", "provider": response.provider, "model": response.model, "text": response.text,
        "tool_calls": [], "fallback_failures": provider_failures,
        "gemini_failure": failures, "elapsed_ms": response.elapsed_ms,
        "evidence_note": "AI interpretation of supplied NeuroNexus state. Not itself a NASA observation.",
    }


def chat(messages: list[dict[str, str]], mission_state: dict[str, Any] | None = None, *,
         enable_search: bool = False, thinking_mode: bool = False) -> dict[str, Any]:
    state = mission_state or {}
    result = gemini.chat(messages, state, enable_search=enable_search, thinking_mode=thinking_mode)
    if result.get("status") == "ok":
        return result
    fallback_result = _fallback_chat(messages, state, [{"provider": "Gemini", "reason": str(result.get("reason", "failed"))}])
    return fallback_result or {**result, "fallback": status()}


def analyse_routes(payload: dict[str, Any]) -> dict[str, Any]:
    result = gemini.analyse_routes(payload)
    if result.get("status") == "ok":
        return result
    messages = [
        {"role": "system", "content": "Return JSON only. Preserve all deterministic route values exactly."},
        {"role": "user", "content": "Route analysis JSON:\n" + json.dumps(payload, default=str)[:60000]},
    ]
    response, failures = fallback(messages, json_mode=True)
    if response is None:
        return {**result, "fallback": status()}
    try:
        analysis = json.loads(response.text)
    except json.JSONDecodeError:
        return {"status": "error", "reason": "Fallback provider returned invalid JSON.", "provider": response.provider}
    return {"status": "ok", "provider": response.provider, "model": response.model, "analysis": analysis,
            "fallback_failures": failures, "schema": "neuronexus.route-analysis.v1",
            "elapsed_ms": response.elapsed_ms}


def status() -> dict[str, Any]:
    return {
        "fallback_order": [provider.name for provider in PROVIDERS],
        "configured": [provider.name for provider in PROVIDERS if _configured(provider)],
        "timeout_seconds": REQUEST_TIMEOUT_SECONDS,
        "retry_policy": "one attempt per provider; no sleeps or provider retries",
    }


def service_status() -> dict[str, Any]:
    return {**gemini.service_status(), "fallback": status()}
