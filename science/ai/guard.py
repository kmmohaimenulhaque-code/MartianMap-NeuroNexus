"""Answer guards for MARS INTELLIGENCE: the router checks every fallback-provider answer with them
before it is shown (science/ai/router.py). Pure standard library."""

from __future__ import annotations

import re

STATUS_TERMS = ("WITHIN PLANNING LIMITS", "REVIEW REQUIRED", "EXCEEDS PLANNING LIMIT")
# Upper-case status-like phrases that are not allowed (the console uses only the three above).
FORBIDDEN_STATUS = ("SAFE", "UNSAFE", "GO FOR EVA", "NO-GO", "CLEARED", "DANGEROUS")
BRITISH = ("metre", "metres", "colour", "analyse", "analysed", "behaviour", "favour", "centre",
           "kilometre", "kilometres", "modelled", "modelling", "programme", "licence")
MISSING_MARKERS = ("n/a", "unavailable", "not available", "not reported", "no value", "missing")

_NUM = re.compile(r"(?<![A-Za-z_])[-+]?\d[\d,]*(?:\.\d+)?")
_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF]")


def numbers(text: str) -> list[float]:
    out = []
    for m in _NUM.finditer(text or ""):
        raw = m.group(0).replace(",", "")
        try:
            out.append(float(raw))
        except ValueError:
            pass
    return out


def ungrounded_numbers(answer: str, evidence: str) -> list[float]:
    """Numbers in the answer that do not appear in the evidence (context + question).

    Tolerant to formatting only (7.0 == 7, 1,200 == 1200, sign); not to rounding.
    Small counting words like list indices are numbers too, so the evidence must hold them.
    """
    have = {abs(round(n, 6)) for n in numbers(evidence)}
    return [n for n in numbers(answer) if abs(round(n, 6)) not in have]


_NEGATION = re.compile(r"\b(not|never|no|nothing|cannot|can't|won't|doesn't|isn't|whether|neither|nor)\b", re.I)


def calls_safe(answer: str) -> bool:
    """True when the answer labels something safe. A refusal is fine: "cannot say whether it is safe", "does not
    certify any route as safe". "Safe Haven" is a console feature name, not a verdict.
    shortcut: a negation earlier in the sentence clears it, so "not only is it safe" slips through; rare in replies."""
    for m in re.finditer(r"\bsafe\b(?!\s+havens?\b)", answer, re.I):
        sentence_start = max(answer.rfind(c, 0, m.start()) for c in ".!?\n") + 1
        if not _NEGATION.search(answer[sentence_start:m.start()]):
            return True
    return False


def check(answer: str, evidence: str, *, expects_missing: bool = False) -> dict:
    """Return {ok, violations:[...]} for one answer."""
    v = []
    bad = ungrounded_numbers(answer, evidence)
    if bad:
        v.append(f"ungrounded_number:{bad[:3]}")
    if calls_safe(answer) or any(re.search(rf"\b{re.escape(t)}\b", answer) for t in FORBIDDEN_STATUS):
        v.append("banned_safety_term")
    if "—" in answer:
        v.append("em_dash")
    if _EMOJI.search(answer):
        v.append("emoji")
    if any(re.search(rf"\b{w}\b", answer, re.I) for w in BRITISH):
        v.append("british_spelling")
    for m in re.finditer(r"\b(?:WITHIN|EXCEEDS|REVIEW)\b[A-Z ]*", answer):
        if not any(m.group(0).strip().startswith(t) for t in STATUS_TERMS):
            v.append(f"bad_status:{m.group(0).strip()}")
    if expects_missing and not any(k in answer.lower() for k in MISSING_MARKERS):
        v.append("missing_not_flagged")
    if len(answer) > 1600:
        v.append("too_long")
    return {"ok": not v, "violations": v}
