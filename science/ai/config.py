"""Gemini configuration (server-side only).

The API key is read from GEMINI_API_KEY and never leaves the backend.
GEMINI_MODEL stays configurable. Because Google retires model versions
(gemini-2.5-flash is being shut down), the configured model is checked
against the models this API key can actually use, via the Models API, and a
clear notice is produced when it is unavailable.
"""

from __future__ import annotations

import os
import re
import threading
import time
from typing import Any

# Default Flash model. Override with GEMINI_MODEL. If it is unavailable or
# overloaded for a key, calls fail over to the next working model.
DEFAULT_MODEL = "gemini-3.6-flash"
ENV_KEY = "GEMINI_API_KEY"
ENV_MODEL = "GEMINI_MODEL"
ENV_PREFERENCE = "GEMINI_MODEL_PREFERENCE"  # optional comma-separated model ids, tried first, in order

# Blind attempt order used ONLY when the Models API listing itself fails (so nothing can be discovered).
# When discovery works, models are ranked dynamically by _rank_key and nothing here is locked in.
PREFERRED_MODELS = [
    "gemini-3.6-flash",
    "gemini-3-flash-preview",
    "gemini-flash-latest",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
]

# How long a model that returned 401/403 / 404 / 429 / 5xx is skipped before being retried. Short on
# purpose: a free-tier per-minute quota (429) or a 503 spike clears quickly, and the ranking below puts the
# best model back in front of the chain as soon as its cooldown ends. A retired model (404) stays out longer.
FAILED_MODEL_COOLDOWN_S = {401: 3600, 403: 60, 404: 3600, 429: 60, 500: 60, 503: 60}
DEFAULT_COOLDOWN_S = 60
MAX_MODEL_ATTEMPTS = 5

_EXCLUDED = ("image", "audio", "live", "tts", "embedding", "embed", "veo", "imagen", "lyria", "robotics", "aqa", "computer-use")
MODEL_CACHE_SECONDS = 3600  # model discovery is cached for one hour

_lock = threading.Lock()
_cache: dict[str, Any] = {"key_fingerprint": None, "at": 0.0, "models": None, "error": None}
_health: dict[str, Any] = {"working": None, "working_at": 0.0, "cooldown": {}}


def _load_dotenv_once() -> None:
    if getattr(_load_dotenv_once, "done", False):
        return
    try:
        from dotenv import load_dotenv  # optional dependency

        load_dotenv()
    except Exception:
        pass
    _load_dotenv_once.done = True  # type: ignore[attr-defined]


def api_key() -> str | None:
    _load_dotenv_once()
    value = (os.environ.get(ENV_KEY) or "").strip()
    return value or None


def configured_model() -> str:
    """The model requested by configuration (GEMINI_MODEL or the default)."""
    _load_dotenv_once()
    value = (os.environ.get(ENV_MODEL) or "").strip()
    return value.removeprefix("models/") or DEFAULT_MODEL


def model_explicitly_configured() -> bool:
    _load_dotenv_once()
    return bool((os.environ.get(ENV_MODEL) or "").strip())


def model_preference() -> list[str]:
    """GEMINI_MODEL_PREFERENCE: optional ordered list of model ids to try first (comma separated)."""
    _load_dotenv_once()
    raw = os.environ.get(ENV_PREFERENCE) or ""
    return [m.strip().removeprefix("models/") for m in raw.split(",") if m.strip()]


def _version_key(name: str) -> tuple:
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", name)]
    return (0 if "preview" in name or "exp" in name else 1, numbers[:1] or [0.0], "lite" not in name)


def _rank_key(name: str) -> tuple:
    """Dynamic ranking of discovered models (ascending sort, best first): general Flash first, then Pro
    (almost no free-tier quota), Flash-Lite last as the high-quota backup. Within a tier newest version
    first, stable before preview."""
    lite = "lite" in name
    pro = "pro" in name and not lite
    version = max([float(n) for n in re.findall(r"\d+(?:\.\d+)?", name)] or [0.0])
    preview = "preview" in name or "exp" in name
    return (lite, pro, -version, preview, name)


def list_available_models(client: Any, *, force: bool = False) -> list[str]:
    """Text-generation models this API key can call (cached for 10 minutes)."""
    fingerprint = (api_key() or "")[-6:]
    with _lock:
        fresh = time.time() - _cache["at"] < MODEL_CACHE_SECONDS and _cache["key_fingerprint"] == fingerprint
        if fresh and not force and _cache["models"] is not None:
            return list(_cache["models"])
    names: list[str] = []
    for model in client.models.list():
        name = str(getattr(model, "name", "") or "").removeprefix("models/")
        actions = [str(a) for a in (getattr(model, "supported_actions", None) or [])]
        if not name.startswith("gemini"):
            continue
        if actions and "generateContent" not in actions:
            continue
        if any(token in name for token in _EXCLUDED):
            continue
        names.append(name)
    with _lock:
        _cache.update(key_fingerprint=fingerprint, at=time.time(), models=list(names), error=None)
    return names


