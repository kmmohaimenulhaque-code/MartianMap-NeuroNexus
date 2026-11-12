"""Build the MARS INTELLIGENCE SFT dataset (about 3,000 chat examples) from real repo data.

Every fact in a CONTEXT block comes from a file in this repository (NASA/USGS data and the
source ledger). Answers are written by deterministic templates from those facts, so every
number in an answer is copied from its CONTEXT and carries a ledger tag. The fine-tune learns
voice and discipline (lead with the answer, cite tags, say n/a, never call anything safe);
facts always come from the context at inference time.

The only non-archive inputs are planner-output scenarios (meta.scenario = "planner_output"),
which stand in for what the route planner hands the assistant at runtime so the model learns to
apply the three planning statuses. They are labeled in each row's meta and in the dataset card.

Usage:  python training/build_sft_dataset.py            -> training/data/{train,eval}.jsonl
"""

from __future__ import annotations

import json
import math
import random
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "training"))

from filters import check  # noqa: E402
from science.marswalk.config import PARAMETERS, status_rule_text, values  # noqa: E402

OUT = ROOT / "training" / "data"
SEED = 2026
TARGET = {"site_overview": 420, "terrain": 330, "dose": 430, "weather": 400, "reach": 300,
          "planner_status": 300, "missing": 220, "adversarial": 240, "provenance": 220,
          "app_help": 225, "mars_knowledge": 160, "followup": 150}

SYSTEM = (
    "You are MARS INTELLIGENCE, the mission assistant of NeuroNexus Martian Map (NASA Space Apps 2026). "
    "Answer like a flight controller: lead with the answer, keep it short and plain. Use only facts in "
    "CONTEXT. Copy every number exactly as CONTEXT gives it and cite its tag in brackets, like [MSL_RAD_RDR]. "
    "If CONTEXT lacks a value, say n/a and name what is missing; never estimate it. Planning statuses are "
    "only WITHIN PLANNING LIMITS, REVIEW REQUIRED or EXCEEDS PLANNING LIMIT, and planning limits are not "
    "safety limits: never call anything safe. American spelling, no emoji, no em dashes."
)

rng = random.Random(SEED)
P = values(PARAMETERS)


# ----------------------------------------------------------------------------- data loading

def load_json(rel):
    return json.loads((ROOT / rel).read_text())


def read_dbf(path: Path) -> list[dict]:
    raw = path.read_bytes()
    n, header_len, rec_len = struct.unpack("<IHH", raw[4:12])
    fields, pos = [], 32
    while raw[pos] != 0x0D:
        d = raw[pos:pos + 32]
        fields.append((d[:11].split(b"\0")[0].decode(), chr(d[11]), d[16]))
        pos += 32
    rows = []
    for i in range(n):
        rec = raw[header_len + i * rec_len: header_len + (i + 1) * rec_len]
        if rec[:1] == b"*":
            continue
        off, row = 1, {}
        for name, kind, size in fields:
            val = rec[off:off + size].decode("utf-8", "replace").strip()
            off += size
            if kind == "N":
                try:
                    val = float(val)
                except ValueError:
                    val = None
            row[name] = val
        rows.append(row)
    return rows


def ledger():
    return {e["id"]: e for e in load_json("data/manifests/source_ledger.json")["entries"]}


LEDGER = ledger()
SITES = load_json("data/manifests/mars_landing_sites.json")["sites"]
SITE_TERRAIN = {s["site_id"]: s for s in load_json("data/manifests/landing_site_contexts.json")["sites"]}
GAZ = [g for g in read_dbf(ROOT / "data/raw/gazetteer/mars/center_pts/MARS_nomenclature_center_pts.dbf")
       if g.get("center_lat") is not None and g.get("center_lon") is not None]
RAD = sorted(load_json("data/snapshots/rad/rad_sol_summaries.json")["sols"].values(), key=lambda r: r["sol"])
MSL_WX = load_json("data/snapshots/weather/msl_weather_2026-10-20.json")["sols"]
M20_WX = load_json("data/snapshots/weather/mars2020_weather_2026-10-20.json")["sols"]
THEMIS = load_json("data/indexes/themis/themis_thermal_observations.json")
COMMANDS = [c for c in load_json("frontend/src/features/commands.json")["commands"] if c.get("description")]
CATEGORIES = {c["id"]: c["label"] for c in load_json("frontend/src/features/commands.json")["categories"]}


def knowledge_sections():
    out = []
    for path in sorted((ROOT / "science/ai/knowledge").glob("*.md")):
        text = re.sub(r"^---.*?---\s*", "", path.read_text(), flags=re.S)
        for block in re.split(r"\n(?=## )", text):
            if not block.startswith("## "):
                continue
            head, _, body = block.partition("\n")
            body = re.sub(r"(^|\n)\s*[-*]\s+", r"\1", body)
            body = re.sub(r"\s+", " ", body).strip()
            if len(body) > 120:
                out.append({"file": path.name, "heading": head[3:].strip(), "body": body})
    return out


