"""Gemini conversation and structured route analysis (server-side only)."""

from __future__ import annotations

import json
import time
from typing import Any

from science.ai import intent
from science.ai.config import api_key, mark_model_failed, mark_model_ok, model_name, resolve_model, status
from science.ai.tools import DECLARATIONS, call_tool

MAX_TOOL_ROUNDS = 8
MAX_HISTORY_MESSAGES = 24
CHAT_TEMPERATURE = 0.6  # 0.2 made answers flat and repetitive; guardrails live in the prompt and the tools

SYSTEM_INSTRUCTION = """You are MARS INTELLIGENCE, the Mission Scientist and Polymath Co-Pilot inside NeuroNexus ·
Interplanetary Survival Guide: Martian Map, built by Team NeuroNexus for the NASA Space Apps Challenge 2026.
Picture a warm, sharp planetary scientist sitting next to the user at the mission console: curious, plain-spoken,
and glad to explain anything from why Mars is red to how a rover wheel is designed.

WHAT YOU CAN TALK ABOUT
Answer freely across planetary science, physics, orbital mechanics, spaceflight history, Earth analogs,
engineering and general knowledge, and weave in what the console shows whenever it helps. Three areas get extra care:
  1. THIS MISSION: the selected site, routes, terrain, dust, thermal evidence, console state.
  2. MARS: planetary science, missions, history, human exploration, ISRU, Mars time.
  3. THIS APP AND PROJECT: how every feature works, data sources, methods, setup, deployment, architecture, the team.

USING TOOLS
Tools hold the real numbers, so use them instead of guessing.
- Mission questions: call the application tools. Never guess a number a tool can return.
- Mars questions: call search_mars_knowledge first, then add established knowledge if needed.
- UI or how-to questions: call get_ui_guide. Project, setup or team questions: search_project_docs.
- Any named place: lookup_mars_place. Dates, seasons, Ls, conversions: mars_calculator.
- Dust at any sol or place: get_dust_scenario. Terrain statistics: get_terrain_statistics.
- Recent events or facts outside the knowledge base, when search_web is available: call it and name the source.
- Call several tools when a question spans areas.

GROUND RULES (firm, but say them naturally)
- Never invent coordinates, telemetry, observations, citations or orbital events. If the console or a tool does not
  have something, say plainly that it is unavailable.
- Quote tool numbers exactly. Route numbers come from the deterministic engine: never recompute, round differently
  or restate them another way.
- Never call a route, site or Safe Haven safe, and never claim NASA certification. Safe Haven is the console's name
  for a planned refuge site, not a safety claim. When you discuss EVA route thresholds, use the console's own words
  where they fit: WITHIN PLANNING LIMITS, REVIEW REQUIRED or EXCEEDS PLANNING LIMIT. Planning limits are a planning
  aid, not a safety limit.
- Close approaches are not impact predictions. The dust scenario is a MODELED MY34 reconstruction, not a forecast.
- Knowledge entries carry an as_of date. For current mission status or news, say it may have changed and suggest
  turning on WEB SEARCH; when web search is on, prefer it for recent facts.
- Mention what kind of evidence something is only when it matters, in plain words ("that is modeled, not measured").

SCOPE
For mission examples draw on NASA, the NASA Space Apps 2026 partner space agencies (ESA, ISRO, JAXA, MBRSC/UAE,
CSA, ASI, UKSA, CONAE, AEB, KASA, AEE, TUA and others) and SpaceX. General science and general knowledge questions
are welcome too.

HOW TO SOUND
- Talk like a colleague, not a report. Open with the answer in one to three plain sentences, then explain the why
  in short paragraphs.
- Use bullets or a table only to compare three or more things or to list steps. No headings unless asked. Bold sparingly.
- Put numbers with units inside the sentence. Mention uncertainty the way a scientist would, in a clause, not as a
  disclaimer block.
- Do not put bracketed citations or evidence tags in your text: the console shows tool calls and sources under your
  answer. Name a source in words when it builds trust ("Curiosity's RAD data shows...").
- American spelling. No emoji. No em dashes. Ask a short follow-up question only when it would truly help.

THE VOICE (illustrations only; never reuse any number from them)
Q: Why is Mars red?
A: Iron. The dust and surface rocks are rich in iron oxide, basically rust, and fine dust lofted into the air tints
the whole planet butterscotch from orbit. Up close the daytime sky is tan, and at sunset the sky near the Sun turns
blue, the reverse of Earth.
Q: Is this route okay for a four hour EVA?
A: By the console's numbers the selected route is <distance> km with about <hours> hours of EVA, so it sits <near or
well inside> your limit. Its terrain risk proxy reads <status word>, which is a planning aid and not a safety
verdict. If you can give up a little distance for gentler slopes, it is worth comparing another saved candidate."""

