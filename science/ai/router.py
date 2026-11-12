"""AI router: the fine-tuned Qwen voice model for explanation, Gemini for tool calling.

Routing (science.ai.intent decides, every response says why):
  1. Web search, recent events and multi-step questions go to Gemini function calling.
  2. Explanations, single-topic data questions, app help and Mars knowledge go to Qwen. The
     router first runs the matching deterministic tools and hands Qwen a CONTEXT block.
  3. Every Qwen answer passes science.ai.guard (numbers grounded in CONTEXT, no "safe", only the
     three planning statuses, n/a for missing data). A failed guard re-routes to Gemini.
  4. Qwen down or slow -> Gemini. Gemini down -> Qwen with the same deterministic tools.
     Both down -> the usual "unavailable" response; nothing is invented.
Structured route analysis stays on Gemini (JSON schema output).
"""

from __future__ import annotations

import re
import threading
import time
from collections import deque
from typing import Any

from science.ai import context, gemini, guard, intent, qwen

EVIDENCE_NOTE = "AI INTERPRETATION of NeuroNexus tool results. Not itself a NASA observation."
_decisions: deque = deque(maxlen=50)
_lock = threading.Lock()


def _record(question: str, result: dict[str, Any]) -> None:
    with _lock:
        _decisions.appendleft({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "question": question[:120],
                               **{k: result.get(k) for k in ("provider", "route", "route_reason", "fallback_from",
                                                             "status", "elapsed_ms", "guard")}})


def _expects_missing(ctx: str) -> bool:
    return bool(re.search(r":\s*n/a\b", ctx))


def _ask_qwen(messages, state, plan: intent.Intent, started: float) -> dict[str, Any]:
    ok, detail = qwen.healthy()
    if not ok:
        raise RuntimeError(f"qwen unavailable: {detail}")
    tools = plan.tools or intent.FAMILIES["site"] + intent.FAMILIES["environment"]
    ctx, tool_log = context.build(state, tools)
    question = str(messages[-1].get("content", ""))
    try:
        out = qwen.complete(messages, ctx)
    except Exception as exc:
        qwen.mark_down(f"{type(exc).__name__}")
        raise RuntimeError(f"qwen request failed: {type(exc).__name__}") from exc
    verdict = guard.check(out["text"], ctx + "\n" + question)
    if not verdict["ok"]:
        raise GuardFailure(verdict["violations"], out["text"])
    return {"status": "ok", "model": qwen.model_name(), "text": out["text"], "tool_calls": tool_log,
            "sources": gemini._sources(tool_log), "search_grounding": [], "web_sources": [], "thoughts": "", "model_notice": None,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1), "evidence_note": EVIDENCE_NOTE,
            "guard": {"ok": True, "violations": []}, "context_lines": ctx.count("\n") + 1,
            "expects_missing": _expects_missing(ctx)}


class GuardFailure(RuntimeError):
    def __init__(self, violations: list[str], text: str):
        super().__init__("guard:" + (violations[0] if violations else "failed"))
        self.violations, self.text = violations, text


def chat(messages: list[dict[str, str]], mission_state: dict[str, Any] | None = None, *,
         enable_search: bool = False, thinking_mode: bool = False) -> dict[str, Any]:
    started = time.perf_counter()
    state = mission_state or {}
    question = str((messages[-1] if messages else {}).get("content", ""))
    plan = intent.classify(question, enable_search=enable_search)
    if thinking_mode and plan.route == "qwen":  # reasoning traces exist only on Gemini
        plan = intent.Intent("gemini", "thinking mode requires Gemini", plan.families, plan.tools)
    order = ["qwen", "gemini"] if plan.route == "qwen" else ["gemini", "qwen"]
    if qwen.base_url() is None:  # Qwen not deployed: plain Gemini, no fallback noise
        order = ["gemini"]
    fallback_from: str | None = None
    guard_info: dict[str, Any] | None = None
    last: dict[str, Any] | None = None
    for provider in order:
        if provider == "qwen":
            try:
                result = _ask_qwen(messages, state, plan, started)
                break
            except GuardFailure as exc:
                guard_info = {"ok": False, "violations": exc.violations}
                fallback_from = f"qwen: {exc}"
            except Exception as exc:
                fallback_from = f"qwen: {exc}"
            continue
        extra = {"thinking_mode": True} if thinking_mode else {}  # older provider modules do not take the flag
        result = gemini.chat(messages, state, enable_search=enable_search, **extra)
        if result.get("status") == "ok":
            break
        last = result
        fallback_from = f"gemini: {result.get('reason') or result.get('status')}"
    else:
        result = last or {"status": "unavailable", "reason": "No AI provider is configured or reachable.",
                          "note": "The rest of NeuroNexus works without the assistant."}
        provider = "none"
    if result.get("status") == "ok":
        provider = "qwen" if result.get("model") == qwen.model_name() else "gemini"
    result.update({"provider": provider, "route": plan.route, "route_reason": plan.reason,
                   "fallback_from": fallback_from if fallback_from and provider != order[0] else None})
    if guard_info and provider != "qwen":
        result["guard"] = guard_info
    result.setdefault("elapsed_ms", round((time.perf_counter() - started) * 1000, 1))
    if result.get("status") == "ok":  # stable response shape for the console, whichever provider answered
        result.setdefault("model_used", result.get("model"))
        result.setdefault("fallback_chain_tried", [])
        result.setdefault("thoughts", "")
        result.setdefault("web_sources", [])
    _record(question, result)
    return result


def analyse_routes(payload: dict[str, Any]) -> dict[str, Any]:
    return {**gemini.analyse_routes(payload), "provider": "gemini", "route_reason": "structured route analysis (JSON schema)"}


def service_status() -> dict[str, Any]:
    with _lock:
        recent = list(_decisions)
    return {**gemini.service_status(), "router": {
        "providers": {"qwen": qwen.service_status(), "gemini": {"configured": gemini.api_key() is not None}},
        "rules": __doc__.split("Routing", 1)[1].split("Structured", 1)[0].strip(),
        "recent_decisions": recent}}