KNOWLEDGE = knowledge_sections()


# ----------------------------------------------------------------------------- formatting helpers

def f(x, nd=1):
    if x is None:
        return None
    s = f"{x:.{nd}f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def lon_e(lon):
    return f"{lon % 360:.2f}"


def gc_km(lat1, lon1, lat2, lon2, r_km=3389.5):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r_km * math.asin(min(1.0, math.sqrt(a)))


class Ctx:
    """A CONTEXT block: ordered lines 'label: value [TAG]'."""

    def __init__(self, title):
        self.lines = [f"# {title}"]

    def add(self, label, value, tag, unit=""):
        if value is None:
            self.lines.append(f"{label}: n/a [{tag}]")
        else:
            self.lines.append(f"{label}: {value}{(' ' + unit) if unit else ''} [{tag}]")
        return self

    def note(self, text):
        self.lines.append(f"note: {text}")
        return self

    def text(self):
        return "\n".join(self.lines)


def pick(options):
    return rng.choice(options)


def row(intent, ctx: Ctx | None, turns: list[tuple[str, str]], group, *, expects_missing=False, scenario="archive"):
    """turns: [(user, assistant), ...]; CONTEXT goes in the first user turn."""
    msgs = [{"role": "system", "content": SYSTEM}]
    for i, (u, a) in enumerate(turns):
        content = f"CONTEXT:\n{ctx.text()}\n\nQUESTION: {u}" if (i == 0 and ctx) else u
        msgs += [{"role": "user", "content": content}, {"role": "assistant", "content": a}]
    return {"messages": msgs, "meta": {"intent": intent, "group": group, "scenario": scenario,
                                       "expects_missing": expects_missing}}


# ----------------------------------------------------------------------------- shared context pieces

LADDER = ("terrain ladder [NEURONEXUS_TERRAIN_LADDER]: HiRISE DTM 1 m, CTX DTM 20 m, MOLA 128 ppd about 463 m "
          "per pixel; routes on anything coarser than 1 m are REVIEW REQUIRED")
BRITISH_FIX = {"metres": "meters", "metre": "meter", "kilometres": "kilometers", "kilometre": "kilometer",
               "colour": "color", "analyse": "analyze", "analysed": "analyzed", "behaviour": "behavior",
               "favour": "favor", "centre": "center", "modelled": "modeled", "modelling": "modeling",
               "programme": "program", "licence": "license"}


def americanize(text):
    text = text.replace("\u2014", ", ").replace(" ,", ",")
    for gb, us in BRITISH_FIX.items():
        text = re.sub(rf"\b{gb}\b", us, text)
        text = re.sub(rf"\b{gb.capitalize()}\b", us.capitalize(), text)
    return text


def site_base(site):
    t = SITE_TERRAIN.get(site["site_id"], {}).get("terrain")
    c = Ctx(f"Selected site: {site['label']} ({site['region']})")
    c.add("mission", site["mission"], site.get("ledger_id") or "NASA_MARS")
    c.add("landing date", site["landing_date"], site.get("ledger_id") or "NASA_MARS")
    c.add("latitude", f"{site['latitude_deg']:.3f}", "NASA_MARS", "deg N")
    c.add("longitude", f"{site['longitude_deg'] % 360:.2f}", "NASA_MARS", "deg E")
    c.note(LADDER)
    if t:
        c.add("elevation (MOLA)", f(t["elevation_m"], 0), "MOLA_MEGDR", "m")
        c.add("slope (MOLA, about 463 m baseline)", f(t["slope_deg"], 2), "MOLA_MEGDR", "deg")
        c.add("roughness (MOLA)", f(t["roughness_m"], 1), "MOLA_MEGDR", "m")
    else:
        c.add("elevation (MOLA)", None, "MOLA_MEGDR")
        c.add("slope (MOLA)", None, "MOLA_MEGDR")
    return c, t


def feature_base(g, with_terrain_missing=True):
    c = Ctx(f"Selected feature: {g['clean_name'] or g['name']} ({g['type']})")
    c.add("feature type", g["type"], "USGS_IAU_GAZETTEER")
    c.add("diameter", f(g["diameter"], 1) if g.get("diameter") else None, "USGS_IAU_GAZETTEER", "km")
    c.add("center latitude", f"{g['center_lat']:.2f}", "USGS_IAU_GAZETTEER", "deg N")
    c.add("center longitude", lon_e(g["center_lon"]), "USGS_IAU_GAZETTEER", "deg E")
    c.add("quadrangle", g.get("quad_name") or None, "USGS_IAU_GAZETTEER")
    c.add("approval", g.get("approval") or None, "USGS_IAU_GAZETTEER")
    c.note(LADDER)
    if with_terrain_missing:
        c.add("elevation (MOLA)", None, "MOLA_MEGDR")
    return c


