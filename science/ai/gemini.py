"""Gemini conversation and structured route analysis (server-side only)."""

from __future__ import annotations

import json
import time
from typing import Any

from science.ai.config import api_key, mark_model_failed, mark_model_ok, model_name, resolve_model, status
from science.ai.tools import DECLARATIONS, call_tool

MAX_TOOL_ROUNDS = 8
MAX_HISTORY_MESSAGES = 24

SYSTEM_INSTRUCTION = """You are MARS INTELLIGENCE, the mission assistant of NeuroNexus ·
Interplanetary Survival Guide: Martian Map, built by Team NeuroNexus for the NASA Space Apps
Challenge 2026. You answer three kinds of question expertly:
  1. THIS MISSION · the selected site, routes, terrain, dust, thermal evidence, console state.
  2. MARS · planetary science, missions, history, human exploration, ISRU, Mars time.
  3. THIS APP AND PROJECT · how to use every UI feature, data sources, methods, setup,
     deployment, architecture and the team.

TOOL USE (mandatory):
- Mission questions: call the application tools. Never guess a number a tool can return.
- Mars questions: call search_mars_knowledge first, then add established knowledge if needed.
- UI / how-to questions: call get_ui_guide. Project, setup or team questions: search_project_docs.
- Any named place: lookup_mars_place. Dates, seasons, Ls, conversions: mars_calculator.
- Dust at any sol or place: get_dust_scenario. Terrain statistics: get_terrain_statistics.
- Call several tools when a question spans areas.

EVIDENCE: label claims with their class · PROJECT DATA, NASA OBSERVED, NASA REFERENCE,
MODELED, DERIVED, COMPUTED, SIMULATED, PROJECT DOCS, GENERAL KNOWLEDGE, WEB or UNAVAILABLE.
Cite knowledge-base hits as [title › section]. Quote tool numbers exactly. Never invent values,
citations, observations, telemetry or orbital events; say UNAVAILABLE when evidence is missing.
Knowledge has an as_of date: for current mission status or recent news, say so and suggest
enabling WEB SEARCH (when it is on, prefer it for recent facts and cite the web sources).

SAFETY: never call a route, site or Safe Haven safe and never claim NASA certification · the
terrain risk proxy is a planning aid. Close approaches are not impact predictions. The dust
scenario is a MODELED MY34 reconstruction, not a forecast.

SCOPE: NeuroNexus covers NASA and the NASA Space Apps 2026 partner space agencies (ESA, ISRO,
JAXA, MBRSC/UAE, CSA, ASI, UKSA, CONAE, AEB, KASA, AEE, TUA and others) and SpaceX. Keep
answers within that scope.

STYLE: mission-console brief. Lead with the answer, then tight bullets with numbers and units.
State uncertainties and trade-offs rather than declaring winners. Use Markdown headings,
bullets and tables where they help."""

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


def _should_fail_over(exc: Exception) -> bool:
    """Model-specific problems move on to the next model; key problems do not."""
    code = _error_code(exc)
    lowered = str(exc).lower()
    if code in (401, 403) or "api key not valid" in lowered:
        return False
    return code in (404, 429, 500, 502, 503, 504) or "no longer available" in lowered or "high demand" in lowered or "overloaded" in lowered


def _substitution_notice(model: str, resolution: dict[str, Any], failures: list[dict[str, Any]]) -> str | None:
    if model == resolution["requested"] and not failures:
        return None
    tried = "; ".join(f"{f['model']}: {f['reason']}" for f in failures)
    base = f"Configured model '{resolution['requested']}' was not used; answered with '{model}'."
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


