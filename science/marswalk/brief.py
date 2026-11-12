"""EVA brief: JSON (schema neuronexus.eva-brief.v1) and a printable HTML page (T7.9).

Every value carries its ledger id; the printed page lists every source used.
"""
from __future__ import annotations

import html

from science.sources import ledger

SCHEMA = "neuronexus.eva-brief.v1"


def build(plan: dict) -> dict:
    b = plan["budget"]
    s = plan["summary"]

    def val(value, unit, ledger_id, evidence="DERIVED", **extra):
        return {"value": value, "unit": unit, "evidence": evidence, "ledger_id": ledger_id, **extra}
    sources = [{"ledger_id": e["id"], "title": e["product_title"], "organization": e["organization"],
                "evidence_class": e["evidence_class"], "url": e.get("landing_page") or e.get("url"),
                "license": e.get("license")} for e in (ledger.resolve(i) for i in plan["source_ids"]) if e]
    return {
        "schema": SCHEMA, "plan_id": plan["plan_id"], "engine_version": plan["engine_version"],
        "config_hash": plan["config_hash"], "data_versions": plan["data_versions"],
        "status": plan["status"],
        "route": {"points": plan["points"], "geometry": plan["geometry"], "terrain_mode": plan["request"]["terrain_mode"]},
        "values": {
            "length": val(s["length_m"]["value"], "m", "NEURONEXUS_MARSWALK_PLANNER", "COMPUTED"),
            "elevation_gain": val(s["elevation_gain_m"]["value"], "m", "NEURONEXUS_TERRAIN_LADDER"),
            "max_slope_3m": val(s["max_slope_3m_deg"]["value"], "deg", "NEURONEXUS_SLOPE_MULTI_BASELINE"),
            "max_slope_1m": val(s["max_slope_1m_deg"]["value"], "deg", "NEURONEXUS_SLOPE_MULTI_BASELINE"),
            "outbound_time": val(b["outbound_h"], "h", "NEURONEXUS_PACE_MODEL", "MODELED"),
            "return_time": val(b["return_h"], "h", "NEURONEXUS_PACE_MODEL", "MODELED"),
            "walk_back_margin": val(b["margin_h"], "h", "NEURONEXUS_PNR_MODEL", "MODELED"),
            "turnaround_distance": val(plan["turnaround"]["distance_m"], "m", "NEURONEXUS_PNR_MODEL", "MODELED",
                                       reached_target=plan["turnaround"]["reached_target"]),
            "metabolic_energy_round_trip": val(b["metabolic_kcal_est"], "kcal", "NEURONEXUS_METABOLIC_PROXY", "MODELED",
                                               band=b["round_trip"]["metabolic_kcal_est"]),
            "o2_round_trip": val(b["o2_kg_est"], "kg", "NEURONEXUS_METABOLIC_PROXY", "MODELED", band=b["round_trip"]["o2_kg_est"]),
            "cooling_water_round_trip": val(b["water_l_est"], "L", "NEURONEXUS_METABOLIC_PROXY", "MODELED",
                                            band=b["round_trip"]["water_l_est"]),
        },
        "terrain_source_pct": s["length_by_source_pct"],
        "segments": plan["segments"], "science_stops": plan["science_stops"], "dose": plan["dose"],
        "conditions": plan.get("conditions"),
        "warnings": plan["warnings"], "limitations": plan["limitations"],
        "parameters": {k: {"value": p["value"], "unit": p["unit"], "kind": p["kind"], "ledger_id": p["ledger_id"]}
                       for k, p in plan["parameters"].items()},
        "sources": sources,
        "disclaimer": "Screening plan from NASA mission data. Planning limits are not safety limits. Not endorsed by NASA.",
    }


def html_page(brief: dict) -> str:
    e = html.escape
    rows = "".join(f"<tr><td>{e(k.replace('_', ' '))}</td><td>{e(str(v['value']))} {e(v['unit'])}</td>"
                   f"<td>{e(v['evidence'])}</td><td>🏷️ {e(v['ledger_id'])}</td></tr>" for k, v in brief["values"].items())
    segs = "".join(f"<tr><td>{s['from_m']:.0f}-{s['to_m']:.0f} m</td><td>{e(s['class'])}</td><td>{e(s['source'])}</td>"
                   f"<td>{'' if s['max_slope_3m'] is None else s['max_slope_3m']}</td><td>🏷️ {e(str(s['ledger_id']))}</td></tr>"
                   for s in brief["segments"])
    srcs = "".join(f"<li><b>{e(s['ledger_id'])}</b>: {e(s['title'])} ({e(s['organization'])}; {e(s['evidence_class'])})"
                   f"{' · ' + e(s['url']) if s.get('url') else ''}</li>" for s in brief["sources"])
    status = brief["status"]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>EVA brief {e(brief['plan_id'])}</title>
<style>body{{font:13px/1.45 system-ui,sans-serif;margin:24px;color:#111}}table{{border-collapse:collapse;width:100%;margin:8px 0 16px}}
td,th{{border:1px solid #bbb;padding:4px 6px;text-align:left}}h1{{font-size:18px}}h2{{font-size:14px;margin-top:18px}}
.status{{font-weight:700;padding:6px 8px;border:2px solid #111;display:inline-block}}</style></head><body>
<h1>NeuroNexus EVA brief · plan {e(brief['plan_id'])}</h1>
<p class="status">{e(status['value'])}</p><p>{e('; '.join(status['reasons']) or 'No review triggers.')}</p>
<p><small>{e(status['rule_text'])}</small></p>
<h2>Values</h2><table><tr><th>Quantity</th><th>Value</th><th>Evidence</th><th>Source</th></tr>{rows}</table>
<h2>Segments</h2><table><tr><th>Along track</th><th>Class</th><th>Terrain</th><th>Max slope (deg)</th><th>Source</th></tr>{segs}</table>
<h2>Limitations</h2><ul>{''.join(f'<li>{e(x)}</li>' for x in brief['limitations'])}</ul>
<h2>Sources used</h2><ul>{srcs}</ul>
<p><small>{e(brief['disclaimer'])} Engine {e(brief['engine_version'])}, config {e(brief['config_hash'])}.</small></p>
</body></html>"""
