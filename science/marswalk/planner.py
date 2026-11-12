"""Multi-resolution corridor planner on the terrain ladder (T3.3-T3.5, T3.7).

1. Coarse path at 25 m over the whole request (the same ladder, HiRISE read from overviews).
2. Corridor = coarse path buffered by 300 m.
3. Fine search at 1 m (routes under 1.5 km) or 2 m inside the corridor with MCP_Geometric.
4. A cell is impassable if slope at 3 m > slope_limit (EXCEED) or it has no data.
5. Where HiRISE ends the ladder continues on CTX/MOLA and each segment names its source.
6. Deterministic: same request + config + data versions -> byte-identical response.
"""
from __future__ import annotations

import hashlib
import json
import math
import threading
from collections import OrderedDict

import numpy as np
from scipy.ndimage import distance_transform_edt
from skimage.graph import MCP_Geometric

from science.hires import ladder, layers
from science.hires.derivatives import LIMITATION_NOTE
from science.hires.grid import MAX_PIXELS_PER_SIDE
from science.marswalk import config, eva_model, evaluate
from science.rovers import traverses

ENGINE_VERSION = "marswalk-1.0.0"
CORRIDOR_BUFFER_M = 300.0
COARSE_RES_M = 25.0
FINE_RES_SHORT_M, FINE_RES_LONG_M, SHORT_ROUTE_M = 1.0, 2.0, 1500.0
SNAP_RADIUS_M = 25.0
ROUTE_WALK_PENALTY = 3.0  # planning choice: cost per meter = 1 + 3 * (1 - walkability / 100)
SITES = {"gale": {"lat": -4.7, "lon": 137.4, "rover": "msl"}, "jezero": {"lat": 18.44, "lon": 77.45, "rover": "m2020"}}
_layer_cache: OrderedDict[tuple, dict] = OrderedDict()
_lock = threading.Lock()


class PlanError(ValueError):
    pass


def resolve_point(point: dict) -> dict:
    if "rover" in point:
        data = traverses.load(point["rover"])
        last = max(data["waypoints"], key=lambda w: ((w["sol"] or 0), w["dist_total_m"] or 0))
        return {"lat": last["lat"], "lon": last["lon"], "label": f"{traverses.ROVERS[point['rover']]['name']} sol "
                f"{last['sol']} (stand-in habitat)", "ledger_id": traverses.ROVERS[point["rover"]]["waypoints_ledger"]}
    lat, lon = float(point["lat"]), float(point["lon"])
    if not -88 <= lat <= 88:
        raise PlanError("latitude outside -88..88")
    return {"lat": lat, "lon": ((lon + 180) % 360) - 180, "label": point.get("name") or point.get("label")}


def _distance_m(a: dict, b: dict) -> float:
    from science.constants import MARS_RADIUS_M
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dl = math.radians(((b["lon"] - a["lon"] + 180) % 360) - 180)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * MARS_RADIUS_M * math.asin(math.sqrt(min(1.0, h)))


def _frame(points: list[dict], res: float, pad_m: float) -> tuple[float, float, float, float]:
    """(lat0, lon0, half_width, res) of a square window around the points, within the pixel cap."""
    lat0 = (min(p["lat"] for p in points) + max(p["lat"] for p in points)) / 2
    lons = np.unwrap(np.radians([p["lon"] for p in points]))
    lon0 = math.degrees((lons.min() + lons.max()) / 2)
    lon0 = ((lon0 + 180) % 360) - 180
    from science.constants import MARS_RADIUS_M
    half = max(max(abs(MARS_RADIUS_M * math.radians(p["lat"] - lat0)) for p in points),
               max(abs(MARS_RADIUS_M * math.cos(math.radians(lat0)) * math.radians(((p["lon"] - lon0 + 180) % 360) - 180))
                   for p in points)) + pad_m
    half = math.ceil(half / 50.0) * 50.0
    res = max(res, math.ceil(2 * half / MAX_PIXELS_PER_SIDE * 10) / 10)
    return round(lat0, 6), round(lon0, 6), half, res


