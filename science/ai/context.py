"""CONTEXT blocks for the fine-tuned Qwen voice model.

The model was trained (training/build_sft_dataset.py) on prompts of the form
    CONTEXT:\n# title\nlabel: value unit [LEDGER_TAG]\n...\n\nQUESTION: ...
This module renders the deterministic tool results into that same shape, so every number the
model sees carries the ledger tag it must cite. Missing values render as n/a.
"""

from __future__ import annotations

from typing import Any

from science.ai.tools import call_tool

MAX_LINES = 70
MAX_TEXT = 900

# Which ledger tag a value carries, chosen from the first matching key on its path.
PATH_TAGS = (
    ("thermal", "THEMIS"), ("brightness_temperature", "THEMIS"), ("dust", "NASA_AMES_MGCM"),
    ("solar", "NEURONEXUS_SOLAR_GEOMETRY"), ("elevation", "MOLA_MEGDR"), ("slope", "MOLA_MEGDR"),
    ("roughness", "MOLA_MEGDR"), ("terrain", "MOLA_MEGDR"), ("route", "NEURONEXUS_MARSWALK_PLANNER"),
    ("metrics", "NEURONEXUS_MARSWALK_PLANNER"), ("feature", "USGS_IAU_GAZETTEER"),
)
TOOL_TAGS = {
    "get_selected_location": "NN_SOURCE_PROVENANCE", "get_selected_feature": "USGS_IAU_GAZETTEER",
    "get_environment": "NN_SOURCE_PROVENANCE", "get_terrain_analysis": "MOLA_MEGDR",
    "get_route_plan": "NEURONEXUS_MARSWALK_PLANNER", "get_route_candidates": "NN_ROUTE_ENGINE",
    "get_saved_routes": "NN_ROUTE_ENGINE", "get_Mars_weather_context": "NASA_AMES_MGCM",
    "get_USGS_features": "USGS_IAU_GAZETTEER",
}
# Same notes the training contexts carry (training/build_sft_dataset.py), so the model's habits stay grounded.
LADDER = ("note: terrain ladder [NEURONEXUS_TERRAIN_LADDER]: HiRISE DTM 1 m, CTX DTM 20 m, MOLA 128 ppd about 463 m "
          "per pixel; routes on anything coarser than 1 m are REVIEW REQUIRED")
TERRAIN_TOOLS = {"get_selected_location", "get_terrain_analysis", "get_environment", "get_route_plan"}
SKIP_KEYS = {"citation_rule", "usgs_feature_url", "source_url", "url", "sources", "score", "path", "kind",
             # trivia and duplicates that slow a CPU model without changing an answer
             "clean_name", "approval_date", "naming_origin", "feature_code", "min_longitude_deg", "max_longitude_deg",
             "min_latitude_deg", "max_latitude_deg", "namesake_ethnicity", "namesake_continent", "quadrangle_code",
             "sample_grid", "method", "dataset", "location", "mode", "selected_feature", "query", "gazetteer"}
MAX_LINES_PER_TOOL = 16


def _tag(path: list[str], default: str) -> str:
    joined = ".".join(path).lower()
    for key, tag in PATH_TAGS:
        if key in joined:
            return tag
    return default


def _fmt(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.4g}" if abs(value) < 1e4 else f"{value:.0f}"
    return str(value)


def _flatten(value: Any, path: list[str], default: str, out: list[str]) -> None:
    if len(out) >= MAX_LINES:
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if k not in SKIP_KEYS:
                _flatten(v, path + [str(k)], default, out)
    elif isinstance(value, list):
        if value and all(not isinstance(v, (dict, list)) for v in value):
            out.append(f"{' '.join(path).replace('_', ' ')}: {', '.join(_fmt(v) for v in value[:8])} [{_tag(path, default)}]")
        else:
            for i, v in enumerate(value[:5]):
                _flatten(v, path + [str(i + 1)], default, out)
    else:
        label = " ".join(p for p in path if p).replace("_", " ")
        shown = "n/a" if value in (None, "", "UNAVAILABLE") else _fmt(value)
        out.append(f"{label}: {shown} [{_tag(path, default)}]")


