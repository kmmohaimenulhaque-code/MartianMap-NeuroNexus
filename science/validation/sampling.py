"""Terrain samples at every rover waypoint, from the same products and checks as the console.

Per waypoint: elevation and slope at 1-100 m (best HiRISE DTM containing the point, 1 m LocalGrid),
elevation and slope at 20/100 m (the site's best CTX DTM, 5 m grid), elevation and 463 m slope (MOLA),
and seam differences (HiRISE averaged to 20 m minus CTX). Cached per site in data/cache/validation/.
"""
from __future__ import annotations

import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy.ndimage import map_coordinates
from shapely.geometry import Point, shape

from science import settings
from science.hires import catalog, datum, derivatives, ladder, reader
from science.hires.grid import LocalGrid
from science.rovers import traverses

SITES = {"gale": "msl", "jezero": "m2020"}
HIRISE_BASELINES = (1, 3, 5, 10, 20, 100)
CTX_BASELINES = (20, 100)
HIRISE_HALF_M, CTX_HALF_M, CTX_RES_M = 170.0, 400.0, 5.0
SEAM_BLOCK_M = 20.0
SAMPLER_VERSION = "sampling-1.0.0"


def _center(a: np.ndarray) -> float:
    """Bilinear value at the window center (the waypoint), NaN if any neighbor is nodata."""
    r = c = (a.shape[0] - 1) / 2.0
    vals = map_coordinates(np.nan_to_num(a.astype("float64"), nan=0.0), [[r], [c]], order=1)[0]
    bad = map_coordinates(np.isnan(a).astype("float64"), [[r], [c]], order=1)[0]
    return float("nan") if bad > 1e-9 else float(vals)


def mola_slope_at(lat: float, lon: float) -> float:
    grid = LocalGrid(lat, lon, 600.0, 50.0)
    d = 463.0
    z = {}
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr or dc:
                la, lo = grid.to_latlon(np.array([dc * d]), np.array([-dr * d]))
                z[(dr, dc)] = float(datum.SAMPLER.sample(la, lo, "t")[0])
    p = ((z[(-1, 1)] + 2 * z[(0, 1)] + z[(1, 1)]) - (z[(-1, -1)] + 2 * z[(0, -1)] + z[(1, -1)])) / (8 * d)
    q = ((z[(1, -1)] + 2 * z[(1, 0)] + z[(1, 1)]) - (z[(-1, -1)] + 2 * z[(-1, 0)] + z[(-1, 1)])) / (8 * d)
    return math.degrees(math.atan(math.hypot(p, q)))


def site_products(site: str, waypoints: list[dict]) -> tuple[list, object | None, list[dict]]:
    """Readable, datum-accepted, QA-passed HiRISE products and the single best CTX product for the traverse."""
    lats = [w["lat"] for w in waypoints]
    lons = [w["lon"] for w in waypoints]
    bbox = [min(lons) - 0.02, min(lats) - 0.02, max(lons) + 0.02, max(lats) + 0.02]
    excluded = []
    hirise = []
    for p in catalog.products_in_bbox(bbox, ("HIRISE",)):
        ladder._probe_and_check(p)
        (hirise if catalog.qa_pass(p) else excluded).append(p)
    ctx_candidates = [p for p in catalog.products_in_bbox(bbox, ("CTX",))]
    ctx_candidates.sort(key=lambda p: (-round(catalog.footprint_coverage(p, bbox), 3), p.gsd_m, catalog._negated(p.product_id)))
    ctx_ok = []
    for p in ctx_candidates[: catalog.CTX_PRESELECT]:
        ladder._probe_and_check(p)
        (ctx_ok if catalog.qa_pass(p) else excluded).append(p)
    ctx_ok.sort(key=lambda p: catalog.rank_key(p, bbox))
    info = [{"product_id": p.product_id, "family": p.family, "reason": p.asset_status.get("reason") or p.datum.get("status")}
            for p in excluded]
    return hirise, (ctx_ok[0] if ctx_ok else None), info