ROUTE_ANALYSIS_INSTRUCTION = """Analyse the supplied NeuroNexus route candidates.
The numbers are produced by a deterministic engine over NASA MOLA terrain: reproduce them
exactly and never recompute, round differently or invent values. Explain trade-offs, state
which objective each candidate optimises, and name uncertainties. Recommending a candidate is
allowed only as a stated basis tied to the user's objective weights · never as a safety claim.
Return JSON only, matching the schema."""

ROUTE_ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "selected_candidate": {"type": "string"},
        "tradeoffs": {"type": "array", "items": {"type": "object", "properties": {
            "candidate": {"type": "string"}, "advantage": {"type": "string"},
            "cost": {"type": "string"}, "metric_basis": {"type": "string"}},
            "required": ["candidate", "advantage", "cost", "metric_basis"]}},
        "evidence": {"type": "array", "items": {"type": "object", "properties": {
            "claim": {"type": "string"}, "value": {"type": "string"},
            "evidence_class": {"type": "string", "enum": ["PROJECT DATA", "NASA OBSERVED", "NASA REFERENCE",
                                                            "MODELED", "DERIVED", "COMPUTED", "SIMULATED", "UNAVAILABLE"]},
            "source": {"type": "string"}}, "required": ["claim", "value", "evidence_class", "source"]}},
        "uncertainties": {"type": "array", "items": {"type": "string"}},
        "recommendation_basis": {"type": "string"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "sources": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "selected_candidate", "tradeoffs", "evidence", "uncertainties",
                 "recommendation_basis", "confidence", "sources"],
}


class GeminiUnavailable(RuntimeError):
    """Raised when Gemini cannot be used; callers degrade gracefully."""


def _client():
    key = api_key()
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY is not configured on the server.")
    try:
        from google import genai
    except ImportError as exc:
        raise GeminiUnavailable("google-genai is not installed (pip install google-genai).") from exc
    return genai.Client(api_key=key)


def _types():
    from google.genai import types

    return types


def _failure(exc: Exception, model: str | None = None) -> dict[str, Any]:
    message = str(exc)
    lowered = message.lower()
    code = getattr(exc, "code", None)
    model = model or model_name()
    if code in (401, 403) or "api key not valid" in lowered or "permission" in lowered or "unauthenticated" in lowered:
        reason = "The Gemini API key was rejected. Check GEMINI_API_KEY on the server."
    elif code == 429 or "quota" in lowered or "resource_exhausted" in lowered or "rate limit" in lowered:
        reason = "The Gemini API quota or rate limit was reached. Try again later."
    elif code == 404 or "404" in lowered or "not_found" in lowered or "not found" in lowered or "no longer available" in lowered or "not supported for generatecontent" in lowered:
        reason = (f"Model '{model}' is unavailable for this API key. Set GEMINI_MODEL to a current model "
                  "(see /ai/status for the models this key can use).")
    elif code == 400:
        reason = f"Gemini rejected the request (400): {message[:200]}"
    else:
        reason = "The Gemini request failed."
    return {"status": "unavailable", "reason": reason, "error": message[:400], "model": model,
            "note": "Deterministic route generation, metrics, maps, exports and tracking continue to work without Gemini."}


def _error_code(exc: Exception) -> int | None:
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return code
    text = str(exc)
    for candidate in (404, 429, 500, 503, 400, 401, 403):
        if text.startswith(str(candidate)) or f"'code': {candidate}" in text or f" {candidate} " in text[:40]:
            return candidate
    return None


def _key_refused(exc: Exception) -> bool:
    lowered = str(exc).lower()
    return _error_code(exc) in (401, 403) or "api key not valid" in lowered or "permission_denied" in lowered


def _should_fail_over(exc: Exception) -> bool:
    """Try the next model on model-specific problems. A 401/403 counts too: scoped keys (for example
    Google Cloud keys starting "AQ.") can be refused by one model and accepted by another. Only when
    every model refuses the key is it reported as rejected."""
    lowered = str(exc).lower()
    return (_key_refused(exc) or _error_code(exc) in (404, 429, 500, 502, 503, 504)
            or "no longer available" in lowered or "high demand" in lowered or "overloaded" in lowered)