def _layers(window, v: dict) -> dict:
    key = (window.grid.key(), window.mode, config.config_hash({k: {"value": x} for k, x in v.items()}))
    with _lock:
        if key in _layer_cache:
            _layer_cache.move_to_end(key)
            return _layer_cache[key]
    computed = layers.compute(window, v, baselines=(1, 3), extras=False)
    with _lock:
        _layer_cache[key] = computed
        while len(_layer_cache) > 4:
            _layer_cache.popitem(last=False)
    return computed


def _costs(computed: dict) -> np.ndarray:
    walk = computed["walkability"].astype("float64")
    cost = 1.0 + ROUTE_WALK_PENALTY * (1.0 - np.nan_to_num(walk, nan=0.0) / 100.0)
    blocked = (computed["walk_class"] == 3) | (computed["walk_class"] == 0)
    cost[blocked] = np.inf
    return cost


def _cell(window, point: dict) -> tuple[int, int]:
    r, c = window.grid.to_rowcol(*window.grid.to_xy(point["lat"], point["lon"]))
    return int(round(float(r))), int(round(float(c)))


def _snap(cost: np.ndarray, cell: tuple[int, int], res: float) -> tuple[tuple[int, int], float]:
    r, c = cell
    if not (0 <= r < cost.shape[0] and 0 <= c < cost.shape[1]):
        raise PlanError("point outside the planning window")
    if np.isfinite(cost[r, c]):
        return cell, 0.0
    k = int(math.ceil(SNAP_RADIUS_M / res))
    r0, r1, c0, c1 = max(r - k, 0), min(r + k + 1, cost.shape[0]), max(c - k, 0), min(c + k + 1, cost.shape[1])
    rr, cc = np.mgrid[r0:r1, c0:c1]
    d = np.hypot(rr - r, cc - c) * res
    ok = np.isfinite(cost[r0:r1, c0:c1]) & (d <= SNAP_RADIUS_M)
    if not ok.any():
        raise PlanError(f"no passable cell within {SNAP_RADIUS_M:.0f} m of a route point")
    order = np.lexsort((cc[ok], rr[ok], d[ok]))  # nearest, then deterministic row/col tie-break
    i = order[0]
    return (int(rr[ok][i]), int(cc[ok][i])), float(d[ok][i])


def _route(cost: np.ndarray, cells: list[tuple[int, int]]) -> list[tuple[int, int]]:
    path: list[tuple[int, int]] = [cells[0]]
    for a, b in zip(cells[:-1], cells[1:], strict=True):
        mcp = MCP_Geometric(cost, fully_connected=True)
        costs, _ = mcp.find_costs(starts=[a], ends=[b])
        if not np.isfinite(costs[b]):
            raise PlanError("no route within planning limits inside the corridor")
        leg = [tuple(int(v) for v in p) for p in mcp.traceback(b)]
        path += leg[1:]
    return path


def _cells_to_latlon(window, cells) -> list[tuple[float, float]]:
    xs, ys = window.grid.centers
    x = np.array([xs[c] for _, c in cells])
    y = np.array([ys[r] for r, _ in cells])
    lat, lon = window.grid.to_latlon(x, y)
    return list(zip(lat.tolist(), lon.tolist(), strict=True))


def _vo(value, unit, evidence, ledger_id, **basis):
    return {"value": None if value is None else (round(value, 4) if isinstance(value, float) else value), "unit": unit,
            "evidence": evidence, "basis": basis, "source": {"ledger_id": ledger_id}}


