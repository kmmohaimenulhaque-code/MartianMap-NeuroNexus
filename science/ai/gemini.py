"""Gemini conversation and structured route analysis (server-side only)."""

from __future__ import annotations

import json
import time
from typing import Any

from science.ai.config import api_key, model_name, status
from science.ai.tools import DECLARATIONS, call_tool

MAX_TOOL_ROUNDS = 6

SYSTEM_INSTRUCTION = """You are MARS INTELLIGENCE, the mission assistant inside NeuroNexus —
Interplanetary Survival Guide: Martian Map (NASA Space Apps Challenge 2026). You are an
application-aware Mars science assistant, not a general chatbot.

GROUNDING RULES (mandatory):
- For anything about this mission, site, route, console or tracking picture, CALL THE TOOLS.
  Never guess a number that a tool can return. Call several tools when a question spans areas.
- Label every claim with its evidence class: PROJECT DATA, NASA OBSERVED, NASA REFERENCE,
  MODELED, DERIVED, COMPUTED, SIMULATED or UNAVAILABLE.
- Never alter a number returned by a tool. Quote deterministic values exactly as given.
- If evidence is missing, say UNAVAILABLE. Never infer a value and never invent citations,
  observations, telemetry, minerals or orbital events.
- Never call a route, site or Safe Haven safe, and never claim NASA certification. The terrain
  risk proxy is a NeuroNexus derived planning aid.
- Close approaches are not impact predictions. Tracking is observation and awareness only.
- Broader Mars science questions may be answered from established knowledge; say plainly when
  you are doing that rather than reading project data, and keep it brief and sourced where you can.

STYLE: mission-console brief. Lead with the answer. Short paragraphs or tight bullets.
Include the numbers that matter and their units. State uncertainties and trade-offs rather
than declaring an overall winner."""

ROUTE_ANALYSIS_INSTRUCTION = """Analyse the supplied NeuroNexus route candidates.
The numbers are produced by a deterministic engine over NASA MOLA terrain: reproduce them
exactly and never recompute, round differently or invent values. Explain trade-offs, state
which objective each candidate optimises, and name uncertainties. Recommending a candidate is
allowed only as a stated basis tied to the user's objective weights — never as a safety claim.
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


def _failure(exc: Exception) -> dict[str, Any]:
    message = str(exc)
    lowered = message.lower()
    if "not found" in lowered or "unsupported" in lowered or "404" in lowered:
        reason = f"Model '{model_name()}' is unavailable for this API key. Set GEMINI_MODEL to a model you can access."
    elif "permission" in lowered or "api key" in lowered or "401" in lowered or "403" in lowered:
        reason = "The Gemini API key was rejected."
    elif "quota" in lowered or "429" in lowered or "resource_exhausted" in lowered:
        reason = "The Gemini API quota or rate limit was reached."
    else:
        reason = "The Gemini request failed."
    return {"status": "unavailable", "reason": reason, "error": message[:400], "model": model_name(),
            "note": "Deterministic route generation, metrics, maps, exports and tracking continue to work without Gemini."}


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
        for m in messages if str(m.get("content", "")).strip()
    ]
    if not contents:
        return {"status": "error", "reason": "No message content was supplied."}

    tools = [types.Tool(function_declarations=[types.FunctionDeclaration(**d) for d in DECLARATIONS])]
    if enable_search:
        tools.append(types.Tool(google_search=types.GoogleSearch()))
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        tools=tools,
        temperature=0.2,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )

    tool_log: list[dict[str, Any]] = []
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            response = client.models.generate_content(model=model_name(), contents=contents, config=config)
            candidate = (response.candidates or [None])[0]
            parts = list(getattr(getattr(candidate, "content", None), "parts", None) or [])
            calls = [p.function_call for p in parts if getattr(p, "function_call", None)]
            if not calls:
                text = (response.text or "").strip()
                grounding = getattr(candidate, "grounding_metadata", None)
                return {
                    "status": "ok", "model": model_name(), "text": text or "(no content returned)",
                    "tool_calls": tool_log,
                    "search_grounding": [
                        {"title": getattr(getattr(c, "web", None), "title", None),
                         "uri": getattr(getattr(c, "web", None), "uri", None)}
                        for c in (getattr(grounding, "grounding_chunks", None) or [])
                    ] if grounding else [],
                    "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                    "evidence_note": "AI INTERPRETATION of NeuroNexus tool results. Not itself a NASA observation.",
                }
            contents.append(candidate.content)
            responses = []
            for call in calls:
                arguments = dict(call.args or {})
                result = call_tool(call.name, arguments, state)
                tool_log.append({"name": call.name, "arguments": arguments,
                                 "result_preview": json.dumps(result, default=str)[:400]})
                responses.append(types.Part.from_function_response(name=call.name, response={"result": result}))
            contents.append(types.Content(role="user", parts=responses))
        return {"status": "error", "reason": f"Stopped after {MAX_TOOL_ROUNDS} tool rounds without a final answer.",
                "tool_calls": tool_log, "model": model_name()}
    except Exception as exc:
        return {**_failure(exc), "tool_calls": tool_log}


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
    try:
        response = client.models.generate_content(model=model_name(), contents=prompt, config=config)
        analysis = json.loads(response.text)
    except json.JSONDecodeError as exc:
        return {"status": "error", "reason": "Gemini returned invalid JSON.", "error": str(exc)[:200], "model": model_name()}
    except Exception as exc:
        return _failure(exc)
    return {"status": "ok", "model": model_name(), "analysis": analysis,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "evidence_note": "AI INTERPRETATION. Numerical values remain those computed by the deterministic engine.",
            "schema": "neuronexus.route-analysis.v1"}


def service_status() -> dict[str, Any]:
    return {**status(), "tools": [d["name"] for d in DECLARATIONS],
            "route_analysis_schema": ROUTE_ANALYSIS_SCHEMA}