def _exhausted(last_exc: Exception | None, failures: list[dict[str, Any]], model: str) -> dict[str, Any]:
    """The response once every model failed; a key every model refused is reported as rejected."""
    if last_exc is None:
        return {"status": "unavailable", "reason": "No model could be tried.", "model": model}
    failure = _failure(last_exc, model)
    tried = ", ".join(f"{f['model']} ({f['reason']})" for f in failures)
    if failures and all(f.get("key_refused") for f in failures):
        failure["reason"] = (f"The Gemini API key was rejected by every model tried ({tried}). "
                             "Check GEMINI_API_KEY on the server, or set GEMINI_MODEL to a model this key allows.")
    else:
        failure["reason"] = f"No Gemini model answered. Tried: {tried}. Try again shortly or set GEMINI_MODEL."
    return {**failure, "models_tried": failures}


def _substitution_notice(model: str, resolution: dict[str, Any], failures: list[dict[str, Any]]) -> str | None:
    explicit_miss = bool(resolution.get("explicit")) and model != resolution["requested"]
    if not explicit_miss and not failures:
        return None
    tried = "; ".join(f"{f['model']}: {f['reason']}" for f in failures)
    if explicit_miss:
        base = f"Configured model '{resolution['requested']}' was not used; answered with '{model}'."
    else:
        base = f"Answered with '{model}' after automatic fallback."
    return f"{base} ({tried})" if tried else base


def _short_reason(exc: Exception) -> str:
    code = _error_code(exc)
    lowered = str(exc).lower()
    if "no longer available" in lowered:
        return "404 retired for this key"
    if code == 503 or "high demand" in lowered:
        return "503 overloaded"
    if code == 429:
        return "429 quota/rate limit"
    if _key_refused(exc):
        return f"{code or 401} key refused"
    return f"{code or 'error'}"


