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

# Current generally-available Flash model. Override with GEMINI_MODEL.
DEFAULT_MODEL = "gemini-3.5-flash"
ENV_KEY = "GEMINI_API_KEY"
ENV_MODEL = "GEMINI_MODEL"

# Preferred fallbacks, newest first. Only models the key can actually call
# are ever used; this list only orders the choice.
PREFERRED_MODELS = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
]

_EXCLUDED = ("image", "audio", "live", "tts", "embedding", "embed", "veo", "imagen", "lyria", "robotics", "aqa", "computer-use")
MODEL_CACHE_SECONDS = 600

_lock = threading.Lock()
_cache: dict[str, Any] = {"key_fingerprint": None, "at": 0.0, "models": None, "error": None}


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


def _version_key(name: str) -> tuple:
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", name)]
    return (0 if "preview" in name or "exp" in name else 1, numbers[:1] or [0.0], "lite" not in name)


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
    """The requested model if callable, otherwise the best callable Flash-class model."""
    if requested in available:
        return requested
    for preferred in PREFERRED_MODELS:
        if preferred in available:
            return preferred
    flash = [name for name in available if "flash" in name]
    pool = flash or available
    return sorted(pool, key=_version_key, reverse=True)[0] if pool else None


def resolve_model(client: Any) -> dict[str, Any]:
    """Resolve which model to call and explain any substitution clearly."""
    requested = configured_model()
    try:
        available = list_available_models(client)
    except Exception as exc:  # listing failed: try the requested model as-is
        return {"model": requested, "requested": requested, "available": None, "substituted": False,
                "notice": None, "listing_error": str(exc)[:200]}
    chosen = choose_model(available, requested)
    if chosen is None:
        return {"model": None, "requested": requested, "available": available, "substituted": False,
                "notice": "This API key has no Gemini text-generation model available.", "listing_error": None}
    notice = None
    if chosen != requested:
        source = "GEMINI_MODEL" if model_explicitly_configured() else "the default model"
        notice = (
            f"Configured model '{requested}' ({source}) is unavailable for this API key; using '{chosen}'. "
            f"Set GEMINI_MODEL to one of: {', '.join(sorted(available)[:12])}."
        )
    return {"model": chosen, "requested": requested, "available": available, "substituted": chosen != requested,
            "notice": notice, "listing_error": None}


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