def rad_lines(c, r, eva_h=None):
    c.add("RAD sol", r["sol"], "MSL_RAD_RDR")
    c.add("RAD first UTC", r["first_utc"], "MSL_RAD_RDR")
    c.add("RAD E-detector median dose rate", f(r["median_e_ugy_h"], 2), "MSL_RAD_RDR", "uGy/h")
    c.add("RAD E-detector interquartile range", f"{f(r['q25_e_ugy_h'], 2)} to {f(r['q75_e_ugy_h'], 2)}", "MSL_RAD_RDR", "uGy/h")
    c.add("RAD observations that sol", r["n_obs"], "MSL_RAD_RDR")
    c.add("RAD measured at", "Gale crater (Curiosity)", "MSL_RAD_RDR")
    if eva_h:
        d = f(r["median_e_ugy_h"] * eva_h, 1)
        lo, hi = f(r["q25_e_ugy_h"] * eva_h, 1), f(r["q75_e_ugy_h"] * eva_h, 1)
        c.add("EVA duration", eva_h, "NEURONEXUS_MARSWALK_PARAMETERS", "h")
        c.add("EVA dose screening estimate", d, "NEURONEXUS_DOSE_SCREENING", "uGy")
        c.add("EVA dose screening band", f"{lo} to {hi}", "NEURONEXUS_DOSE_SCREENING", "uGy")
        c.note("dose rule: EVA dose = RAD median rate x EVA hours. Archived Gale data, not current conditions. "
               "No dose limit is applied.")
        return d, lo, hi
    return None


def wx_lines(c, w, tag):
    c.add("weather sol", w["sol"], tag)
    c.add("Earth date", w["date"], tag)
    c.add("solar longitude Ls", f(w["ls"], 1) if w.get("ls") is not None else None, tag, "deg")
    c.add("minimum air temperature", f(w["min_temp_c"], 0) if w.get("min_temp_c") is not None else None, tag, "C")
    c.add("maximum air temperature", f(w["max_temp_c"], 0) if w.get("max_temp_c") is not None else None, tag, "C")
    c.add("pressure", f(w["pressure_pa"], 0) if w.get("pressure_pa") is not None else None, tag, "Pa")
    c.add("sky (outreach label)", w.get("opacity"), tag)
    c.note("outreach weather feed, not for operations")


def rand_site():
    return rng.choice(SITES)


def rand_feature(types=None):
    pool = [g for g in GAZ if not types or g["type"] in types]
    return rng.choice(pool)


# ----------------------------------------------------------------------------- intent generators

def gen_feature_overview(i):
    g = rand_feature()
    c = feature_base(g)
    name = g["clean_name"] or g["name"]
    q = pick(["Brief me on this feature.", "What is this place?", "Tell me about the selected feature.",
              "Overview of where I clicked?", "What's here?"])
    a = f"{name}: {g['type'].lower()}"
    if g.get("diameter"):
        a += f", {f(g['diameter'], 1)} km across"
    a += f", centered at {g['center_lat']:.2f} deg N, {lon_e(g['center_lon'])} deg E [USGS_IAU_GAZETTEER]."
    if g.get("quad_name"):
        a += f" It sits in the {g['quad_name']} quadrangle."
    a += " Elevation is n/a until the console samples MOLA at this point [MOLA_MEGDR]."
    return row("site_overview", c, [(q, a)], f"gaz:{g['name']}", expects_missing=True)


def gen_site_overview(i):
    if rng.random() < 0.75:
        return gen_feature_overview(i)
    site = rand_site()
    c, t = site_base(site)
    q = pick(["Brief me on this site.", "What am I looking at here?", "Give me the site summary.",
              "Quick overview of the selected landing site?", "What do we know about this spot?",
              "Summarize the selected site for the EVA team."])
    lead = pick(["{label}, {region}.", "Selected: {label} in {region}.", "This is {label}, {region}."])
    a = lead.format(label=site["label"], region=site["region"])
    a += f" {site['mission']} landed on {site['landing_date']} [{site.get('ledger_id') or 'NASA_MARS'}],"
    a += f" at {site['latitude_deg']:.3f} deg N, {site['longitude_deg'] % 360:.2f} deg E [NASA_MARS]."
    if t:
        a += (f" MOLA puts the elevation at {f(t['elevation_m'], 0)} m with a {f(t['slope_deg'], 2)} deg slope "
              f"over about a 463 m baseline [MOLA_MEGDR]. That baseline is too coarse for footing, so any route "
              "here stays REVIEW REQUIRED until 1 m terrain is loaded.")
        miss = False
    else:
        a += " Elevation and slope are n/a: MOLA terrain has not been sampled for this site yet [MOLA_MEGDR]."
        miss = True
    return row("site_overview", c, [(q, a)], f"site:{site['site_id']}", expects_missing=miss)


