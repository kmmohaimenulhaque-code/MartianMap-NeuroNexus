"""MSL RAD RDR (PDS PPI): stream-parse the per-sol ASCII files into dose-rate summaries.

Units (RAD_RDR_SIS, DOCUMENT/): [DOSIMETRY_TOTAL_DOSE_B] and [DOSIMETRY_TOTAL_DOSE_E] are microgray per
hour; E is the tissue-like detector. Raw RDR files (~70 MB per sol) are never stored: each is streamed once
into a per-sol summary kept in data/snapshots/rad/rad_sol_summaries.json. The archive lags operations by
months; nothing here is live.
"""
from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta

import numpy as np
import requests

from science import settings

BASE = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/"
SNAPSHOT = settings.PROJECT_ROOT / "data" / "snapshots" / "rad" / "rad_sol_summaries.json"
FILE_RE = re.compile(r'href="(RAD_RDR_(\d{4})_(\d{3})_\d{2}_\d{2}_(\d{4})_V\d{2}\.TXT)"', re.I)
DIR_RE = re.compile(r'href="(SOL_\d{5}_\d{5}/)"', re.I)


def _get(url: str, **kw) -> requests.Response:
    settings.check_url(url)
    response = requests.get(url, timeout=(settings.CONNECT_TIMEOUT_S, 120), **kw)
    response.raise_for_status()
    return response


def list_sol_files() -> dict[int, str]:
    """Map sol -> RDR text URL across the archive's SOL_xxxxx_yyyyy directories."""
    out = {}
    for d in DIR_RE.findall(_get(BASE).text):
        for name, _year, _doy, sol in FILE_RE.findall(_get(BASE + d).text):
            out[int(sol)] = BASE + d + name
    return out


def utc_from_doy(text: str) -> datetime:
    """'2026-080 17:18:00' -> datetime (UTC)."""
    year, rest = text.split("-", 1)
    doy, clock = rest.split(" ", 1)
    hh, mm, ss = (int(float(x)) for x in clock.split(":"))
    return datetime(int(year), 1, 1, tzinfo=UTC) + timedelta(days=int(doy) - 1, hours=hh, minutes=mm, seconds=ss)


def parse_lines(lines) -> list[dict]:
    """One record per observation: start UTC, duration (s), QC flag, dose rates B and E (uGy/h)."""
    records, current, pending = [], None, None
    for raw in lines:
        line = raw.decode("ascii", "ignore").strip() if isinstance(raw, bytes) else raw.strip()
        if not line:
            continue
        if line.startswith("[OBSERVATION:"):
            if current and "dose_e_ugy_h" in current:
                records.append(current)
            current, pending = {}, None
        elif current is None:
            continue
        elif line.startswith("START_OBS_UTC="):
            current["start_utc"] = line.split("=", 1)[1].strip('"')
        elif line.startswith("OBS_DURATION="):
            current["duration_s"] = float(line.split("=", 1)[1])
        elif line.startswith("QC="):
            current["qc"] = line.split("=", 1)[1].strip('"')
        elif line.startswith("[DOSIMETRY_TOTAL_DOSE_B:"):
            pending = "dose_b_ugy_h"
        elif line.startswith("[DOSIMETRY_TOTAL_DOSE_E:"):
            pending = "dose_e_ugy_h"
        elif line.startswith("["):
            pending = None
        elif pending:
            try:
                current[pending] = float(line.split()[0])
            except ValueError:
                pass
            pending = None
    if current and "dose_e_ugy_h" in current:
        records.append(current)
    return records


def summarize_sol(sol: int, url: str) -> dict:
    with _get(url, stream=True) as response:
        records = parse_lines(response.iter_lines())
    e = np.array([r["dose_e_ugy_h"] for r in records if r.get("dose_e_ugy_h", -1) > 0])
    b = np.array([r["dose_b_ugy_h"] for r in records if r.get("dose_b_ugy_h", -1) > 0])
    starts = sorted(r["start_utc"] for r in records if "start_utc" in r)
    if e.size == 0:
        return {"sol": sol, "status": "PARSE FAILURE", "n_obs": len(records), "file": url.rsplit("/", 1)[-1]}
    return {"sol": sol, "file": url.rsplit("/", 1)[-1], "n_obs": int(e.size), "first_utc": starts[0] if starts else None,
            "median_e_ugy_h": float(np.median(e)), "q25_e_ugy_h": float(np.percentile(e, 25)),
            "q75_e_ugy_h": float(np.percentile(e, 75)), "median_b_ugy_h": float(np.median(b)) if b.size else None,
            "status": "OK"}


def load_snapshot() -> dict:
    try:
        return json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"sols": {}}


def latest_window(n_sols: int = 30, today: datetime | None = None) -> dict:
    """Latest archived sol, archive lag and the median E dose rate with IQR over the last n archived sols."""
    snap = load_snapshot()
    sols = sorted((int(k), v) for k, v in snap.get("sols", {}).items() if v.get("status") == "OK")
    if not sols:
        return {"status": "UNAVAILABLE", "reason": "no RAD summaries (run python tools/fetch_rad.py)"}
    latest_sol, latest = sols[-1]
    window = [v for s, v in sols if s > latest_sol - n_sols]
    daily = np.array([v["median_e_ugy_h"] * 24.0 for v in window])
    gaps = np.diff([s for s, _ in sols if s > latest_sol - n_sols])
    when = utc_from_doy(latest["first_utc"]) if latest.get("first_utc") else None
    now = today or datetime.now(UTC)
    out = {"latest_sol": latest_sol, "latest_utc": when.isoformat() if when else None,
           "lag_days": (now - when).days if when else None, "window_sols": len(window),
           "rate_E_median": float(np.median(daily)), "iqr": [float(np.percentile(daily, 25)), float(np.percentile(daily, 75))],
           "unit": "uGy/day (tissue-like detector E; daily rate = 24 x per-sol median of uGy/h)",
           "evidence": "OBSERVED", "status": "ARCHIVED", "ledger_id": "MSL_RAD_RDR",
           "retrieved_at": snap.get("retrieved_at"), "source_note": snap.get("source")}
    if len(window) < 5 or (gaps.size and gaps.max() > 30):
        out.update({"status": "INSUFFICIENT DATA FOR AN ESTIMATE", "reason": "fewer than 5 sols or a gap > 30 sols"})
    return out