def choose_model(available: list[str], requested: str) -> str | None:
    """The requested model if callable, otherwise the best-ranked discovered model."""
    if requested in available:
        return requested
    return sorted(available, key=_rank_key)[0] if available else None


def mark_model_failed(model: str, code: int | None) -> None:
    seconds = FAILED_MODEL_COOLDOWN_S.get(code or 503, DEFAULT_COOLDOWN_S)
    with _lock:
        _health["cooldown"][model] = time.time() + seconds
        if _health["working"] == model:
            _health["working"] = None


def mark_model_ok(model: str) -> None:
    with _lock:
        _health["working"] = model
        _health["working_at"] = time.time()
        _health["cooldown"].pop(model, None)


def _cooling(model: str) -> bool:
    until = _health["cooldown"].get(model)
    return bool(until and until > time.time())


def model_attempt_order(available: list[str] | None, requested: str) -> list[str]:
    """The fallback chain, best first, skipping models on cooldown.

    Order: GEMINI_MODEL_PREFERENCE entries, an explicitly configured GEMINI_MODEL, then every discovered
    model ranked by _rank_key. No model is hardcoded as the default. A model listed by the Models API can
    still refuse calls (404 retired, 403 tier, 429 quota, 503 overload), so the listing only orders the
    attempts and real calls decide; a refused model sits out its cooldown and the next one answers.
    """
    explicit = model_explicitly_configured()
    with _lock:
        pool = list(available) if available is not None else []
        order: list[str] = []

        def add(name: str) -> None:
            if name not in order and (available is None or name in pool) and not _cooling(name):
                order.append(name)

        for name in model_preference():
            add(name)
        if explicit:
            add(requested)
        for name in sorted((n for n in pool if "lite" not in n), key=_rank_key):
            add(name)
        for name in sorted((n for n in pool if "lite" in n), key=_rank_key):
            add(name)
        if not order and pool:  # everything is cooling down: retry the best candidates anyway
            order = sorted(pool, key=_rank_key)
    return order[:MAX_MODEL_ATTEMPTS]


def resolve_model(client: Any) -> dict[str, Any]:
    """Discover the models this key can call, rank them, and explain any substitution clearly."""
    requested = configured_model()
    explicit = model_explicitly_configured()
    try:
        available = list_available_models(client)
    except Exception as exc:  # listing failed: nothing to discover, so try the blind order
        order = model_attempt_order(None, requested) or [requested]
        for name in PREFERRED_MODELS:
            if name not in order and len(order) < MAX_MODEL_ATTEMPTS:
                order.append(name)
        return {"model": order[0], "requested": requested, "explicit": explicit, "available": None,
                "substituted": explicit and order[0] != requested,
                "notice": None, "listing_error": str(exc)[:200], "attempt_order": order}
    order = model_attempt_order(available, requested)
    chosen = order[0] if order else choose_model(available, requested)
    if chosen is None:
        return {"model": None, "requested": requested, "explicit": explicit, "available": available,
                "substituted": False, "attempt_order": [],
                "notice": "This API key has no Gemini text-generation model available.", "listing_error": None}
    substituted = explicit and chosen != requested
    notice = None
    if substituted:
        notice = (
            f"Configured model '{requested}' (GEMINI_MODEL) is unavailable for this API key; using '{chosen}'. "
            f"Set GEMINI_MODEL to one of: {', '.join(sorted(available)[:12])}."
        )
    return {"model": chosen, "requested": requested, "explicit": explicit, "available": available,
            "substituted": substituted, "notice": notice, "listing_error": None,
            "attempt_order": order or [chosen]}


def model_name() -> str:
    """Backwards-compatible accessor: the configured model name."""
    return configured_model()


def status() -> dict[str, Any]:
    return {
        "provider": "Google Gemini (google-genai SDK, server-side only)",
        "configured": api_key() is not None,
        "model": configured_model(),
        "model_source": "GEMINI_MODEL environment variable" if model_explicitly_configured() else "default",
        "key_environment_variable": ENV_KEY,
        "key_exposed_to_browser": False,
        "note": (
            "Gemini interprets and explains deterministic results. It never generates route "
            "geometry and never alters computed numbers."
        ),
    }
