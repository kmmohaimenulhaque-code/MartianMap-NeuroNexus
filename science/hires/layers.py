"""Analytic layers on a TerrainWindow: slope per rung at an honest baseline, roughness,
walkability (A5) and planning classes. Also renders the PNG overlays.

A slope "at 3 m" on a CTX pixel is computed at that rung's own gsd (20 m), and on MOLA at
463 m: the effective baseline raster says which, so baselines are never silently mixed.
"""
from __future__ import annotations

import io
import warnings

import numpy as np
from PIL import Image

from science.hires import derivatives, palette
from science.hires.ladder import NOMINAL_GSD_M, TerrainWindow

CLASS_NAMES = {0: "UNAVAILABLE", 1: "WITHIN PLANNING LIMITS", 2: "REVIEW REQUIRED", 3: "EXCEEDS PLANNING LIMIT"}


def composite_slope(window: TerrainWindow, baseline_m: float, cache: dict | None = None):
    """(slope deg, effective baseline m) per pixel, each rung at max(baseline, its gsd)."""
    res = window.grid.res_m
    cache = {} if cache is None else cache
    slope = np.full(window.grid.shape, np.nan, dtype="float32")
    effective = np.full(window.grid.shape, np.nan, dtype="float32")
    for code in (1, 2, 3):
        sel = window.source == code
        if not sel.any():
            continue
        step = derivatives.baseline_step(max(baseline_m, NOMINAL_GSD_M[code]), res)
        if step not in cache:
            cache[step] = derivatives.slope_at_baseline(window.elevation, res, step * res)
        values, eff = cache[step]
        slope[sel] = values[sel]
        effective[sel] = eff
    return slope, effective


def hirise_roughness(window: TerrainWindow, window_m: float) -> np.ndarray:
    """Detrended roughness on HiRISE pixels only; coarser rungs cannot resolve it (NaN)."""
    z = np.where(window.source == 1, window.elevation, np.nan)
    return derivatives.detrended_roughness(z, window.grid.res_m, window_m).astype("float32")


def walkability(slope3: np.ndarray, rough5: np.ndarray, v: dict) -> tuple[np.ndarray, np.ndarray]:
    """A5 walkability 0-100 and class codes (0 unavailable, 1 within, 2 review, 3 exceed)."""
    slope_term = np.minimum(slope3 / v["slope_limit_deg"], 1.0)
    rough_term = np.where(np.isfinite(rough5), np.minimum(rough5 / v["walk_ref_roughness_m"], 1.0), 0.0)
    cost = v["walk_weight_slope"] * slope_term + v["walk_weight_roughness"] * rough_term
    walk = (100.0 * (1.0 - np.minimum(cost, 1.0))).astype("float32")
    cls = np.ones(slope3.shape, dtype="uint8")
    review = (slope3 > v["slope_review_deg"]) | (np.isfinite(rough5) & (rough5 > v["roughness_review_m"]))
    cls[review] = 2
    cls[slope3 > v["slope_limit_deg"]] = 3
    unavailable = ~np.isfinite(slope3)
    cls[unavailable] = 0
    walk[unavailable] = np.nan
    return walk, cls


DEFAULT_BASELINES = (1, 3, 5, 20, 100, 463)


def compute(window: TerrainWindow, v: dict, baselines=DEFAULT_BASELINES, extras: bool = True) -> dict[str, np.ndarray]:
    """Analytic layers; ``extras`` adds 25 m roughness and the legacy 3x3 local relief."""
    layers: dict[str, np.ndarray] = {"elevation": window.elevation, "source": window.source}
    cache: dict = {}
    for b in sorted(set(baselines) | {3}):
        layers[f"slope_{b}m"], layers[f"slope_{b}m_baseline"] = composite_slope(window, b, cache)
    layers["roughness_5m"] = hirise_roughness(window, 5)
    if extras:
        layers["roughness_25m"] = hirise_roughness(window, 25)
        layers["local_relief_3x3"] = derivatives.local_relief_3x3(window.elevation).astype("float32")
    layers["walkability"], layers["walk_class"] = walkability(layers["slope_3m"], layers["roughness_5m"], v)
    return layers