def plan(request: dict) -> dict:
    mode = request.get("terrain_mode", "ladder")
    if mode not in ladder.TERRAIN_MODES:
        raise PlanError(f"terrain_mode must be one of {sorted(ladder.TERRAIN_MODES)}")
    overrides = dict(request.get("overrides") or {})
    if request.get("eva_hours") is not None:
        overrides["eva_duration_h"] = float(request["eva_hours"])
    params = config.resolve(overrides)
    v = config.values(params)
    base = resolve_point(request["base"])
    targets = [resolve_point(t) for t in request.get("targets", [])]
    if not targets or len(targets) > 5:
        raise PlanError("give 1 to 5 targets")
    points = [base, *targets]
    straight = sum(_distance_m(a, b) for a, b in zip(points[:-1], points[1:], strict=True))
    if straight > 8000:
        raise PlanError(f"straight-line route {straight:.0f} m exceeds the 8 km Marswalk planning cap")

    # 1. coarse pass
    lat0, lon0, half, res = _frame(points, COARSE_RES_M, CORRIDOR_BUFFER_M + 200)
    coarse = ladder.build_window(lat0, lon0, half, res, mode)
    ccost = _costs(_layers(coarse, v))
    try:
        ccells = [_snap(ccost, _cell(coarse, p), coarse.grid.res_m)[0] for p in points]
        cpath = _route(ccost, ccells)
        coarse_note = "coarse path found"
    except PlanError:
        cpath = [_cell(coarse, p) for p in points]  # corridor around the straight legs
        coarse_note = "no coarse path; corridor built around straight legs"
    coarse_ll = _cells_to_latlon(coarse, cpath)

    # 2-3. fine pass inside the corridor
    fine_res = float(request.get("res_m") or (FINE_RES_SHORT_M if straight < SHORT_ROUTE_M else FINE_RES_LONG_M))
    lat0, lon0, half, res = _frame(points + [{"lat": a, "lon": b} for a, b in coarse_ll], fine_res, CORRIDOR_BUFFER_M)
    fine = ladder.build_window(lat0, lon0, half, res, mode)
    computed = _layers(fine, v)
    cost = _costs(computed)
    corridor = np.ones(cost.shape, dtype=bool)
    xs, ys = fine.grid.to_xy(np.array([p[0] for p in coarse_ll]), np.array([p[1] for p in coarse_ll]))
    dense = evaluate.densify(np.column_stack([xs, ys]), fine.grid.res_m)
    rr, cc = fine.grid.to_rowcol(dense[:, 0], dense[:, 1])
    inside = (rr >= 0) & (rr < cost.shape[0]) & (cc >= 0) & (cc < cost.shape[1])
    corridor[np.rint(rr[inside]).astype(int), np.rint(cc[inside]).astype(int)] = False
    corridor = distance_transform_edt(corridor) * fine.grid.res_m <= CORRIDOR_BUFFER_M
    cost = np.where(corridor, cost, np.inf)
    warnings = []
    cells = []
    for p in points:
        cell, moved = _snap(cost, _cell(fine, p), fine.grid.res_m)
        if moved > 0:
            warnings.append(f"{p.get('label') or 'point'} moved {moved:.1f} m to the nearest cell within planning limits")
        cells.append(cell)
    try:
        path = _route(cost, cells)
        route_found = True
    except PlanError as exc:
        warnings.append(f"{exc}; showing the straight line for context only")
        path, route_found = cells, False
    latlon = _cells_to_latlon(fine, path)
    return assemble(fine, computed, latlon, v, params, request, points, warnings, route_found,
                    {"coarse_res_m": coarse.grid.res_m, "coarse_note": coarse_note, "fine_res_m": fine.grid.res_m,
                     "corridor_buffer_m": CORRIDOR_BUFFER_M, "straight_line_m": round(straight, 1)})