def sample_waypoint(wp: dict, hirise: list, ctx) -> dict:
    lat, lon = wp["lat"], wp["lon"]
    row = {k: wp.get(k) for k in ("RMC", "sol", "lat", "lon", "elev_geoid", "tilt", "roll", "pitch")}
    pt = Point(lon, lat)
    containing = [p for p in hirise if shape(p.geometry).buffer(0).contains(pt)]
    containing.sort(key=lambda p: catalog.rank_key(p, [lon - 1e-4, lat - 1e-4, lon + 1e-4, lat + 1e-4]))
    z_hi = None
    for p in containing:
        try:
            z, _ = reader.read_to_grid(p.dtm_href, LocalGrid(lat, lon, HIRISE_HALF_M, 1.0))
        except (OSError, ValueError):
            continue
        if not np.isfinite(_center(z)):
            continue
        z_hi = z
        row["hirise_product"] = p.product_id
        row["elev_hirise"] = _center(z)
        for b in HIRISE_BASELINES:
            row[f"slope_hirise_{b}"] = _center(derivatives.slope_at_baseline(z, 1.0, b)[0])
        break
    if ctx is not None and shape(ctx.geometry).buffer(0).contains(pt):
        try:
            zc, _ = reader.read_to_grid(ctx.dtm_href, LocalGrid(lat, lon, CTX_HALF_M, CTX_RES_M))
            if ctx.datum.get("convert") == "sphere_to_areoid":
                zc = zc + float(datum.SAMPLER.sphere_to_areoid_offset(np.array([lat]), np.array([lon]))[0])
            row["ctx_product"] = ctx.product_id
            row["elev_ctx"] = _center(zc)
            for b in CTX_BASELINES:
                row[f"slope_ctx_{b}"] = _center(derivatives.slope_at_baseline(zc, CTX_RES_M, b)[0])
            if z_hi is not None:
                k = int(SEAM_BLOCK_M)
                n = z_hi.shape[0] // k
                blocks = z_hi[: n * k, : n * k].reshape(n, k, n, k)
                with np.errstate(invalid="ignore"):
                    hi20 = blocks.mean(axis=(1, 3))  # any nodata in a block -> NaN
                centers = -HIRISE_HALF_M + SEAM_BLOCK_M * (np.arange(n) + 0.5)
                rr = (CTX_HALF_M - centers) / CTX_RES_M - 0.5
                cc = (centers + CTX_HALF_M) / CTX_RES_M - 0.5
                R, C = np.meshgrid(rr, cc, indexing="ij")
                ctx_at = map_coordinates(np.nan_to_num(zc, nan=np.nan), [R, C], order=1, mode="constant", cval=np.nan)
                diff = (hi20 - ctx_at)[np.isfinite(hi20) & np.isfinite(ctx_at)]
                if diff.size:
                    row["seam_hirise_ctx_median_m"] = float(np.median(diff))
                    row["seam_hirise_ctx_n"] = int(diff.size)
        except (OSError, ValueError):
            pass
    try:
        row["elev_mola"] = float(datum.SAMPLER.sample(np.array([lat]), np.array([lon]), "t")[0])
        row["slope_mola_463"] = mola_slope_at(lat, lon)
    except (OSError, ValueError, FileNotFoundError):
        pass
    return row


def samples(site: str, *, workers: int = 8, refresh: bool = False) -> dict:
    data = traverses.load(SITES[site])
    waypoints = [w for w in data["waypoints"] if w["lat"] is not None and w["lon"] is not None]
    hirise, ctx, excluded = site_products(site, waypoints)
    key = hashlib.sha256(json.dumps({"v": SAMPLER_VERSION, "ladder": ladder.ENGINE_VERSION, "n": len(waypoints),
                                     "last": waypoints[-1].get("RMC"), "hirise": sorted(p.product_id for p in hirise),
                                     "ctx": ctx.product_id if ctx else None}, sort_keys=True).encode()).hexdigest()[:16]
    cache = settings.cache_root() / "validation"
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"{site}_samples_{key}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        rows = list(pool.map(lambda w: sample_waypoint(w, hirise, ctx), waypoints))
    out = {"site": site, "rover": SITES[site], "key": key, "rows": rows, "rover_retrieved_at": data["retrieved_at"],
           "rover_origin": data["origin"], "hirise_products": sorted(p.product_id for p in hirise),
           "ctx_product": ctx.product_id if ctx else None, "excluded": excluded,
           "datum_checks": {p.product_id: {k: p.datum.get(k) for k in ("status", "median_m", "nmad_m", "n")}
                            for p in [*hirise, *([ctx] if ctx else [])]}}
    path.write_text(json.dumps(out), encoding="utf-8")
    return out
