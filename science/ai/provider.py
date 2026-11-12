"""AI provider selection.

The API layer talks to this module only. A provider is any module exposing
chat(messages, mission_state, *, enable_search, thinking_mode), analyse_routes(payload) and
service_status(). The default "auto" is the Qwen/Gemini router; to add another provider, implement
those three functions in a new module and register it in PROVIDERS, then set
AI_PROVIDER=<name>. Tools (science.ai.tools) and the knowledge base
(science.ai.knowledge_base) are provider-independent and are reused as-is.
"""

from __future__ import annotations

import importlib
import os
from typing import Any

PROVIDERS = {"gemini": "science.ai.gemini", "auto": "science.ai.router"}
# "auto" routes between the fine-tuned Qwen voice model and Gemini tool calling (science/ai/router.py).
# Without QWEN_BASE_URL it behaves like "gemini".
DEFAULT_PROVIDER = "auto"


def _module():
    name = (os.environ.get("AI_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
    return importlib.import_module(PROVIDERS.get(name, PROVIDERS[DEFAULT_PROVIDER]))


def chat(messages: list[dict[str, str]], mission_state: dict[str, Any] | None = None, *, enable_search: bool = False,
         thinking_mode: bool = False):
    extra = {"thinking_mode": True} if thinking_mode else {}  # a provider module may predate the flag
    return _module().chat(messages, mission_state, enable_search=enable_search, **extra)


def analyse_routes(payload: dict[str, Any]):
    return _module().analyse_routes(payload)


def service_status() -> dict[str, Any]:
    return {**_module().service_status(), "provider_key": (os.environ.get("AI_PROVIDER") or DEFAULT_PROVIDER),
            "providers_available": sorted(PROVIDERS)}
