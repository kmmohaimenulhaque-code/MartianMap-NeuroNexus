from __future__ import annotations

import os
from typing import Any

DEFAULT_MODEL = "gemini-2.5-flash"
ENV_KEY = "GEMINI_API_KEY"
ENV_MODEL = "GEMINI_MODEL"


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


def model_name() -> str:
    _load_dotenv_once()
    return (os.environ.get(ENV_MODEL) or "").strip() or DEFAULT_MODEL


def status() -> dict[str, Any]:
    return {
        "provider": "Google Gemini (google-genai SDK, server-side only)",
        "configured": api_key() is not None,
        "model": model_name(),
        "model_source": "GEMINI_MODEL environment variable" if os.environ.get(ENV_MODEL) else "default",
        "key_environment_variable": ENV_KEY,
        "key_exposed_to_browser": False,
        "note": (
            "Gemini interprets and explains deterministic results. It never generates route "
            "geometry and never alters computed numbers."
        ),
    }
