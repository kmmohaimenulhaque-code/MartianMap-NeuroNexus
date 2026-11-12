"""REMS (Curiosity) and MEDA (Perseverance) weather outreach feeds, labeled as outreach, never operations.

The CAB/NASA feed's own disclaimer says it is for outreach purposes only. A dated snapshot in
data/snapshots/weather/ is the offline fallback.
"""
from __future__ import annotations

import json
import time
from datetime import UTC, datetime

import requests

from science import settings

FEED = "https://mars.nasa.gov/rss/api/?feed=weather&category={category}&feedtype=json"
LABEL = "OUTREACH FEED (CAB/NASA), not for operations"
SNAPSHOT_DIR = settings.PROJECT_ROOT / "data" / "snapshots" / "weather"
TTL_S = 6 * 3600
_cache: dict[str, tuple[float, dict]] = {}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _normalize(raw: dict, keep_from_sol: int = 0) -> dict:
    sols = []
    for s in raw.get("soles") or raw.get("sols") or []:  # MSL uses "soles", Mars 2020 "sols"
        sol = _num(s.get("sol"))
        if sol is None or sol < keep_from_sol:
            continue
        sols.append({"sol": int(sol), "date": s.get("terrestrial_date"), "ls": _num(s.get("ls")), "season": s.get("season"),
                     "min_temp_c": _num(s.get("min_temp")), "max_temp_c": _num(s.get("max_temp")),
                     "pressure_pa": _num(s.get("pressure")), "opacity": s.get("atmo_opacity"),
                     "uv": s.get("local_uv_irradiance_index")})
    sols.sort(key=lambda r: r["sol"])
    return {"sols": sols, "disclaimer": (raw.get("descriptions") or {}).get("disclaimer_en", "").strip()[:400]}


def feed(category: str = "msl") -> dict:
    hit = _cache.get(category)
    if hit and time.time() - hit[0] < TTL_S:
        return hit[1]
    data = None
    if not settings.demo_pack_mode():
        try:
            url = settings.check_url(FEED.format(category=category))
            raw = requests.get(url, timeout=(settings.CONNECT_TIMEOUT_S, settings.READ_TIMEOUT_S)).json()
            data = {**_normalize(raw), "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"), "origin": "live"}
        except (OSError, ValueError, requests.RequestException):
            data = None
    if data is None:
        data = load_snapshot(category)
    _cache[category] = (time.time(), data)
    return data


def load_snapshot(category: str) -> dict:
    files = sorted(SNAPSHOT_DIR.glob(f"{category}_weather_*.json"))
    if not files:
        return {"sols": [], "origin": "unavailable", "retrieved_at": None}
    data = json.loads(files[-1].read_text(encoding="utf-8"))
    return {**data, "origin": "snapshot", "snapshot": files[-1].name}


def write_snapshot(category: str, keep_from_sol: int = 0) -> str:
    url = settings.check_url(FEED.format(category=category))
    raw = requests.get(url, timeout=(settings.CONNECT_TIMEOUT_S, 60)).json()
    stamp = datetime.now(UTC)
    data = {**_normalize(raw, keep_from_sol), "retrieved_at": stamp.isoformat(timespec="seconds"), "url": url}
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOT_DIR / f"{category}_weather_{stamp.date().isoformat()}.json"
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return path.name


def latest_line(category: str = "msl") -> dict:
    data = feed(category)
    if not data["sols"]:
        return {"status": "UNAVAILABLE", "reason": "outreach feed unreachable and no snapshot", "label": LABEL}
    s = data["sols"][-1]
    age_days = (datetime.now(UTC).date() - datetime.fromisoformat(s["date"]).date()).days if s.get("date") else None
    stale = age_days is None or age_days > 120
    line = f"Sol {s['sol']} ({s['date']})"
    if s.get("min_temp_c") is not None and s.get("max_temp_c") is not None:
        line += f": air {s['min_temp_c']:.0f} to {s['max_temp_c']:.0f} °C"
    if s.get("pressure_pa"):
        line += f", pressure {s['pressure_pa']:.0f} Pa"
    if s.get("opacity"):
        line += f", sky {s['opacity']}"
    return {"status": "NO RECENT DATA" if stale else "OUTREACH", "line": line, "sol": s["sol"], "date": s["date"],
            "ls": s["ls"], "season": s["season"], "age_days": age_days, "label": LABEL, "evidence": "OBSERVED",
            "origin": data.get("origin"), "retrieved_at": data.get("retrieved_at")}