def chat(messages: list[dict[str, str]], mission_state: dict[str, Any] | None = None,
         *, enable_search: bool = False) -> dict[str, Any]:
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

    def make_config(with_search: bool):
        tools = [types.Tool(function_declarations=[types.FunctionDeclaration(**d) for d in DECLARATIONS])]
        if with_search:
            tools.append(types.Tool(google_search=types.GoogleSearch()))
        return types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            tools=tools,
            temperature=0.2,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )

    config = make_config(enable_search)
    search_notice: str | None = None

    model, resolution = _resolved(client)
    if model is None:
        return {"status": "unavailable", "reason": resolution["notice"], "model": resolution["requested"],
                "available_models": resolution["available"]}

    base_contents = list(contents)
    failures: list[dict[str, Any]] = []
    last_exc: Exception | None = None
    tool_log: list[dict[str, Any]] = []
    attempts = list(resolution["attempt_order"])
    index = 0
    while index < len(attempts):
        model = attempts[index]
        contents = list(base_contents)
        tool_log = []
        try:
            for _ in range(MAX_TOOL_ROUNDS):
                response = client.models.generate_content(model=model, contents=contents, config=config)
                candidate = (response.candidates or [None])[0]
                parts = list(getattr(getattr(candidate, "content", None), "parts", None) or [])
                calls = [p.function_call for p in parts if getattr(p, "function_call", None)]
                if not calls:
                    mark_model_ok(model)
                    text = (response.text or "").strip()
                    grounding = getattr(candidate, "grounding_metadata", None)
                    return {
                        "status": "ok", "model": model,
                        "model_notice": search_notice or _substitution_notice(model, resolution, failures),
                        "text": text or "(no content returned)",
                        "tool_calls": tool_log,
                        "sources": _sources(tool_log),
                        "search_grounding": [
                            {"title": getattr(getattr(c, "web", None), "title", None),
                             "uri": getattr(getattr(c, "web", None), "uri", None)}
                            for c in (getattr(grounding, "grounding_chunks", None) or [])
                        ] if grounding else [],
                        "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                        "evidence_note": "AI INTERPRETATION of NeuroNexus tool results. Not itself a NASA observation.",
                    }
                # candidate.content is appended unchanged so Gemini 3 thought signatures round-trip.
                contents.append(candidate.content)
                responses = []
                for call in calls:
                    arguments = dict(call.args or {})
                    tool_started = time.perf_counter()
                    result = call_tool(call.name, arguments, state)
                    tool_log.append({"name": call.name, "arguments": arguments,
                                     "elapsed_ms": round((time.perf_counter() - tool_started) * 1000, 1),
                                     "citations": [{"title": r.get("title"), "section": r.get("section"),
                                                    "path": r.get("path"), "evidence_class": r.get("evidence_class")}
                                                   for r in (result.get("results") or [])] if isinstance(result, dict) else [],
                                     "result_preview": json.dumps(result, default=str)[:400]})
                    responses.append(types.Part.from_function_response(name=call.name, response={"result": result}))
                contents.append(types.Content(role="user", parts=responses))
            mark_model_ok(model)
            return {"status": "error", "reason": f"Stopped after {MAX_TOOL_ROUNDS} tool rounds without a final answer.",
                    "tool_calls": tool_log, "model": model}
        except Exception as exc:
            last_exc = exc
            if enable_search and search_notice is None and _error_code(exc) == 400:
                # Some models reject Google Search combined with function tools: keep the tools.
                config = make_config(False)
                search_notice = f"Web search is not available together with application tools on '{model}'; answered without it."
                continue
            if not _should_fail_over(exc):
                return {**_failure(exc, model), "tool_calls": tool_log}
            mark_model_failed(model, _error_code(exc))
            failures.append({"model": model, "reason": _short_reason(exc)})
            index += 1
    failure = _failure(last_exc, resolution["attempt_order"][-1]) if last_exc else {"status": "unavailable", "reason": "No model could be tried."}
    tried = ", ".join(f"{f['model']} ({f['reason']})" for f in failures)
    failure["reason"] = f"No Gemini model answered. Tried: {tried}. Try again shortly or set GEMINI_MODEL."
    return {**failure, "tool_calls": tool_log, "models_tried": failures}


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
    for model in resolution["attempt_order"]:
        try:
            response = client.models.generate_content(model=model, contents=prompt, config=config)
            analysis = json.loads(response.text)
        except json.JSONDecodeError as exc:
            return {"status": "error", "reason": "Gemini returned invalid JSON.", "error": str(exc)[:200], "model": model}
        except Exception as exc:
            if not _should_fail_over(exc):
                return _failure(exc, model)
            mark_model_failed(model, _error_code(exc))
            failures.append({"model": model, "reason": _short_reason(exc)})
            continue
        mark_model_ok(model)
        return {"status": "ok", "model": model, "model_notice": _substitution_notice(model, resolution, failures),
                "analysis": analysis,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                "evidence_note": "AI INTERPRETATION. Numerical values remain those computed by the deterministic engine.",
                "schema": "neuronexus.route-analysis.v1"}
    tried = ", ".join(f"{f['model']} ({f['reason']})" for f in failures)
    return {"status": "unavailable", "reason": f"No Gemini model answered. Tried: {tried}. Try again shortly or set GEMINI_MODEL.",
            "models_tried": failures, "model": resolution["requested"]}


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