def stats(values: np.ndarray, groups: np.ndarray | None = None) -> dict:
    def one(a):
        a = a[np.isfinite(a)]
        if a.size == 0:
            return {"n": 0, "status": "UNAVAILABLE"}
        return {"n": int(a.size), "min": float(a.min()), "mean": float(a.mean()), "p90": float(np.percentile(a, 90)),
                "max": float(a.max())}
    if groups is None:
        return one(values)
    return {f"{g:g}": one(values[groups == g]) for g in np.unique(groups[np.isfinite(groups)])}


# ---------------------------------------------------------------------------------------- images
def _png(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", compress_level=3)
    return buf.getvalue()


def _downsample(a: np.ndarray, max_side: int, nearest: bool) -> np.ndarray:
    step = int(np.ceil(max(a.shape) / max_side))
    if step <= 1:
        return a
    if nearest:
        return a[::step, ::step]
    rows, cols = (a.shape[0] // step) * step, (a.shape[1] // step) * step
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-nodata blocks stay NaN
        return np.nanmean(a[:rows, :cols].reshape(rows // step, step, cols // step, step), axis=(1, 3))


def hillshade(z: np.ndarray, res_m: float, azimuth=315.0, altitude=45.0) -> np.ndarray:
    p, q = derivatives.horn_gradient(z.astype("float64"), res_m, 1)
    slope = np.arctan(np.hypot(p, q))
    aspect = np.arctan2(-p, -q)  # direction of steepest descent, clockwise from north
    az, alt = np.radians(azimuth), np.radians(altitude)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)


def ramp_rgb(walk: np.ndarray) -> np.ndarray:
    lo, mid, hi = (np.array(c, dtype="float64") for c in palette.RAMP)
    t = np.clip(walk / 100.0, 0, 1)[..., None]
    first = lo + (mid - lo) * np.clip(t * 2, 0, 1)
    second = mid + (hi - mid) * np.clip(t * 2 - 1, 0, 1)
    return np.where(t < 0.5, first, second).astype("uint8")


def render(layer: str, window: TerrainWindow, layers: dict, max_side: int = 1024, ortho: np.ndarray | None = None) -> bytes:
    res = window.grid.res_m
    if layer == "hillshade":
        shade = _downsample(hillshade(window.elevation, res), max_side, False)
        gray = (np.nan_to_num(shade, nan=0.0) * 255).astype("uint8")
        alpha = np.where(np.isfinite(shade), 255, 0).astype("uint8")
        return _png(np.dstack([gray, gray, gray, alpha]))
    if layer == "ortho":
        if ortho is None:
            raise ValueError("no orthoimage available for this window")
        img = _downsample(ortho, max_side, False)
        valid = np.isfinite(img)
        lo, hi = (np.percentile(img[valid], [2, 98]) if valid.any() else (0, 1))
        gray = np.clip((img - lo) / max(hi - lo, 1e-6) * 255, 0, 255)
        gray = np.where(valid, gray, 0).astype("uint8")
        return _png(np.dstack([gray, gray, gray, np.where(valid, 255, 0).astype("uint8")]))
    if layer == "source":
        src = _downsample(window.source, max_side, True)
        rgba = np.zeros(src.shape + (4,), dtype="uint8")
        for code, color in palette.SOURCE_RGB.items():
            rgba[src == code] = (*color, 150)
        return _png(rgba)
    if layer == "walkability":
        walk = _downsample(layers["walkability"], max_side, True)
        cls = _downsample(layers["walk_class"], max_side, True)
        rgba = np.zeros(walk.shape + (4,), dtype="uint8")
        rgba[..., :3] = ramp_rgb(np.nan_to_num(walk, nan=0.0))
        rgba[..., 3] = np.where(np.isfinite(walk), 170, 0)
        rr, cc = np.indices(walk.shape)
        hatch = (cls == 3) & (((rr + cc) // 3) % 3 == 0)  # EXCEED is hatched, never color alone
        rgba[hatch] = (*palette.rgb("--nn-walk-hatch"), 235)
        return _png(rgba)
    if layer.startswith("slope"):
        key = layer if layer in layers else "slope_3m"
        s = _downsample(layers[key], max_side, True)
        t = np.clip(np.nan_to_num(s, nan=0.0) / 35.0, 0, 1) * 100.0
        rgba = np.zeros(s.shape + (4,), dtype="uint8")
        rgba[..., :3] = ramp_rgb(100.0 - t)
        rgba[..., 3] = np.where(np.isfinite(s), 170, 0)
        return _png(rgba)
    raise ValueError(f"unknown layer: {layer}")
