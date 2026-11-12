"""Rule-based intent classifier for the AI router.

Transparent on purpose: every routing decision names the rule that fired, so the UI and tests
can show why a question went to the fine-tuned Qwen voice model or to Gemini tool calling.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Tool families: the deterministic tools the router runs before handing CONTEXT to Qwen.
FAMILIES: dict[str, list[tuple[str, dict]]] = {
    "site": [("get_selected_location", {}), ("get_selected_feature", {})],
    "terrain": [("get_terrain_analysis", {})],
    "environment": [("get_environment", {})],
    "weather": [("get_Mars_weather_context", {})],
    "dose": [("dose_screening", {})],
    "route": [("get_route_plan", {}), ("get_route_candidates", {})],
}

PATTERNS: list[tuple[str, str]] = [
    ("dose", r"\b(dose|radiation|rad\b|sievert|gray|ugy|msv|gcr|solar particle)"),
    ("terrain", r"\b(slope|terrain|rough|steep|elevation|altitude|mola|flat)"),
    ("environment", r"\b(thermal|themis|temperature|cold|warm|heat|environment|condition)"),
    ("weather", r"\b(dust|weather|storm|opacity|wind|sky|season)"),
    ("route", r"\b(route|path|waypoint|traverse|walk|eva|marswalk|reach)"),
    ("site", r"\b(site|here|this (place|spot|location|feature)|where am i|selected|brief me|overview)"),
]
APP_HELP = re.compile(r"\b(how do i|how to|where is|what does .* do|button|shortcut|panel|menu|ui|click|toggle)\b", re.I)
MARS_KNOWLEDGE = re.compile(r"\b(what is|what are|why|explain|tell me about|history|mission|olympus|valles|"
                            r"phobos|deimos|atmosphere|water|ice|geolog|ls\b|solar longitude)\b", re.I)
MULTI_STEP = re.compile(r"\b(compare|versus|vs\.?|rank|plan (a|the|me)|design|optimi[sz]e|which (route|of)|"
                        r"and then|step by step|find (me )?(a|the)|look up|nearest|search)\b", re.I)
SAFETY = re.compile(r"\b(safe|unsafe|danger(ous)?|hazard(ous)?|risky?|go or no.?go|should (we|i) go)\b", re.I)
# Broad overviews need several knowledge sections; Gemini's multi-round search answers them better.
BROAD = re.compile(r"\b(history|missions\b|overview|everything|in general|all about|timeline|summar(y|ize))", re.I)
SEARCH = re.compile(r"\b(latest|news|today|this week|recent(ly)?|current (mission )?status|right now)\b", re.I)


@dataclass
class Intent:
    route: str                      # "qwen" or "gemini"
    reason: str
    families: list[str] = field(default_factory=list)
    tools: list[tuple[str, dict]] = field(default_factory=list)


def classify(question: str, *, enable_search: bool = False) -> Intent:
    q = question.strip()
    if enable_search or SEARCH.search(q):
        return Intent("gemini", "web search or recent events")
    if SAFETY.search(q) and not MULTI_STEP.search(q):
        # The fine-tuned model was trained to decline safety verdicts and give planning status and dose instead.
        families = ["site", "terrain", "dose"]
        return Intent("qwen", "safety question: planning status, not a verdict", families,
                      [t for f in families for t in FAMILIES[f]])
    families = [name for name, pattern in PATTERNS if re.search(pattern, q, re.I)]
    if MULTI_STEP.search(q) or len(families) >= 3:
        return Intent("gemini", "multi-step: tool calling", families)
    if APP_HELP.search(q) and not families:
        return Intent("qwen", "app help from the UI guide", ["app_help"], [("get_ui_guide", {"topic": q[:200]})])
    if families:
        tools = [t for f in families for t in FAMILIES[f]]
        return Intent("qwen", "explain from mission data: " + ", ".join(families), families, tools)
    if BROAD.search(q):
        return Intent("gemini", "broad question: multi-source knowledge search")
    if MARS_KNOWLEDGE.search(q):
        return Intent("qwen", "Mars knowledge base", ["knowledge"], [("search_mars_knowledge", {"query": q[:300]})])
    # Unclear: Gemini picks its own tools; Qwen remains the fallback with the site overview.
    return Intent("gemini", "general question: Gemini chooses the tools", ["site", "environment"],
                  FAMILIES["site"] + FAMILIES["environment"])


def needs_console_tools(question: str) -> bool:
    """True when answering needs the console's own tools (site, terrain, dust, route, dose, UI guide), so
    native Google Search grounding, which cannot be combined with function tools, is not the right path."""
    q = question.strip()
    return bool(APP_HELP.search(q) or any(re.search(pattern, q, re.I) for _, pattern in PATTERNS))
