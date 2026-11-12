"""Fine-tuned Qwen provider (MARS INTELLIGENCE voice) over an OpenAI-compatible endpoint.

Serve the published GGUF with llama.cpp and point QWEN_BASE_URL at it:
    llama-server -hf Mhaquehaque/neuronexus-qwen3-4b-mars-intel:Q4_K_M --jinja -c 4096 --port 8081
    QWEN_BASE_URL=http://127.0.0.1:8081
Facts always come from the CONTEXT block built by science.ai.context; the model supplies voice.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any

import requests

DEFAULT_MODEL = "neuronexus-qwen3-4b-mars-intel"
HEALTH_CACHE_S = 30
MAX_HISTORY_TURNS = 4
MAX_HISTORY_CHARS = 500  # earlier long answers (often Gemini's) would slow a CPU model down
SYSTEM = (Path(__file__).resolve().parents[2] / "training" / "data" / "system_prompt.txt")

_lock = threading.Lock()
_health: dict[str, Any] = {"url": None, "ok": False, "at": 0.0, "detail": None}


def base_url() -> str | None:
    value = (os.environ.get("QWEN_BASE_URL") or "").strip().rstrip("/")
    return value or None


def model_name() -> str:
    return (os.environ.get("QWEN_MODEL") or DEFAULT_MODEL).strip()


def timeout_s() -> float:
    return float(os.environ.get("QWEN_TIMEOUT_S") or 120)


def system_prompt() -> str:
    try:
        return SYSTEM.read_text(encoding="utf-8").strip()
    except OSError:
        return ("You are MARS INTELLIGENCE. Use only facts in CONTEXT, cite tags, say n/a when missing, "
                "never call anything safe.")


def _headers() -> dict[str, str]:
    key = (os.environ.get("QWEN_API_KEY") or "").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


def healthy(force: bool = False) -> tuple[bool, str | None]:
    """Cached /health probe so a down endpoint costs nothing per request."""
    url = base_url()
    if not url:
        return False, "QWEN_BASE_URL is not configured."
    with _lock:
        if not force and _health["url"] == url and time.time() - _health["at"] < HEALTH_CACHE_S:
            return _health["ok"], _health["detail"]
    try:
        r = requests.get(f"{url}/health", headers=_headers(), timeout=3)
        ok, detail = r.status_code == 200, (None if r.status_code == 200 else f"/health returned {r.status_code}")
    except requests.RequestException as exc:
        ok, detail = False, f"unreachable: {type(exc).__name__}"
    with _lock:
        _health.update(url=url, ok=ok, at=time.time(), detail=detail)
    return ok, detail


def mark_down(detail: str) -> None:
    with _lock:
        _health.update(url=base_url(), ok=False, at=time.time(), detail=detail)


def complete(messages: list[dict[str, str]], context: str) -> dict[str, Any]:
    """One answer from the fine-tuned model. Raises on transport errors; the router handles fallback."""
    history = [{"role": m["role"], "content": str(m["content"])[:MAX_HISTORY_CHARS]}
               for m in messages[:-1] if str(m.get("content", "")).strip()][-MAX_HISTORY_TURNS:]
    question = str(messages[-1].get("content", "")).strip()
    payload = {
        "model": model_name(), "temperature": 0.2, "max_tokens": 400,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "system", "content": system_prompt()}, *history,
                     {"role": "user", "content": f"CONTEXT:\n{context}\n\nQUESTION: {question}"}],
    }
    started = time.perf_counter()
    r = requests.post(f"{base_url()}/v1/chat/completions", json=payload, headers=_headers(), timeout=timeout_s())
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"] or ""
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return {"text": text.strip(), "elapsed_ms": round((time.perf_counter() - started) * 1000, 1)}


def service_status() -> dict[str, Any]:
    ok, detail = healthy(force=True)
    return {"provider": "qwen", "model": model_name(), "configured": base_url() is not None, "healthy": ok,
            "detail": detail, "endpoint": "OpenAI-compatible /v1/chat/completions (llama.cpp server)",
            "weights": "https://huggingface.co/Mhaquehaque/neuronexus-qwen3-4b-mars-intel"}