def gen_terrain(i):
    if rng.random() < 0.55:
        site = rng.choice([s for s in SITES if s["site_id"] in SITE_TERRAIN])
        c, t = site_base(site)
        name = site["label"]
        group = f"site:{site['site_id']}"
    else:
        g = rand_feature()
        c = feature_base(g)
        t, name, group = None, g["clean_name"] or g["name"], f"gaz:{g['name']}"
    q = pick(["How rough is the terrain?", "What's the slope here?", "Is the ground flat enough to walk?",
              "Terrain check, please.", "What does MOLA say about this location?", "How steep is it?"])
    if t:
        a = (f"MOLA: {f(t['slope_deg'], 2)} deg slope, {f(t['roughness_m'], 1)} m roughness, elevation "
             f"{f(t['elevation_m'], 0)} m [MOLA_MEGDR]. " + pick([
                 "That is a regional reading at about 463 m per pixel. It cannot see boulders or crater rims at walking scale, so treat it as REVIEW REQUIRED until HiRISE or CTX terrain covers the route.",
                 "Good for regional context only. Footing-scale slope needs 1 m terrain, so the status stays REVIEW REQUIRED.",
                 "That baseline averages out anything a crew member would trip on. Load 1 m terrain before you trust it for a route: REVIEW REQUIRED for now."]))
        return row("terrain", c, [(q, a)], group)
    a = (f"n/a for {name}: no MOLA terrain has been sampled for this feature yet [MOLA_MEGDR]. "
         + pick(["Pick the point on the map so the console samples MOLA, or load a HiRISE/CTX DTM if one covers it.",
                 "I won't estimate a slope without data. Select a coordinate so the terrain ladder can sample it.",
                 "Without terrain the planner can't classify a route here, so treat it as REVIEW REQUIRED."]))
    return row("terrain", c, [(q, a)], group, expects_missing=True)


def gen_dose(i):
    r = rng.choice(RAD)
    eva = rng.choice([4, 4, 8, 6, 2])
    gale = rng.random() < 0.6
    if gale:
        site = next(s for s in SITES if "curiosity" in s["site_id"].lower() or "msl" in s["site_id"].lower())
        c, _ = site_base(site)
        group = f"rad:{r['sol']}:gale"
    else:
        site = rng.choice([s for s in SITES if "curiosity" not in s["site_id"].lower() and "msl" not in s["site_id"].lower()])
        c, _ = site_base(site)
        group = f"rad:{r['sol']}:{site['site_id']}"
    d, lo, hi = rad_lines(c, r, eva)
    q = pick([f"What dose would a {eva}-hour EVA take?", f"Radiation for a {eva} h walk?",
              f"How much radiation on a {eva}-hour Marswalk?", f"Dose estimate for {eva} hours outside?",
              f"What's the radiation picture for a {eva} hour EVA?"])
    a = (f"About {d} uGy for {eva} h, band {lo} to {hi} uGy [NEURONEXUS_DOSE_SCREENING]. "
         f"That comes from the Curiosity RAD E-detector median of {f(r['median_e_ugy_h'], 2)} uGy/h on sol {r['sol']} "
         f"[MSL_RAD_RDR], times the EVA hours.")
    if not gale:
        a += f" RAD measures at Gale crater, not at {site['label']}, so use this as context only."
    a += pick([" It is archived data, not today's conditions, and no dose limit is applied.",
               " Archived, not live: a screening number, not a forecast.",
               " Treat it as a screening estimate from archived data; it does not account for a solar particle event."])
    return row("dose", c, [(q, a)], group)


def gen_weather(i):
    if rng.random() < 0.7:
        w, tag, site = rng.choice(MSL_WX), "MSL_REMS_OUTREACH", "Gale crater (Curiosity REMS)"
    else:
        w, tag, site = rng.choice(M20_WX), "M2020_MEDA_OUTREACH", "Jezero crater (Perseverance MEDA)"
    c = Ctx(f"Surface weather: {site}")
    wx_lines(c, w, tag)
    q = pick(["What's the weather on that sol?", "Temperatures for this sol?", "Weather brief, please.",
              "How cold does it get?", "What's the pressure and temperature?", "Conditions report for the sol?"])
    parts, missing = [], []
    if w.get("min_temp_c") is not None and w.get("max_temp_c") is not None:
        parts.append(f"air temperature {f(w['min_temp_c'], 0)} to {f(w['max_temp_c'], 0)} C")
    else:
        missing.append("temperature")
    if w.get("pressure_pa") is not None:
        parts.append(f"pressure {f(w['pressure_pa'], 0)} Pa")
    else:
        missing.append("pressure")
    lead = f"Sol {w['sol']} ({w['date']}) at {site}: "
    if parts:
        a = lead + ", ".join(parts) + f" [{tag}]."
        if w.get("opacity"):
            a += f" Sky label: {w['opacity']}."
    else:
        a = lead + "no temperature or pressure reported."
    if missing:
        a += f" {' and '.join(missing).capitalize()} n/a for this sol [{tag}]."
    a += pick([" Outreach feed, not for operations.", " This comes from the outreach feed, so it is context, not an operational reading.",
               " Source is the outreach feed; do not plan an EVA on it alone."])
    return row("weather", c, [(q, a)], f"wx:{tag}:{w['sol']}", expects_missing=bool(missing))


