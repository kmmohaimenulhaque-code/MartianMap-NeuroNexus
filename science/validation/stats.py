"""Validation statistics (Appendix A9): bias, RMSE, NMAD, Spearman, bootstrap CIs, Hausdorff, discrete Frechet."""
from __future__ import annotations

import math

import numpy as np
from scipy.stats import spearmanr

SEED = 2026
N_BOOT = 1000


def nmad(d) -> float:
    d = np.asarray(d, dtype="float64")
    return float(1.4826 * np.median(np.abs(d - np.median(d))))


def rmse(d) -> float:
    d = np.asarray(d, dtype="float64")
    return float(np.sqrt(np.mean(d * d)))


def spearman(x, y) -> float:
    rho = spearmanr(x, y).statistic
    return float(rho) if np.isfinite(rho) else float("nan")


def p90_ratio(tilt, slope) -> float:
    s = np.percentile(slope, 90)
    return float(np.percentile(tilt, 90) / s) if s > 0 else float("inf")


def bootstrap(stat, *arrays, n: int = N_BOOT, seed: int = SEED) -> tuple[float, list[float]]:
    """Point estimate and 95% percentile CI, resampling rows of the paired arrays together."""
    arrays = [np.asarray(a, dtype="float64") for a in arrays]
    point = stat(*arrays)
    size = len(arrays[0])
    if size < 3:
        return float(point), [float("nan"), float("nan")]
    rng = np.random.default_rng(seed)
    values = np.empty(n)
    for i in range(n):
        idx = rng.integers(0, size, size)
        values[i] = stat(*(a[idx] for a in arrays))
    values = values[np.isfinite(values)]
    lo, hi = (np.percentile(values, [2.5, 97.5]) if values.size else (float("nan"), float("nan")))
    return float(point), [float(lo), float(hi)]


def summarize_diff(d) -> dict:
    d = np.asarray(d, dtype="float64")
    d = d[np.isfinite(d)]
    if d.size < 3:
        return {"n": int(d.size), "status": "INSUFFICIENT DATA"}
    bias, bias_ci = bootstrap(np.mean, d)
    r, r_ci = bootstrap(rmse, d)
    m, m_ci = bootstrap(nmad, d)
    return {"n": int(d.size), "bias_m": bias, "bias_ci95": bias_ci, "rmse_m": r, "rmse_ci95": r_ci,
            "nmad_m": m, "nmad_ci95": m_ci, "median_m": float(np.median(d))}


def summarize_slope(tilt, slope) -> dict:
    tilt, slope = np.asarray(tilt, dtype="float64"), np.asarray(slope, dtype="float64")
    ok = np.isfinite(tilt) & np.isfinite(slope)
    tilt, slope = tilt[ok], slope[ok]
    if tilt.size < 10:
        return {"n": int(tilt.size), "status": "INSUFFICIENT DATA"}
    rho, rho_ci = bootstrap(spearman, tilt, slope)
    bias, bias_ci = bootstrap(lambda t, s: float(np.mean(s - t)), tilt, slope)
    ratio, ratio_ci = bootstrap(p90_ratio, tilt, slope)
    return {"n": int(tilt.size), "spearman_rho": rho, "spearman_ci95": rho_ci, "bias_deg": bias, "bias_ci95": bias_ci,
            "p90_ratio": ratio, "p90_ratio_ci95": ratio_ci, "p90_tilt_deg": float(np.percentile(tilt, 90)),
            "p90_slope_deg": float(np.percentile(slope, 90)), "median_slope_deg": float(np.median(slope))}


def resample(line: np.ndarray, step: float) -> np.ndarray:
    """Points every ``step`` meters along an (n, 2) metric polyline (endpoints kept)."""
    seg = np.hypot(*np.diff(line, axis=0).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    if cum[-1] == 0:
        return line[:1]
    s = np.append(np.arange(0.0, cum[-1], step), cum[-1])
    return np.column_stack([np.interp(s, cum, line[:, 0]), np.interp(s, cum, line[:, 1])])


def hausdorff(a: np.ndarray, b: np.ndarray) -> float:
    d = np.hypot(a[:, None, 0] - b[None, :, 0], a[:, None, 1] - b[None, :, 1])
    return float(max(d.min(axis=1).max(), d.min(axis=0).max()))


def discrete_frechet(a: np.ndarray, b: np.ndarray) -> float:
    """Eiter and Mannila (1994) dynamic program."""
    d = np.hypot(a[:, None, 0] - b[None, :, 0], a[:, None, 1] - b[None, :, 1])
    n, m = d.shape
    ca = np.full((n, m), math.inf)
    ca[0, 0] = d[0, 0]
    for i in range(1, n):
        ca[i, 0] = max(ca[i - 1, 0], d[i, 0])
    for j in range(1, m):
        ca[0, j] = max(ca[0, j - 1], d[0, j])
    for i in range(1, n):
        prev = ca[i - 1]
        row = ca[i]
        for j in range(1, m):
            row[j] = max(min(prev[j], prev[j - 1], row[j - 1]), d[i, j])
    return float(ca[-1, -1])


def length(line: np.ndarray) -> float:
    return float(np.sum(np.hypot(*np.diff(line, axis=0).T)))


def point_to_polyline(points: np.ndarray, line: np.ndarray) -> np.ndarray:
    """Distance from each point to the nearest segment of a metric polyline."""
    a, b = line[:-1], line[1:]
    ab = b - a
    denom = np.maximum((ab * ab).sum(axis=1), 1e-12)
    ap = points[:, None, :] - a[None, :, :]
    t = np.clip((ap * ab[None]).sum(axis=2) / denom[None], 0.0, 1.0)
    closest = a[None] + t[..., None] * ab[None]
    return np.hypot(*(points[:, None, :] - closest).transpose(2, 0, 1)).min(axis=1)


def share_within(a: np.ndarray, b: np.ndarray, tol: float) -> float:
    """Share of the points of a that lie within tol meters of polyline b."""
    if len(b) < 2:
        return float(np.mean(np.hypot(*(a - b[0]).T) <= tol))
    return float(np.mean(point_to_polyline(a, b) <= tol))
