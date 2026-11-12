"""Fast, single-pass fallback routing for AI text generation."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from science.ai import gemini, guard
from science.ai.tools import call_tool

FAILOVER_CODES = frozenset({401, 403, 404, 410, 429, 500, 502, 503, 504})
CONNECT_TIMEOUT_SECONDS = 2.5  # a dead or refusing provider fails fast; refusals (4xx/5xx) return at once
READ_TIMEOUT_SECONDS = 20.0    # a full answer takes 2 to 10 s; 2.5 s would cut every real answer off
BUDGET_SECONDS = 30.0          # the whole fallback chain stops here, so the chat never hangs for a minute


@dataclass(frozen=True)
class Provider:
    name: str
    key_env: str
    endpoint: str
    models: tuple[str, ...]
    kind: str = "openai"
    extra: dict[str, Any] = field(default_factory=dict)  # provider-specific request fields


@dataclass(frozen=True)
class ProviderResponse:
    provider: str
    model: str
    text: str
    elapsed_ms: float


# Policy: no Chinese or Russian models or vendors (frontend/src/__tests__/landing.test.js enforces the names).
# NVIDIA and OpenRouter models were checked live on 2026-11-02; the others need their keys to verify.
PROVIDERS = (
    Provider("Groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1/chat/completions",
             ("llama-3.3-70b-versatile", "openai/gpt-oss-120b")),
    Provider("Mistral", "MISTRAL_API_KEY", "https://api.mistral.ai/v1/chat/completions",
             ("mistral-large-latest", "mistral-small-latest")),
    # Thinking off: on a 25 KB mission state, Nemotron's reasoning took ~24 s and could leave an empty answer;
    # off, answers took 2 to 12 s. The 550B Nemotron timed out even then, so Google's DiffusionGemma is second.
    Provider("NVIDIA NIM", "NVIDIA_API_KEY", "https://integrate.api.nvidia.com/v1/chat/completions",
             ("nvidia/nemotron-3.5-super-vl-120b-a12b", "google/diffusiongemma-26b-a4b-it"),
             extra={"chat_template_kwargs": {"enable_thinking": False}}),
    Provider("GitHub Models", "GITHUB_MODELS_TOKEN", "https://models.github.ai/inference/chat/completions",
             ("openai/gpt-4o", "microsoft/Phi-4")),
    Provider("Cohere", "COHERE_API_KEY", "https://api.cohere.com/v2/chat",
             ("command-r-plus-08-2024",), kind="cohere"),
    Provider("OpenRouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1/chat/completions",
             ("nvidia/nemotron-3.5-super-vl:free", "nvidia/nemotron-3-ultra-550b-a55b:free"),
             extra={"reasoning": {"enabled": False}}),
)


class ProviderUnavailable(RuntimeError):
    """Raised when a configured provider cannot return usable content."""


def _configured(provider: Provider) -> bool:
    return bool((os.environ.get(provider.key_env) or "").strip())


def _models(provider: Provider) -> list[str]:
    """Models to try in order: <NAME>_MODEL (comma-separated, e.g. NVIDIA_NIM_MODEL) or the defaults."""
    key = f"{provider.name.upper().replace(' ', '_').replace('-', '_')}_MODEL"
    return [m.strip() for m in (os.environ.get(key) or "").split(",") if m.strip()] or list(provider.models)


def _request(provider: Provider, messages: list[dict[str, str]], *, json_mode: bool = False,
             model: str | None = None, read_timeout: float = READ_TIMEOUT_SECONDS) -> ProviderResponse:
    model = model or _models(provider)[0]
    if provider.kind == "cohere":
        payload: dict[str, Any] = {"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 2048}
    else:
        payload = {"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 2048, **provider.extra}
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
    started = time.perf_counter()
    headers = {"Authorization": f"Bearer {os.environ[provider.key_env].strip()}",
               "Content-Type": "application/json"}
    with httpx.Client(timeout=httpx.Timeout(read_timeout, connect=CONNECT_TIMEOUT_SECONDS)) as client:
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
    if not json_mode and "banned_safety_term" in guard.check(text, "")["violations"]:
        raise ProviderUnavailable(f"{provider.name} called something safe; the console never does")
    return ProviderResponse(provider.name, model, text, (time.perf_counter() - started) * 1000)


def fallback(messages: list[dict[str, str]], *, json_mode: bool = False) -> tuple[ProviderResponse | None, list[dict[str, str]]]:
    """Try configured providers once each, without sleeping or retrying."""
    failures: list[dict[str, str]] = []
    deadline = time.perf_counter() + BUDGET_SECONDS
    for provider in PROVIDERS:
        if not _configured(provider):
            continue
        for model in _models(provider):
            left = deadline - time.perf_counter()
            if left < 1:
                failures.append({"provider": provider.name, "model": model, "reason": f"skipped: {BUDGET_SECONDS:g} s budget used"})
                return None, failures
            try:
                return _request(provider, messages, json_mode=json_mode, model=model,
                                read_timeout=min(READ_TIMEOUT_SECONDS, left)), failures
            except (httpx.HTTPError, TimeoutError, ValueError, ProviderUnavailable) as exc:
                code = getattr(getattr(exc, "response", None), "status_code", None)
                failures.append({"provider": provider.name, "model": model,
                                 "reason": f"{code or type(exc).__name__}: {str(exc)[:160]}"})
                if code in (401, 403):  # the key itself is refused: this provider's other models will be too
                    break
    return None, failures


def _fallback_chat(messages: list[dict[str, str]], state: dict[str, Any], failures: list[dict[str, Any]]) -> dict[str, Any] | None:
    question = str((messages[-1] if messages else {}).get("content", ""))
    knowledge = call_tool("search_mars_knowledge", {"query": question[:300], "k": 4}, state)
    prompt = [
        {"role": "system", "content": "You are MARS INTELLIGENCE, the NeuroNexus Mars assistant. Answer using only the "
                                      "supplied mission state and knowledge-base excerpts. Do not invent values; say "
                                      "UNAVAILABLE when they lack it. Never use the words safe, unsafe or safety: the console "
                                      "gives planning statuses (WITHIN PLANNING LIMITS, REVIEW REQUIRED, EXCEEDS PLANNING "
                                      "LIMIT), not verdicts, and the crew decides."},
        *messages,
        {"role": "user", "content": "Mission state JSON:\n" + json.dumps(state, default=str)[:20000]
                                    + "\n\nKnowledge-base excerpts JSON:\n" + json.dumps(knowledge, default=str)[:12000]},
    ]
    response, provider_failures = fallback(prompt)
    if response is None:
        failures.extend(provider_failures)
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
        return {**result, "provider": "gemini"}
    reason = str(result.get("reason", "failed"))
    gemini_failures = [{"provider": "Gemini", "reason": reason}]
    fallback_result = _fallback_chat(messages, state, gemini_failures)
    if fallback_result:
        return {**fallback_result, "fallback_from": f"gemini: {reason}"}
    return {**result, "fallback": status(), "fallback_failures": gemini_failures[1:]}


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
        return {**result, "fallback": status(), "fallback_failures": gemini_failures[1:]}
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
        "timeout_seconds": {"connect": CONNECT_TIMEOUT_SECONDS, "read": READ_TIMEOUT_SECONDS, "budget": BUDGET_SECONDS},
        "retry_policy": "one attempt per provider; no sleeps or provider retries",
    }


def service_status() -> dict[str, Any]:
    return {**gemini.service_status(), "fallback": status()}