def _knowledge_lines(result: dict[str, Any]) -> list[str]:
    lines = []
    for hit in (result.get("results") or [])[:3]:
        source = (hit.get("path") or "knowledge").rsplit("/", 1)[-1]
        lines.append(f"# {hit.get('title')} / {hit.get('section')}")
        lines.append(f"excerpt: {str(hit.get('text') or '')[:MAX_TEXT]} [KNOWLEDGE:{source}]")
    return lines or ["excerpt: n/a (nothing relevant in the knowledge base) [KNOWLEDGE]"]


def dose_lines(state: dict[str, Any]) -> list[str]:
    """Archived Curiosity RAD screening, the same rule as the EVA brief (science/marswalk/brief.py)."""
    from science.conditions import rad

    w = rad.latest_window()
    lines = ["# RAD dose screening (archived Curiosity RAD at Gale crater)"]
    if w.get("status") != "ARCHIVED" or w.get("rate_E_median") is None:
        return lines + [f"RAD dose rate: n/a ({w.get('reason') or w.get('status')}) [MSL_RAD_RDR]"]
    hourly, lo, hi = w["rate_E_median"] / 24, w["iqr"][0] / 24, w["iqr"][1] / 24
    lines += [f"RAD latest archived sol: {w['latest_sol']} [MSL_RAD_RDR]",
              f"RAD archive lag: {w['lag_days']} days [MSL_RAD_RDR]",
              f"RAD E-detector median dose rate: {hourly:.2f} uGy/h [MSL_RAD_RDR]",
              f"RAD E-detector interquartile range: {lo:.2f} to {hi:.2f} uGy/h [MSL_RAD_RDR]",
              "RAD measured at: Gale crater (Curiosity) [MSL_RAD_RDR]"]
    eva = (state.get("marswalk") or {}).get("eva_duration_h")
    for h in ([eva] if eva else [4, 8]):
        lines += [f"EVA dose screening estimate, {h:g} h: {hourly * h:.1f} uGy [NEURONEXUS_DOSE_SCREENING]",
                  f"EVA dose screening band, {h:g} h: {lo * h:.1f} to {hi * h:.1f} uGy [NEURONEXUS_DOSE_SCREENING]"]
    lines.append("note: dose rule: EVA dose = RAD median rate x EVA hours. Archived Gale data, not current conditions. "
                 "No dose limit is applied.")
    return lines


def build(state: dict[str, Any], tools: list[tuple[str, dict[str, Any]]]) -> tuple[str, list[dict[str, Any]]]:
    """Run the given tools and render one CONTEXT block. Returns (context_text, tool_log)."""
    import json
    import time

    lines: list[str] = []
    log: list[dict[str, Any]] = []
    for name, args in tools:
        started = time.perf_counter()
        if name == "dose_screening":
            block = dose_lines(state)
            result: Any = {"lines": len(block)}
        else:
            result = call_tool(name, args, state)
            if name in ("search_mars_knowledge", "search_project_docs", "get_ui_guide"):
                block = _knowledge_lines(result if isinstance(result, dict) else {})
            else:
                block = [f"# {name.replace('get_', '').replace('_', ' ')}"]
                _flatten(result, [], TOOL_TAGS.get(name, "NN_SOURCE_PROVENANCE"), block)
                block = block[: MAX_LINES_PER_TOOL + 1]
        lines += block
        log.append({"name": name, "arguments": args, "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                    "citations": [{"title": r.get("title"), "section": r.get("section"), "path": r.get("path"),
                                   "evidence_class": r.get("evidence_class")}
                                  for r in (result.get("results") or [])] if isinstance(result, dict) else [],
                    "result_preview": json.dumps(result, default=str)[:400]})
    names = {name for name, _ in tools}
    if names & TERRAIN_TOOLS:
        lines.append(LADDER)
    if names & {"get_route_plan", "get_route_candidates"}:
        from science.marswalk.config import PARAMETERS, status_rule_text, values
        lines.append("note: " + status_rule_text(values(PARAMETERS)))
    return "\n".join(lines[: MAX_LINES * 2]), log
