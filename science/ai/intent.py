"""Which questions need the console's own tools (and so cannot use native Google Search grounding)."""

from __future__ import annotations

import re

PATTERNS: list[tuple[str, str]] = [
    ("dose", r"\b(dose|radiation|rad\b|sievert|gray|ugy|msv|gcr|solar particle)"),
    ("terrain", r"\b(slope|terrain|rough|steep|elevation|altitude|mola|flat)"),
    ("environment", r"\b(thermal|themis|temperature|cold|warm|heat|environment|condition)"),
    ("weather", r"\b(dust|weather|storm|opacity|wind|sky|season)"),
    ("route", r"\b(route|path|waypoint|traverse|walk|eva|marswalk|reach)"),
    ("site", r"\b(site|here|this (place|spot|location|feature)|where am i|selected|brief me|overview)"),
]
APP_HELP = re.compile(r"\b(how do i|how to|where is|what does .* do|button|shortcut|panel|menu|ui|click|toggle)\b", re.I)


def needs_console_tools(question: str) -> bool:
    """True when answering needs the console's own tools (site, terrain, dust, route, dose, UI guide), so
    native Google Search grounding, which cannot be combined with function tools, is not the right path."""
    q = question.strip()
    return bool(APP_HELP.search(q) or any(re.search(pattern, q, re.I) for _, pattern in PATTERNS))