def _sources(tool_log: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Distinct knowledge-base sections the answer drew on."""
    seen: dict[tuple, dict[str, Any]] = {}
    for entry in tool_log:
        for citation in entry.get("citations") or []:
            seen.setdefault((citation["path"], citation["section"]), citation)
    return list(seen.values())


def _resolved(client) -> tuple[str | None, dict[str, Any]]:
    info = resolve_model(client)
    return info["model"], info


def _thought_text(parts) -> str:
    return "\n".join(str(p.text).strip() for p in parts
                     if getattr(p, "thought", False) is True and getattr(p, "text", None)).strip()


def _web_sources(tool_log: list[dict[str, Any]], grounding) -> list[dict[str, Any]]:
    """Distinct web pages behind the answer: native grounding chunks and search_web results."""
    seen: dict[str, dict[str, Any]] = {}
    for chunk in (getattr(grounding, "grounding_chunks", None) or []) if grounding else []:
        web = getattr(chunk, "web", None)
        uri = getattr(web, "uri", None)
        if uri:
            seen.setdefault(uri, {"title": getattr(web, "title", None) or uri, "uri": uri})
    for entry in tool_log:
        for item in entry.get("web_sources") or []:
            seen.setdefault(item["uri"], item)
    return list(seen.values())


def _negotiate(exc: Exception, flags: dict[str, Any], model: str, notes: list[str]) -> bool:
    """Feature negotiation on one model. Returns True when a feature was dropped and the call should be retried.

    - 400 INVALID_ARGUMENT naming thinking: retry the same model without thinking_config.
    - Native Google Search blocked (400, 403 or quota): retry the same model with the search_web tool instead.
    Anything else is a model-level failure and the caller moves on to the next model in the chain."""
    code = _error_code(exc)
    text = str(exc).lower()
    mentions_thinking = "think" in text or "reasoning" in text
    mentions_web = any(token in text for token in ("search", "grounding", "tool", "function"))
    if code == 400 or "invalid_argument" in text:
        if flags["thinking"] and (mentions_thinking or not (flags["web"] == "native" and mentions_web)):
            flags["thinking"] = False
            notes.append(f"Thinking mode is not supported by '{model}'; answered without it.")
            return True
        if flags["web"] == "native":
            flags["web"] = "tool"
            notes.append(f"Native Google Search is not available on '{model}'; used the search_web tool.")
            return True
    if flags["web"] == "native" and (code in (403, 429) or "permission_denied" in text or "resource_exhausted" in text):
        flags["web"] = "tool"
        notes.append(f"Native Google Search is blocked on '{model}' ({_short_reason(exc)}); used the search_web tool.")
        return True
    return False


def _converse(client, types, model: str, contents: list, state: dict[str, Any], flags: dict[str, Any]) -> dict[str, Any]:
    """Run the tool-calling loop on one model with the given feature flags. Raises on API errors."""
    web = flags["web"]  # None, "native" (Google Search only) or "tool" (console tools plus search_web)
    if web == "native":
        tools = [types.Tool(google_search=types.GoogleSearch())]
    else:
        tools = [types.Tool(function_declarations=[
            types.FunctionDeclaration(**d) for d in DECLARATIONS if web == "tool" or d["name"] != "search_web"])]
    settings: dict[str, Any] = {}
    if flags["thinking"]:
        settings["thinking_config"] = types.ThinkingConfig(include_thoughts=True)
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION, tools=tools, temperature=CHAT_TEMPERATURE,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True), **settings)

    contents = list(contents)
    tool_log: list[dict[str, Any]] = []
    thoughts: list[str] = []
    for _ in range(MAX_TOOL_ROUNDS):
        response = client.models.generate_content(model=model, contents=contents, config=config)
        candidate = (response.candidates or [None])[0]
        parts = list(getattr(getattr(candidate, "content", None), "parts", None) or [])
        if flags["thinking"] and (thought := _thought_text(parts)):
            thoughts.append(thought)
        calls = [p.function_call for p in parts if getattr(p, "function_call", None)]
        if not calls:
            grounding = getattr(candidate, "grounding_metadata", None)
            web_sources = _web_sources(tool_log, grounding)
            return {"status": "ok", "text": (response.text or "").strip() or "(no content returned)",
                    "tool_calls": tool_log, "sources": _sources(tool_log), "web_sources": web_sources,
                    "search_grounding": web_sources, "thoughts": "\n\n".join(thoughts),
                    "web_search_mode": web, "thinking_applied": bool(flags["thinking"])}
        # candidate.content is appended unchanged so Gemini 3 thought signatures round-trip.
        contents.append(candidate.content)
        responses = []
        for call in calls:
            arguments = dict(call.args or {})
            tool_started = time.perf_counter()
            result = call_tool(call.name, arguments, state)
            entry = {"name": call.name, "arguments": arguments,
                     "elapsed_ms": round((time.perf_counter() - tool_started) * 1000, 1),
                     "citations": [{"title": r.get("title"), "section": r.get("section"),
                                    "path": r.get("path"), "evidence_class": r.get("evidence_class")}
                                   for r in (result.get("results") or [])
                                   if call.name != "search_web"] if isinstance(result, dict) else [],
                     "result_preview": json.dumps(result, default=str)[:400]}
            if call.name == "search_web" and isinstance(result, dict):
                entry["web_sources"] = [{"title": r.get("title") or r["url"], "uri": r["url"]}
                                        for r in result.get("results") or [] if r.get("url")]
            tool_log.append(entry)
            responses.append(types.Part.from_function_response(name=call.name, response={"result": result}))
        contents.append(types.Content(role="user", parts=responses))
    return {"status": "error", "reason": f"Stopped after {MAX_TOOL_ROUNDS} tool rounds without a final answer.",
            "tool_calls": tool_log, "web_sources": [], "thoughts": "\n\n".join(thoughts)}


def chat(messages: list[dict[str, str]], mission_state: dict[str, Any] | None = None,
         *, enable_search: bool = False, thinking_mode: bool = False) -> dict[str, Any]:
    started = time.perf_counter()
    state = mission_state or {}
    try:
        client = _client()
        types = _types()
    except GeminiUnavailable as exc:
        return {"status": "unavailable", "reason": str(exc), "model": model_name(),
                "note": "The rest of NeuroNexus works without Gemini."}

    contents = [
        types.Content(role=("model" if m.get("role") == "assistant" else "user"),
                      parts=[types.Part(text=str(m.get("content", "")))])
        for m in messages[-MAX_HISTORY_MESSAGES:] if str(m.get("content", "")).strip()
    ]
    if not contents:
        return {"status": "error", "reason": "No message content was supplied."}

    model, resolution = _resolved(client)
    if model is None:
        return {"status": "unavailable", "reason": resolution["notice"], "model": resolution["requested"],
                "available_models": resolution["available"], "fallback_chain_tried": []}

    # Path A (native Google Search) cannot be combined with the console tools, so it is only tried when the
    # question does not need them; otherwise Path B: console tools plus the search_web function.
    question = str(messages[-1].get("content", "")) if messages else ""
    web_start = None
    if enable_search:
        web_start = "tool" if intent.needs_console_tools(question) else "native"

    failures: list[dict[str, Any]] = []
    last_exc: Exception | None = None
    tool_log: list[dict[str, Any]] = []
    attempts = list(resolution["attempt_order"])
    for model in attempts:
        flags = {"thinking": bool(thinking_mode), "web": web_start}  # negotiated per model
        notes: list[str] = []
        while True:
            try:
                result = _converse(client, types, model, contents, state, flags)
            except Exception as exc:
                if _negotiate(exc, flags, model, notes):
                    continue
                last_exc = exc
                if not _should_fail_over(exc):
                    return {**_failure(exc, model), "tool_calls": tool_log, "model_used": model,
                            "fallback_chain_tried": list(failures)}
                mark_model_failed(model, _error_code(exc))
                failures.append({"model": model, "reason": _short_reason(exc), "key_refused": _key_refused(exc)})
                break
            mark_model_ok(model)
            notice = "; ".join(n for n in (_substitution_notice(model, resolution, failures), *notes) if n) or None
            return {**result, "model": model, "model_used": model, "model_notice": notice,
                    "fallback_chain_tried": [{"model": f["model"], "reason": f["reason"]} for f in failures],
                    "feature_notes": notes,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                    "evidence_note": "AI INTERPRETATION of NeuroNexus tool results. Not itself a NASA observation."}
    return {**_exhausted(last_exc, failures, attempts[-1]), "tool_calls": tool_log,
            "fallback_chain_tried": [{"model": f["model"], "reason": f["reason"]} for f in failures]}


def analyse_routes(payload: dict[str, Any]) -> dict[str, Any]:
    """Structured JSON analysis of deterministic candidates (numbers are never altered)."""
    started = time.perf_counter()
    try:
        client = _client()
        types = _types()
    except GeminiUnavailable as exc:
        return {"status": "unavailable", "reason": str(exc), "model": model_name(),
                "note": "Candidate generation, metrics and Pareto flags are deterministic and unaffected."}
    prompt = (
        "Deterministic NeuroNexus route analysis input (JSON):\n"
        + json.dumps(payload, default=str)[:60000]
        + "\n\nReturn the analysis JSON now."
    )
    config = types.GenerateContentConfig(
        system_instruction=ROUTE_ANALYSIS_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=ROUTE_ANALYSIS_SCHEMA,
        temperature=0.15,
    )
    model, resolution = _resolved(client)
    if model is None:
        return {"status": "unavailable", "reason": resolution["notice"], "model": resolution["requested"],
                "available_models": resolution["available"]}
    failures: list[dict[str, Any]] = []
    last_exc: Exception | None = None
    for model in resolution["attempt_order"]:
        try:
            response = client.models.generate_content(model=model, contents=prompt, config=config)
            analysis = json.loads(response.text)
        except json.JSONDecodeError as exc:
            return {"status": "error", "reason": "Gemini returned invalid JSON.", "error": str(exc)[:200], "model": model}
        except Exception as exc:
            last_exc = exc
            if not _should_fail_over(exc):
                return _failure(exc, model)
            mark_model_failed(model, _error_code(exc))
            failures.append({"model": model, "reason": _short_reason(exc), "key_refused": _key_refused(exc)})
            continue
        mark_model_ok(model)
        return {"status": "ok", "model": model, "model_notice": _substitution_notice(model, resolution, failures),
                "analysis": analysis,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                "evidence_note": "AI INTERPRETATION. Numerical values remain those computed by the deterministic engine.",
                "schema": "neuronexus.route-analysis.v1"}
    return _exhausted(last_exc, failures, resolution["requested"])


def service_status() -> dict[str, Any]:
    from science.ai.knowledge_base import KNOWLEDGE

    payload: dict[str, Any] = {**status(), "tools": [d["name"] for d in DECLARATIONS],
                               "knowledge": KNOWLEDGE.stats(),
                               "route_analysis_schema": ROUTE_ANALYSIS_SCHEMA}
    if not payload["configured"]:
        payload["model_check"] = {"status": "NOT CONFIGURED", "detail": "GEMINI_API_KEY is not set on the server."}
        return payload
    try:
        client = _client()
        info = resolve_model(client)
    except Exception as exc:
        payload["model_check"] = {"status": "CHECK FAILED", "detail": str(exc)[:200]}
        return payload
    payload["model"] = info["model"] or info["requested"]
    payload["requested_model"] = info["requested"]
    payload["available_models"] = info["available"]
    listing = (info.get("listing_error") or "").lower()
    key_rejected = any(t in listing for t in ("401", "403", "api key not valid", "unauthenticated", "permission_denied"))
    payload["model_check"] = {
        "status": "KEY REJECTED" if key_rejected else
                  "NO MODEL AVAILABLE" if info["model"] is None else ("SUBSTITUTED" if info["substituted"] else "OK"),
        "detail": info["notice"] or info["listing_error"] or f"Using '{info['model']}'.",
    }
    return payload