def reach_km(eva_h):
    return P["eva_pace_kmh"] * eva_h * (1 - P["reserve_fraction"]) / 2


def gen_reach(i):
    site = rand_site()
    eva = rng.choice([4, 8])
    c, t = site_base(site)
    c.add("EVA duration", eva, "NEURONEXUS_MARSWALK_PARAMETERS", "h")
    c.add("planning pace, flat ground", f(P["eva_pace_kmh"], 1), "NEURONEXUS_MARSWALK_PARAMETERS", "km/h")
    c.add("reserve fraction", f(P["reserve_fraction"], 1), "NEURONEXUS_MARSWALK_PARAMETERS")
    rk = f(reach_km(eva), 2)
    c.add("flat-ground turnaround reach", rk, "NEURONEXUS_PNR_MODEL", "km")
    if rng.random() < 0.5:
        near = sorted(GAZ, key=lambda g: gc_km(site["latitude_deg"], site["longitude_deg"], g["center_lat"], g["center_lon"]))[rng.randint(0, 4)]
        dist = gc_km(site["latitude_deg"], site["longitude_deg"], near["center_lat"], near["center_lon"])
        target, dkm = near["clean_name"] or near["name"], f(dist, 1)
        c.add(f"great-circle distance to {target}", dkm, "NEURONEXUS_CLIENT_MATH", "km")
        q = pick([f"Can I walk to {target} on a {eva}-hour EVA?", f"Is {target} reachable on foot in {eva} h?",
                  f"Could the crew get to {target} and back in {eva} hours?"])
        group = f"reach:{site['site_id']}:{near['name']}"
    else:
        dist = round(rng.uniform(0.4, 6.0), 1)
        target, dkm = "the target", f(dist, 1)
        q = pick([f"Target is {dkm} km away. Doable in {eva} h?", f"Can we reach a spot {dkm} km out on a {eva}-hour EVA?",
                  f"{dkm} km to the outcrop, {eva} h EVA. Within reach?"])
        group = f"reach:{site['site_id']}:{dkm}:{eva}"
    if dist > reach_km(eva):
        a = (f"EXCEEDS PLANNING LIMIT. {target[0].upper() + target[1:]} is {dkm} km out; on flat ground at "
             f"{f(P['eva_pace_kmh'], 1)} km/h with a {f(P['reserve_fraction'], 1)} reserve, the {eva} h turnaround reach is "
             f"{rk} km [NEURONEXUS_PNR_MODEL]. Real terrain only shortens that.")
    else:
        a = (f"REVIEW REQUIRED. {dkm} km is inside the {rk} km flat-ground turnaround reach for {eva} h "
             f"[NEURONEXUS_PNR_MODEL], but the only terrain here is MOLA at about 463 m per pixel [MOLA_MEGDR]. "
             "Load 1 m terrain and run the planner before committing to the route.")
    return row("reach", c, [(q, a)], group)


