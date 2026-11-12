"""V4 route plausibility (planner vs the real drive) and V5 reproducibility."""
from __future__ import annotations

import json
import math

import numpy as np

from science.marswalk import planner
from science.rovers import traverses
from science.validation import stats

LEG_MIN_M, LEG_MAX_M, MAX_LEGS = 200.0, 800.0, 40
PLAN_RES_M = 2.0  # fine-pass resolution for V4/V5 legs (the console uses 1 m below 1.5 km)
RESAMPLE_M, WITHIN_M = 5.0, 10.0


def _xy(lat, lon, lat0, lon0) -> np.ndarray:
    x, y = traverses.local_xy(np.asarray(lat, float), np.asarray(lon, float), lat0, lon0)
    return np.column_stack([x, y])


def legs(rover: str) -> tuple[list[dict], int]:
    """Deterministic legs of consecutive drives, 200-800 m straight-line apart, with the real drive path."""
    data = traverses.load(rover)
    wps = [w for w in data["waypoints"] if w["lat"] is not None]
    path = np.array([c[:2] for d in data["traverse"] for c in d["coordinates"]], dtype="float64")  # lon, lat
    lat0, lon0 = float(np.mean(path[:, 1])), float(np.mean(path[:, 0]))
    pxy = _xy(path[:, 1], path[:, 0], lat0, lon0)
    wxy = _xy([w["lat"] for w in wps], [w["lon"] for w in wps], lat0, lon0)
    out, i = [], 0
    while i < len(wps) - 1:
        j = i + 1
        while j < len(wps) and math.dist(wxy[i], wxy[j]) < LEG_MIN_M:
            j += 1
        if j >= len(wps):
            break
        if math.dist(wxy[i], wxy[j]) <= LEG_MAX_M:
            a = int(np.argmin(np.hypot(*(pxy - wxy[i]).T)))
            b = int(np.argmin(np.hypot(*(pxy - wxy[j]).T)))
            if b > a + 1 and min(np.hypot(*(pxy[a] - wxy[i])), np.hypot(*(pxy[b] - wxy[j]))) < 30.0:
                drive = path[a:b + 1]
                out.append({"from": wps[i], "to": wps[j], "drive_lonlat": drive.tolist()})
        i = j
    eligible = len(out)
    if len(out) > MAX_LEGS:
        idx = np.unique(np.linspace(0, len(out) - 1, MAX_LEGS).round().astype(int))
        out = [out[k] for k in idx]
    return out, eligible


def _compare(plan_lonlat: np.ndarray, drive_lonlat: np.ndarray, lat0: float, lon0: float) -> dict:
    a = stats.resample(_xy(plan_lonlat[:, 1], plan_lonlat[:, 0], lat0, lon0), RESAMPLE_M)
    b = stats.resample(_xy(drive_lonlat[:, 1], drive_lonlat[:, 0], lat0, lon0), RESAMPLE_M)
    return {"frechet_m": stats.discrete_frechet(a, b), "hausdorff_m": stats.hausdorff(a, b),
            "length_ratio": stats.length(a) / max(stats.length(b), 1e-6), "within_10m": stats.share_within(a, b, WITHIN_M)}


def _plan_line(base: dict, target: dict, mode: str) -> tuple[np.ndarray | None, str]:
    try:
        result = planner.plan({"base": {"lat": base["lat"], "lon": base["lon"]},
                               "targets": [{"lat": target["lat"], "lon": target["lon"]}], "eva_hours": 8.0,
                               "terrain_mode": mode, "res_m": PLAN_RES_M})
    except (planner.PlanError, OSError, ValueError, FileNotFoundError) as exc:
        return None, str(exc)[:120]
    prof = result["profile"]
    line = np.column_stack([prof["lon"], prof["lat"]]).astype("float64")
    return line[np.all(np.isfinite(line), axis=1)], "ok" if result["status"]["value"] else "?"


def _one_leg(leg: dict) -> dict:
    drive = np.array(leg["drive_lonlat"])
    lat0, lon0 = leg["from"]["lat"], leg["from"]["lon"]
    straight = np.array([[leg["from"]["lon"], leg["from"]["lat"]], [leg["to"]["lon"], leg["to"]["lat"]]])
    out = {"straight": _compare(straight, drive, lat0, lon0)}
    for mode in ("mola", "ladder"):
        line, note = _plan_line(leg["from"], leg["to"], mode)
        out[mode] = _compare(line, drive, lat0, lon0) if line is not None and len(line) >= 2 else {"failed": note}
    return out


def v4(rover: str, log=print, workers: int = 4) -> dict:
    from concurrent.futures import ThreadPoolExecutor

    selected, eligible = legs(rover)
    methods = {"straight": [], "mola": [], "ladder": []}
    failures = {"mola": [], "ladder": []}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for k, (leg, result) in enumerate(zip(selected, pool.map(_one_leg, selected), strict=True), start=1):
            for mode, metrics in result.items():
                if "failed" in metrics:
                    failures[mode].append({"from": leg["from"]["RMC"], "to": leg["to"]["RMC"], "reason": metrics["failed"]})
                else:
                    methods[mode].append(metrics)
            if k % 10 == 0:
                log(f"  V4 {rover}: {k}/{len(selected)} legs")
    out = {"legs_eligible": eligible, "legs_used": len(selected), "leg_rule": f"{LEG_MIN_M:.0f}-{LEG_MAX_M:.0f} m straight line, "
           f"at most {MAX_LEGS} evenly spaced", "methods": {}, "failures": {k: len(v) for k, v in failures.items()},
           "failure_examples": {k: v[:3] for k, v in failures.items()}}
    for name, rows in methods.items():
        if not rows:
            out["methods"][name] = {"n": 0, "status": "INSUFFICIENT DATA"}
            continue
        summary = {"n": len(rows)}
        for metric in ("frechet_m", "hausdorff_m", "length_ratio", "within_10m"):
            v = np.array([r[metric] for r in rows])
            point, ci = stats.bootstrap(np.median, v)
            summary[metric] = {"median": point, "ci95": ci}
        out["methods"][name] = summary
    out["caveats"] = ["Rovers are not astronauts.", "Rover drivers also weighed sand, wheel wear, science stops and "
                      "communication windows, which the planner does not see."]
    return out


def v5(sites_legs: dict[str, list[dict]], n_per_site: int = 10) -> dict:
    """Twenty fixed plans run twice must be byte-identical."""
    results = []
    for site, legs_ in sites_legs.items():
        for leg in legs_[:n_per_site]:
            req = {"base": {"lat": leg["from"]["lat"], "lon": leg["from"]["lon"]},
                   "targets": [{"lat": leg["to"]["lat"], "lon": leg["to"]["lon"]}], "eva_hours": 4.0, "terrain_mode": "ladder",
                   "res_m": PLAN_RES_M}
            try:
                first = json.dumps(planner.plan(req), sort_keys=True)
                second = json.dumps(planner.plan(req), sort_keys=True)
                results.append({"site": site, "identical": first == second})
            except (planner.PlanError, OSError, ValueError) as exc:
                results.append({"site": site, "identical": None, "reason": str(exc)[:100]})
    ran = [r for r in results if r["identical"] is not None]
    return {"plans": len(results), "ran": len(ran), "identical": sum(r["identical"] for r in ran),
            "all_identical": bool(ran) and all(r["identical"] for r in ran), "not_run": [r for r in results if r["identical"] is None]}
