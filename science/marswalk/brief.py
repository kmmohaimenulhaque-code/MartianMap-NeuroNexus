"""EVA brief: JSON (schema neuronexus.eva-brief.v1) and a printable HTML page (T7.9).

Every value carries its ledger id; the printed page lists every source used.
"""
from __future__ import annotations

import html

from science.conditions import rad
from science.sources import ledger

SCHEMA = "neuronexus.eva-brief.v1"
DOSE_RULE = "EVA dose = daily E rate x EVA hours / 24 (altitude term below 1% at EVA scale)"


def dose_screening(plan: dict, rad_window: dict | None = None) -> dict:
    """The same RAD screening the console's CONDITIONS block shows, for this plan's EVA length.

    Attached to the brief, not to the plan, so plan_id stays a function of the request and terrain data only.
    The rate is the archived Curiosity RAD E-detector median at Gale (with its archive lag); no value is
    produced when the archive is missing or too sparse.
    """
    eva_h = plan["budget"]["eva_h"]
    r = rad_window if rad_window is not None else rad.latest_window()
    base = {"rule": DOSE_RULE, "ledger_id": "NEURONEXUS_DOSE_SCREENING", "eva_h": eva_h,
            "input": {"ledger_id": "MSL_RAD_RDR", "measured_at": "Gale crater (Curiosity RAD)",
                      **{k: r.get(k) for k in ("latest_sol", "latest_utc", "lag_days", "window_sols", "unit")}}}
    if r.get("status") != "ARCHIVED" or r.get("rate_E_median") is None:
        return {**base, "status": r.get("status", "UNAVAILABLE"), "reason": r.get("reason", "RAD summary unavailable")}
    scale = eva_h / 24.0
    out = {**base, "status": "SCREENING ESTIMATE", "evidence": "DERIVED", "value": round(r["rate_E_median"] * scale, 1),
           "band": [round(r["iqr"][0] * scale, 1), round(r["iqr"][1] * scale, 1)], "unit": "uGy",
           "note": "Screening estimate from archived RAD rates (not current conditions); no dose limit is applied."}
    if plan.get("request", {}).get("base", {}).get("rover") == "m2020":
        out["note"] += " Measured at Gale, about 3,700 km from Jezero: context only."
    return out


def build(plan: dict, rad_window: dict | None = None) -> dict:
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
        "segments": plan["segments"], "science_stops": plan["science_stops"], "dose": dose_screening(plan, rad_window),
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
                   f"<td>{e(v['evidence'])}</td><td>{e(v['ledger_id'])}</td></tr>" for k, v in brief["values"].items())
    segs = "".join(f"<tr><td>{s['from_m']:.0f}-{s['to_m']:.0f} m</td><td>{e(s['class'])}</td><td>{e(s['source'])}</td>"
                   f"<td>{'' if s['max_slope_3m'] is None else s['max_slope_3m']}</td><td>{e(str(s['ledger_id']))}</td></tr>"
                   for s in brief["segments"])
    srcs = "".join(f"<li><b>{e(s['ledger_id'])}</b>: {e(s['title'])} ({e(s['organization'])}; {e(s['evidence_class'])})"
                   f"{' · ' + e(s['url']) if s.get('url') else ''}</li>" for s in brief["sources"])
    status = brief["status"]
    d = brief["dose"]
    dose = (f"{d['value']} {e(d['unit'])} for {d['eva_h']} h (IQR {d['band'][0]} to {d['band'][1]}) · {e(d['status'])} · "
            f"RAD sol {d['input']['latest_sol']}, archive lag {d['input']['lag_days']} days · {e(d['ledger_id'])}"
            if d.get("value") is not None else f"{e(d['status'])}: {e(str(d.get('reason', '')))}")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>EVA brief {e(brief['plan_id'])}</title>
<style>body{{font:13px/1.45 system-ui,sans-serif;margin:24px;color:#111}}table{{border-collapse:collapse;width:100%;margin:8px 0 16px}}
td,th{{border:1px solid #bbb;padding:4px 6px;text-align:left}}h1{{font-size:18px}}h2{{font-size:14px;margin-top:18px}}
.status{{font-weight:700;padding:6px 8px;border:2px solid #111;display:inline-block}}</style></head><body>
<h1>NeuroNexus EVA brief · plan {e(brief['plan_id'])}</h1>
<p class="status">{e(status['value'])}</p><p>{e('; '.join(status['reasons']) or 'No review triggers.')}</p>
<p><small>{e(status['rule_text'])}</small></p>
<h2>Radiation screening</h2><p>{dose}</p><p><small>{e(d['rule'])}. {e(d.get('note', ''))}</small></p>
<h2>Values</h2><table><tr><th>Quantity</th><th>Value</th><th>Evidence</th><th>Source</th></tr>{rows}</table>
<h2>Segments</h2><table><tr><th>Along track</th><th>Class</th><th>Terrain</th><th>Max slope (deg)</th><th>Source</th></tr>{segs}</table>
<h2>Limitations</h2><ul>{''.join(f'<li>{e(x)}</li>' for x in brief['limitations'])}</ul>
<h2>Sources used</h2><ul>{srcs}</ul>
<p><small>{e(brief['disclaimer'])} Engine {e(brief['engine_version'])}, config {e(brief['config_hash'])}.</small></p>
</body></html>"""