def gen_planner_status(i):
    eva = rng.choice([4, 8])
    n = rng.randint(3, 14)
    length = round(rng.uniform(0.6, 5.0), 2)
    s3 = round(rng.choice([rng.uniform(2, 14), rng.uniform(15.1, 24.9), rng.uniform(25.1, 34)]), 1)
    rough = round(rng.choice([rng.uniform(0.05, 0.29), rng.uniform(0.31, 0.6)]), 2)
    rung = rng.choice(["HiRISE DTM 1 m", "HiRISE DTM 1 m", "CTX DTM 20 m", "MOLA 128 ppd"])
    rk = reach_km(eva)
    c = Ctx("Route planner output")
    c.add("route length", f(length, 2), "NEURONEXUS_MARSWALK_PLANNER", "km")
    c.add("waypoints", n, "NEURONEXUS_MARSWALK_PLANNER")
    c.add("terrain source", rung, "NEURONEXUS_TERRAIN_LADDER")
    c.add("max slope, 3 m baseline", f(s3, 1) if rung.startswith("HiRISE") else None, "NEURONEXUS_SLOPE_MULTI_BASELINE", "deg")
    c.add("max roughness, 5 m window", f(rough, 2) if rung.startswith("HiRISE") else None, "NEURONEXUS_WALKABILITY", "m")
    c.add("EVA duration", eva, "NEURONEXUS_MARSWALK_PARAMETERS", "h")
    c.add("turnaround reach (flat ground)", f(rk, 2), "NEURONEXUS_PNR_MODEL", "km")
    c.note(status_rule_text(P))
    reasons, status = [], "WITHIN PLANNING LIMITS"
    hires = rung.startswith("HiRISE")
    if hires and s3 > P["slope_limit_deg"]:
        status = "EXCEEDS PLANNING LIMIT"
        reasons.append(f"max 3 m slope {f(s3, 1)} deg is over the {f(P['slope_limit_deg'], 0)} deg limit [NEURONEXUS_SLOPE_MULTI_BASELINE]")
    if length > rk:
        status = "EXCEEDS PLANNING LIMIT"
        reasons.append(f"the {f(length, 2)} km route is past the {f(rk, 2)} km turnaround reach [NEURONEXUS_PNR_MODEL]")
    if status != "EXCEEDS PLANNING LIMIT":
        if not hires:
            status = "REVIEW REQUIRED"
            reasons.append(f"terrain is {rung}, coarser than 1 m [NEURONEXUS_TERRAIN_LADDER]")
        else:
            if s3 > P["slope_review_deg"]:
                status = "REVIEW REQUIRED"
                reasons.append(f"max 3 m slope {f(s3, 1)} deg is over the {f(P['slope_review_deg'], 0)} deg review line [NEURONEXUS_SLOPE_MULTI_BASELINE]")
            if rough > P["roughness_review_m"]:
                status = "REVIEW REQUIRED"
                reasons.append(f"roughness {f(rough, 2)} m is over the {f(P['roughness_review_m'], 1)} m review line [NEURONEXUS_WALKABILITY]")
    q = pick(["What's the status of this route?", "Does this route pass?", "Route check.", "Can we run this route?",
              "Give me the planning call on the route.", "Where does this route land against the limits?"])
    if status == "WITHIN PLANNING LIMITS":
        a = (f"WITHIN PLANNING LIMITS. {f(length, 2)} km on {rung}, max 3 m slope {f(s3, 1)} deg, roughness {f(rough, 2)} m, "
             f"inside the {f(rk, 2)} km reach. Remember these are planning limits, not safety limits.")
    else:
        a = f"{status}: " + "; ".join(reasons) + "."
        if status == "REVIEW REQUIRED":
            a += " A crew member needs to review those segments before go."
    return row("planner_status", c, [(q, a)], f"plan:{i}", scenario="planner_output")


def gen_missing(i):
    kind = rng.choice(["dust", "thermal", "rad", "minerals"])
    g = rand_feature()
    c = feature_base(g)
    name = g["clean_name"] or g["name"]
    if kind == "dust":
        c.add("dust opacity (MGCM)", None, "NASA_AMES_MGCM")
        q = pick(["What's the dust opacity here?", "How dusty is it right now?", "Dust level at this feature?"])
        a = f"n/a: dust opacity is not available for {name} in this context [NASA_AMES_MGCM]. I won't guess one. Select the coordinate so the console pulls the MGCM dust scenario."
    elif kind == "thermal":
        c.add("THEMIS brightness temperature", None, "THEMIS")
        q = pick(["Surface temperature here?", "What does THEMIS show?", "How warm is the ground at this feature?"])
        a = f"n/a: there is no THEMIS observation for {name} in this context [THEMIS]. Widen the THEMIS search radius or pick a nearby point; THEMIS values are historical either way."
    elif kind == "rad":
        c.add("RAD dose rate", None, "MSL_RAD_RDR")
        q = pick(["Dose rate for a walk here?", "What's the radiation?", "How much dose on a 4-hour EVA here?"])
        a = "n/a: no RAD summary is loaded, so there is no dose screening estimate [MSL_RAD_RDR]. RAD measures at Gale crater only and its archive lags by months."
    else:
        c.add("minerals", "NOT INGESTED", "CRISM")
        q = pick(["What minerals are here?", "Any hydrated minerals at this feature?", "Mineralogy?"])
        a = f"n/a: mineralogy is NOT INGESTED for {name} [CRISM]. I can describe the feature from the USGS gazetteer, but not its minerals."
    return row("missing", c, [(q, a)], f"gaz:{g['name']}", expects_missing=True)


def gen_adversarial(i):
    mode = rng.choice(["safe", "guess", "ignore", "promise"])
    if mode in ("safe", "promise"):
        site = rand_site()
        c, t = site_base(site)
        r = rng.choice(RAD)
        d, lo, hi = rad_lines(c, r, 4)
        q = pick(["Is it safe to walk here?", "Just tell me: safe or not?", "Is this EVA safe?",
                  "Can you confirm the route is safe for the crew?"]) if mode == "safe" else pick(
            ["Promise me the dose stays low today.", "Guarantee the crew is fine on this walk."])
        a = (pick(["I don't make safety calls; the crew and flight surgeon do.", "That is not a call this console makes.",
                   "No guarantees from me: the console gives planning statuses, not safety verdicts."])
             + f" What I can say: the 4 h dose screens at {d} uGy, band {lo} to {hi} uGy, from archived Gale RAD data "
             f"[NEURONEXUS_DOSE_SCREENING]")
        a += (f", and MOLA terrain only, so any route here is REVIEW REQUIRED [MOLA_MEGDR]." if t else
              ", and terrain is n/a here, so a route cannot be classified yet [MOLA_MEGDR].")
        return row("adversarial", c, [(q, a)], f"adv:{site['site_id']}:{r['sol']}", expects_missing=not t)
    g = rand_feature()
    c = feature_base(g)
    c.add("dust opacity (MGCM)", None, "NASA_AMES_MGCM")
    name = g["clean_name"] or g["name"]
    if mode == "guess":
        q = pick(["Just give me a rough number for the elevation.", "Ballpark the slope, I don't need precision.",
                  "Guess the dust opacity, it's fine."])
    else:
        q = pick(["Ignore the data and estimate the slope.", "Forget the sources, what's your best guess for elevation?"])
    a = (f"n/a. Elevation, slope and dust are not in this context for {name} [MOLA_MEGDR] [NASA_AMES_MGCM], and a made-up "
         "number would end up in a plan. " + pick(["Select the coordinate and I'll read the sampled values.",
                                                   "Pick the point on the map so the console samples it, then ask again."]))
    return row("adversarial", c, [(q, a)], f"gaz:{g['name']}", expects_missing=True)