def assemble(window, computed, latlon, v, params, request, points, warnings, route_found, method,
             densify_path: bool = False) -> dict:
    ev = evaluate.evaluate(window, computed, latlon, v, densify_path=densify_path or not route_found)
    track = ev["track"]
    tp = eva_model.turnaround(ev["cum"], track["t_out"], track["t_back"], v["eva_duration_h"], v["reserve_fraction"])
    segs = evaluate.segments(ev, window)
    length = ev["length_m"]
    src_len = {}
    for s in segs:
        src_len[s["source"]] = src_len.get(s["source"], 0.0) + (s["to_m"] - s["from_m"])
    cls_stats = {}
    for s in segs:
        c = cls_stats.setdefault(s["class"], {"count": 0, "length_m": 0.0})
        c["count"] += 1
        c["length_m"] = round(c["length_m"] + s["to_m"] - s["from_m"], 1)
    energy_out = float(np.sum(track["e_out"]))
    energy_back = float(np.sum(track["e_back"]))
    usable_h = tp["usable_s"] / 3600
    outbound_h, return_h = tp["outbound_s"] / 3600, tp["return_s"] / 3600
    coarse_rung = any(s["source"] in ("CTX", "MOLA") for s in segs)
    unavailable = any(s["class"] == "UNAVAILABLE" for s in segs)
    if any(s["class"] == layers.CLASS_NAMES[3] for s in segs) or not tp["reached_target"] or not route_found:
        status = layers.CLASS_NAMES[3]
    elif any(s["class"] == layers.CLASS_NAMES[2] for s in segs) or coarse_rung or unavailable or warnings:
        status = layers.CLASS_NAMES[2]
    else:
        status = layers.CLASS_NAMES[1]
    reasons = []
    if not route_found:
        reasons.append("no route within planning limits")
    if not tp["reached_target"]:
        reasons.append(f"target lies beyond the turnaround point ({tp['distance_m']:.0f} m of {length:.0f} m)")
    if coarse_rung:
        reasons.append("part of the route relies on CTX/MOLA terrain (coarser than 1 m)")
    if unavailable:
        reasons.append("part of the route has unavailable terrain")
    if layers.CLASS_NAMES[3] in cls_stats:
        reasons.append(f"cells above the {v['slope_limit_deg']:g} deg slope limit (3 m baseline)")
    if "REVIEW REQUIRED" in cls_stats:
        reasons.append("segments above the review slope or roughness")
    pnr_lat, pnr_lon = float(ev["lat"][tp["index"]]), float(ev["lon"][tp["index"]])
    s1 = ev["slope_1m"][ev["src"] == 1]
    s3 = ev["slope_3m"]
    data_versions = sorted(({k: p.get(k) for k in ("product_id", "family", "ledger_id", "dtm_href")} for p in window.products),
                           key=lambda d: d["product_id"])
    request_norm = {"base": request["base"], "targets": request["targets"], "terrain_mode": window.mode,
                    "eva_hours": v["eva_duration_h"], "res_m": request.get("res_m"), "overrides": request.get("overrides") or {}}
    chash = config.config_hash(params)
    fingerprint = json.dumps({"request": request_norm, "config": chash, "data": data_versions,
                              "engines": [ENGINE_VERSION, ladder.ENGINE_VERSION]}, sort_keys=True)
    plan_id = hashlib.sha256(fingerprint.encode()).hexdigest()[:16]
    step = max(1, len(latlon) // 1500)
    display = latlon[::step] + ([latlon[-1]] if (len(latlon) - 1) % step else [])
    consum_out = eva_model.consumables(energy_out, v)
    consum_total = eva_model.consumables(energy_out + energy_back, v)
    source_ids = sorted({s["ledger_id"] for s in segs if s["ledger_id"]} | {
        "NEURONEXUS_MARSWALK_PLANNER", "NEURONEXUS_TERRAIN_LADDER", "NEURONEXUS_WALKABILITY", "NEURONEXUS_PACE_MODEL",
        "NEURONEXUS_METABOLIC_PROXY", "NEURONEXUS_PNR_MODEL", "NEURONEXUS_MARSWALK_PARAMETERS"} |
        {p["ledger_id"] for p in points if p.get("ledger_id")})
    return {
        "plan_id": plan_id, "engine_version": ENGINE_VERSION, "ladder_version": ladder.ENGINE_VERSION,
        "config_hash": chash, "data_versions": data_versions, "source_ids": source_ids,
        "request": request_norm, "points": points,
        "geometry": {"type": "LineString", "coordinates": [[round(lon, 7), round(lat, 7)] for lat, lon in display],
                     "vertices_full": len(latlon), "display_only": step > 1},
        "segments": segs, "profile": evaluate.profile(ev, tp["index"]),
        "turnaround": {"distance_m": round(tp["distance_m"], 1), "lat": round(pnr_lat, 7), "lon": round(pnr_lon, 7),
                       "reached_target": tp["reached_target"], "rule": "first point where outbound + walk-back time "
                       f">= (1 - {v['reserve_fraction']:g}) x {v['eva_duration_h']:g} h", "source": {"ledger_id": "NEURONEXUS_PNR_MODEL"}},
        "budget": {"eva_h": v["eva_duration_h"], "usable_h": round(usable_h, 4), "outbound_h": round(outbound_h, 4),
                   "return_h": round(return_h, 4), "reserve_h": round(v["eva_duration_h"] * v["reserve_fraction"], 4),
                   "margin_h": round(usable_h - outbound_h - return_h, 4), "pace_model": v["pace_model"],
                   "outbound": consum_out, "round_trip": consum_total,
                   "metabolic_kcal_est": round(consum_total["metabolic_kcal_est"]["value"], 1),
                   "o2_kg_est": round(consum_total["o2_kg_est"]["value"], 4),
                   "water_l_est": round(consum_total["water_l_est"]["value"], 3),
                   "mean_metabolic_rate_w": round(float(np.sum(track["e_out"]) / np.sum(track["t_out"])), 1),
                   "label": eva_model.METABOLIC_LABEL,
                   "sources": {"time": "NEURONEXUS_PACE_MODEL", "metabolic": "NEURONEXUS_METABOLIC_PROXY",
                               "turnaround": "NEURONEXUS_PNR_MODEL"}},
        "summary": {
            "length_m": _vo(round(length, 1), "m", "COMPUTED", "NEURONEXUS_MARSWALK_PLANNER", samples=len(ev["cum"])),
            "elevation_gain_m": _vo(round(float(np.nansum(np.clip(np.diff(ev["elev"]), 0, None))), 1), "m", "DERIVED",
                                    "NEURONEXUS_TERRAIN_LADDER", datum="MOLA areoid"),
            "elevation_loss_m": _vo(round(float(np.nansum(np.clip(-np.diff(ev["elev"]), 0, None))), 1), "m", "DERIVED",
                                    "NEURONEXUS_TERRAIN_LADDER", datum="MOLA areoid"),
            "max_slope_3m_deg": _vo(round(float(np.nanmax(s3)), 2) if np.isfinite(s3).any() else None, "deg", "DERIVED",
                                    "NEURONEXUS_SLOPE_MULTI_BASELINE", baseline_m="3 on HiRISE; rung gsd on CTX/MOLA"),
            "max_slope_1m_deg": _vo(round(float(np.nanmax(s1)), 2) if np.isfinite(s1).any() else None, "deg", "DERIVED",
                                    "NEURONEXUS_SLOPE_MULTI_BASELINE", baseline_m=1, rung="HiRISE only"),
            "segments_by_class": cls_stats,
            "length_by_source_pct": {k: round(100 * x / length, 1) if length else 0.0 for k, x in sorted(src_len.items())},
            "walk_back_margin_h": _vo(round(usable_h - outbound_h - return_h, 3), "h", "DERIVED", "NEURONEXUS_PNR_MODEL"),
        },
        "dose": {"status": "UNAVAILABLE", "reason": "RAD dose screening not attached to this plan",
                 "source": {"ledger_id": "NEURONEXUS_DOSE_SCREENING"}},
        "science_stops": science_stops(ev, points, window),
        "warnings": warnings, "method": method,
        "limitations": [LIMITATION_NOTE, eva_model.METABOLIC_LABEL, "Planning limits are not safety limits.",
                        "Walk-back assumes the same route in reverse."],
        "status": {"value": status, "reasons": reasons, "rule_text": config.status_rule_text(v)},
        "parameters": {k: {kk: vv for kk, vv in p.items()} for k, p in params.items()},
    }


def science_stops(ev: dict, points: list[dict], window) -> list[dict]:
    stops = [{"kind": "target", "name": p.get("label") or f"Target {i}", "lat": round(p["lat"], 7),
              "lon": round(p["lon"], 7), "source": {"ledger_id": "NEURONEXUS_MARSWALK_PLANNER"}}
             for i, p in enumerate(points[1:], start=1)]
    lat0, lon0 = window.grid.lat0, window.grid.lon0
    rx, ry = traverses.local_xy(ev["lat"], ev["lon"], lat0, lon0)
    for rover, meta in traverses.ROVERS.items():
        try:
            data = traverses.load(rover)
        except (OSError, FileNotFoundError):
            continue
        wps = [w for w in data["waypoints"] if abs(w["lat"] - lat0) < 0.1 and abs(w["lon"] - lon0) < 0.1]
        if not wps:
            continue
        wx, wy = traverses.local_xy(np.array([w["lat"] for w in wps]), np.array([w["lon"] for w in wps]), lat0, lon0)
        for w, x, y in zip(wps, wx, wy, strict=True):
            d = float(np.min(np.hypot(rx - x, ry - y)))
            if d <= 30.0:
                stops.append({"kind": "rover ground-truth station", "name": f"{meta['name']} end of drive, sol {w['sol']}",
                              "lat": w["lat"], "lon": w["lon"], "distance_from_route_m": round(d, 1),
                              "rover_tilt_deg": w["tilt"], "evidence": "OBSERVED",
                              "source": {"ledger_id": meta["waypoints_ledger"], "retrieved_at": data["retrieved_at"]}})
    return stops[:25]


def evaluate_polyline(request: dict) -> dict:
    """POST /marswalk/evaluate: metrics for a user-drawn or dragged polyline (no search)."""
    line = request.get("polyline") or []
    if not 2 <= len(line) <= 500:
        raise PlanError("polyline needs 2 to 500 [lat, lon] vertices")
    mode = request.get("terrain_mode", "ladder")
    if mode not in ladder.TERRAIN_MODES:
        raise PlanError(f"terrain_mode must be one of {sorted(ladder.TERRAIN_MODES)}")
    overrides = dict(request.get("overrides") or {})
    if request.get("eva_hours") is not None:
        overrides["eva_duration_h"] = float(request["eva_hours"])
    params = config.resolve(overrides)
    v = config.values(params)
    points = [resolve_point({"lat": a, "lon": b}) for a, b in line]
    # Repeated consecutive vertices (a drag dropped on its neighbour) give zero-length segments whose
    # slope is NaN, which broke the JSON response; drop them first.
    points = [p for i, p in enumerate(points) if i == 0 or _distance_m(points[i - 1], p) > 1e-6]
    if len(points) < 2:
        raise PlanError("polyline needs at least 2 distinct vertices")
    straight = sum(_distance_m(a, b) for a, b in zip(points[:-1], points[1:], strict=True))
    if straight > 8000:
        raise PlanError("polyline longer than the 8 km cap")
    res = float(request.get("res_m") or (FINE_RES_SHORT_M if straight < SHORT_ROUTE_M else FINE_RES_LONG_M))
    lat0, lon0, half, res = _frame(points, res, 100.0)
    window = ladder.build_window(lat0, lon0, half, res, mode)
    computed = _layers(window, v)
    req = {"base": line[0], "targets": line[1:], "res_m": request.get("res_m"), "overrides": request.get("overrides")}
    out = assemble(window, computed, [(p["lat"], p["lon"]) for p in points], v, params, req, points, [], True,
                   {"evaluated": "user polyline", "res_m": window.grid.res_m}, densify_path=True)
    out["science_stops"] = [s for s in out["science_stops"] if s["kind"] != "target"]
    return out