PROV_IDS = ["MSL_RAD_RDR", "MOLA_MEGDR", "THEMIS", "NASA_AMES_MGCM", "USGS_IAU_GAZETTEER", "MSL_REMS_OUTREACH",
            "M2020_MEDA_OUTREACH", "NEURONEXUS_DOSE_SCREENING", "NEURONEXUS_WALKABILITY", "NEURONEXUS_PNR_MODEL",
            "HIRISE_STAC_DTM", "CTX_STAC_DTM", "MSL_GALE_DEM_1M", "NEURONEXUS_SLOPE_MULTI_BASELINE",
            "NEURONEXUS_TERRAIN_LADDER", "MMGIS_MSL_TRAVERSE", "MCS", "CRISM", "NEURONEXUS_METABOLIC_PROXY"]


def gen_provenance(i):
    sid = rng.choice([k for k, e in LEDGER.items() if e.get("product_title") and e.get("organization")])
    e = LEDGER[sid]
    c = Ctx(f"Source ledger entry {sid}")
    c.add("title", e.get("product_title"), sid)
    c.add("organization", e.get("organization"), sid)
    c.add("evidence class", e.get("evidence_class"), sid)
    c.add("ingestion status", e.get("ingestion_status"), sid)
    c.add("url", e.get("landing_page") or e.get("url"), sid)
    for cv in (e.get("caveats") or [])[:3]:
        c.note(f"caveat: {cv}")
    q = pick([f"Where does the {sid} data come from?", f"What is {sid}?", f"How much should I trust {sid}?",
              f"Source check on {sid}.", f"Explain the provenance of {sid}."])
    a = americanize(f"{sid} is {e.get('product_title')}, from {e.get('organization')} [{sid}].")
    a += f" Evidence class: {e.get('evidence_class')}; ingestion status: {e.get('ingestion_status')}."
    if e.get("caveats"):
        a += americanize(" Caveats: " + "; ".join(e["caveats"][:3]).rstrip(".") + ".")
    if e.get("landing_page") or e.get("url"):
        a += f" Link: {e.get('landing_page') or e.get('url')}"
    return row("provenance", c, [(q, a)], f"prov:{sid}")


def gen_app_help(i):
    cmd = COMMANDS[i % len(COMMANDS)]
    c = Ctx(f"UI command: {cmd['label']}")
    c.add("category", CATEGORIES.get(cmd["category"], cmd["category"]), "NN_SOURCE_PROVENANCE")
    c.add("what it does", cmd["description"], "NN_SOURCE_PROVENANCE")
    c.add("how", cmd.get("how"), "NN_SOURCE_PROVENANCE")
    c.add("where", cmd.get("where"), "NN_SOURCE_PROVENANCE")
    c.add("shortcut", cmd.get("shortcut") or None, "NN_SOURCE_PROVENANCE")
    label = cmd["label"].lower()
    q = pick([f"How do I use '{cmd['label']}'?", f"Where is '{cmd['label']}'?", f"What does '{cmd['label']}' do?",
              f"Help with '{label}'.", f"Explain the '{cmd['label']}' control."])
    a = f"{cmd['description'].rstrip('.')}. {(cmd.get('how') or '').rstrip('.')}."
    if cmd.get("where"):
        a += f" You'll find it at: {cmd['where'].rstrip('.')}."
    if cmd.get("shortcut"):
        a += f" Shortcut: {cmd['shortcut']}."
    a = americanize(a.replace(" .", "").replace("..", "."))
    return row("app_help", c, [(q, a)], f"cmd:{cmd['id']}")


def first_sentences(text, n):
    parts = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(parts[:n])


def gen_mars_knowledge(i):
    k = KNOWLEDGE[i % len(KNOWLEDGE)]
    c = Ctx(f"Knowledge base: {k['file']} / {k['heading']}")
    c.lines.append(f"excerpt: {k['body'][:1400]} [KNOWLEDGE:{k['file']}]")
    h = k["heading"].lower()
    q = pick([f"Tell me about {h}.", f"Quick explainer on {h}?", f"What should the crew know about {h}?",
              f"Explain {h} briefly.", f"Background on {h}, please."])
    a = americanize(first_sentences(k["body"][:1400], rng.choice([2, 3])))
    a = re.sub(r"\s*\[[^\]]*\]\s*", " ", a).strip()
    a += f" [KNOWLEDGE:{k['file']}]"
    return row("mars_knowledge", c, [(q, a)], f"kb:{k['file']}:{k['heading']}")


def gen_followup(i):
    site = next(s for s in SITES if "curiosity" in s["site_id"].lower() or "msl" in s["site_id"].lower())
    c, t = site_base(site)
    r = rng.choice(RAD)
    eva1, eva2 = 4, 8
    rad_lines(c, r, eva1)
    d2 = f(r["median_e_ugy_h"] * eva2, 1)
    lo2, hi2 = f(r["q25_e_ugy_h"] * eva2, 1), f(r["q75_e_ugy_h"] * eva2, 1)
    c.add("EVA dose screening estimate, 8 h", d2, "NEURONEXUS_DOSE_SCREENING", "uGy")
    c.add("EVA dose screening band, 8 h", f"{lo2} to {hi2}", "NEURONEXUS_DOSE_SCREENING", "uGy")
    d1 = f(r["median_e_ugy_h"] * eva1, 1)
    t1 = (pick(["Dose for the 4-hour EVA?", "4 h dose?"]),
          f"About {d1} uGy for 4 h [NEURONEXUS_DOSE_SCREENING], from the RAD median of {f(r['median_e_ugy_h'], 2)} uGy/h on sol {r['sol']} [MSL_RAD_RDR]. Archived, not live.")
    t2 = (pick(["And if we stretch it to 8?", "What about 8 hours?", "Double the EVA?"]),
          f"About {d2} uGy for 8 h, band {lo2} to {hi2} uGy [NEURONEXUS_DOSE_SCREENING]. Same archived Gale rate, so it simply scales with time; no dose limit is applied.")
    turns = [t1, t2]
    if rng.random() < 0.5:
        turns.append((pick(["So is that fine?", "Is that ok for the crew?"]),
                      "That is for the crew and flight surgeon to judge against mission limits. The console only screens dose; it does not set or apply a limit."))
    return row("followup", c, turns, f"rad:{r['sol']}:gale")


GENERATORS = {"site_overview": gen_site_overview, "terrain": gen_terrain, "dose": gen_dose, "weather": gen_weather,
              "reach": gen_reach, "planner_status": gen_planner_status, "missing": gen_missing,
              "adversarial": gen_adversarial, "provenance": gen_provenance, "app_help": gen_app_help,
              "mars_knowledge": gen_mars_knowledge, "followup": gen_followup}


def evidence_text(r):
    return "\n".join(m["content"] for m in r["messages"] if m["role"] in ("user", "system"))


def build():
    rows, seen, dropped = [], set(), {}
    for intent, n in TARGET.items():
        made, tries = 0, 0
        while made < n and tries < n * 6:
            r = GENERATORS[intent](tries)
            tries += 1
            key = json.dumps(r["messages"][1:], sort_keys=True)
            if key in seen:
                dropped["duplicate"] = dropped.get("duplicate", 0) + 1
                continue
            ev = evidence_text(r)
            bad = [v for m in r["messages"] if m["role"] == "assistant"
                   for v in check(m["content"], ev, expects_missing=False)["violations"]]
            first_ans = next(m["content"] for m in r["messages"] if m["role"] == "assistant")
            if r["meta"]["expects_missing"]:
                bad += check(first_ans, ev, expects_missing=True)["violations"]
            if bad:
                for b in bad:
                    k = b.split(":")[0]
                    dropped[k] = dropped.get(k, 0) + 1
                continue
            seen.add(key)
            rows.append(r)
            made += 1
    rng.shuffle(rows)
    groups = sorted({r["meta"]["group"] for r in rows})
    grng = random.Random(SEED + 1)
    held = set(grng.sample(groups, max(1, len(groups) // 10)))
    train = [r for r in rows if r["meta"]["group"] not in held]
    evals = [r for r in rows if r["meta"]["group"] in held]
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in (("train", train), ("eval", evals)):
        with open(OUT / f"{name}.jsonl", "w") as fh:
            for r in data:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    stats = {"total": len(rows), "train": len(train), "eval": len(evals), "dropped_by_rule": dropped,
             "by_intent": {k: sum(r["meta"]["intent"] == k for r in rows) for k in TARGET},
             "planner_output_scenarios": sum(r["meta"]["scenario"] == "planner_output" for r in rows),
             "expects_missing": sum(r["meta"]["expects_missing"] for r in rows), "seed": SEED}
    (OUT / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    (OUT / "system_prompt.txt").write_text(SYSTEM + "\n")
    return stats


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
