"""Meter-scale hazard derivatives on a LocalGrid (Appendix A2-A4).

Slope at baseline b: the DTM is area-averaged to spacing b (a sliding box of s = round(b/res)
pixels, odd-sized) and Horn's 3x3 stencil is applied with neighbors s pixels apart, so the
result is the slope of the surface resampled to spacing b, evaluated at every pixel. The
baseline actually used (s * res, never finer than the source gsd) is returned with it.
Every hi-res product carries LIMITATION_NOTE.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.ndimage import correlate1d, maximum_filter, minimum_filter, uniform_filter

BASELINES_M = (1, 2, 3, 5, 10, 20, 100, 463)
ROUGHNESS_WINDOWS_M = (5, 25)
LIMITATION_NOTE = ("Features below DTM resolution (rocks under 1-2 m, ripples, regolith strength) "
                   "are not represented.")


def _box_mean(z: np.ndarray, k: int) -> np.ndarray:
    """NaN-aware k x k mean; any window touching nodata is nodata (no filling)."""
    if k <= 1:
        return z.astype("float64")
    valid = np.isfinite(z)
    total = uniform_filter(np.where(valid, z, 0.0).astype("float64"), size=k, mode="constant")
    count = uniform_filter(valid.astype("float64"), size=k, mode="constant")
    del valid
    out = np.full(z.shape, np.nan)
    # Same division as total[full] / count[full], without the three masked copies.
    np.divide(total, count, out=out, where=count > 1.0 - 1e-6)
    return out


def _shift(z: np.ndarray, dr: int, dc: int) -> np.ndarray:
    """z[r + dr, c + dc] with NaN outside the array."""
    out = np.full(z.shape, np.nan)
    rows, cols = z.shape
    rs, re = max(0, -dr), min(rows, rows - dr)
    cs, ce = max(0, -dc), min(cols, cols - dc)
    if rs < re and cs < ce:
        out[rs:re, cs:ce] = z[rs + dr:re + dr, cs + dc:ce + dc]
    return out


def horn_gradient(z: np.ndarray, spacing_m: float, step: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """(dz/dx east, dz/dy north) with Horn's weights; neighbors ``step`` pixels apart.

    Row 0 is north, so A2's q (rows increasing southward) equals -dz/dy_north. Pixels whose
    stencil leaves the array or touches nodata are NaN.
    """
    s = step
    zp = np.pad(z.astype("float64", copy=False), s, mode="constant", constant_values=np.nan)
    rows, cols = z.shape

    def at(dr, dc):  # view of z[r + dr, c + dc]
        return zp[s + dr:s + dr + rows, s + dc:s + dc + cols]

    z1, z2, z3 = at(-s, -s), at(-s, 0), at(-s, s)
    z4, z6 = at(0, -s), at(0, s)
    z7, z8, z9 = at(s, -s), at(s, 0), at(s, s)
    d = 8.0 * spacing_m * s
    # p = ((z3 + z9 + 2 z6) - (z1 + z7 + 2 z4)) / d and the same for q, evaluated in that order
    # with in-place operations: identical results, a third of the temporaries.
    tmp = np.multiply(2.0, z6)
    p = np.add(z3, z9)
    p += tmp
    rest = np.add(z1, z7)
    np.multiply(2.0, z4, out=tmp)
    rest += tmp
    p -= rest
    p /= d
    q = np.add(z7, z9)
    np.multiply(2.0, z8, out=tmp)
    q += tmp
    np.add(z1, z3, out=rest)
    np.multiply(2.0, z2, out=tmp)
    rest += tmp
    q -= rest
    q /= d
    del tmp, rest
    np.negative(q, out=q)  # q_south -> dz/dy north
    return p, q


def baseline_step(baseline_m: float, res_m: float) -> int:
    return max(1, int(round(baseline_m / res_m)))


def slope_at_baseline(z: np.ndarray, res_m: float, baseline_m: float) -> tuple[np.ndarray, float]:
    """(slope in degrees, effective baseline in m)."""
    step = baseline_step(baseline_m, res_m)
    box = step if step % 2 == 1 else step + 1
    p, q = horn_gradient(_box_mean(z, box), res_m, step)
    np.hypot(p, q, out=p)
    del q
    np.arctan(p, out=p)
    np.degrees(p, out=p)
    return p, step * res_m


def directional_slope(p: np.ndarray, q_north: np.ndarray, azimuth_deg: float) -> np.ndarray:
    """A3: signed slope along travel azimuth (clockwise from north); uphill positive."""
    a = math.radians(azimuth_deg)
    return np.degrees(np.arctan(p * math.sin(a) + q_north * math.cos(a)))


def detrended_roughness(z: np.ndarray, res_m: float, window_m: float) -> np.ndarray:
    """A4: RMS of residuals from a least-squares plane over a w x w window (sliding, NaN-aware)."""
    k = max(3, int(round(window_m / res_m)) | 1)
    h = k // 2
    valid = np.isfinite(z)
    ref = float(np.nanmedian(z)) if valid.any() else 0.0  # subtract a reference to avoid cancellation
    zf = np.where(valid, z - ref, 0.0).astype("float64")
    ones = np.ones(k)
    ramp = np.arange(-h, h + 1, dtype="float64")
    n = float(k * k)

    def box(a):
        return correlate1d(correlate1d(a, ones, axis=0, mode="constant"), ones, axis=1, mode="constant")

    partial = box(valid.astype("float64")) < n - 1e-6
    del valid
    s_xx = k * float(np.sum(ramp * ramp))  # same for y on a square window
    # var = s_zz / n - mean ** 2 - (s_xz ** 2 + s_yz ** 2) / (s_xx * n), mean = s_z / n, evaluated
    # in that order with in-place operations (identical results, far fewer full-size temporaries).
    var = box(np.square(zf))
    var /= n
    mean = box(zf)
    mean /= n
    np.square(mean, out=mean)
    var -= mean
    del mean
    s_xz = correlate1d(correlate1d(zf, ones, axis=0, mode="constant"), ramp, axis=1, mode="constant")
    np.square(s_xz, out=s_xz)
    s_yz = correlate1d(correlate1d(zf, ramp, axis=0, mode="constant"), ones, axis=1, mode="constant")
    del zf
    np.square(s_yz, out=s_yz)
    s_xz += s_yz
    del s_yz
    s_xz /= s_xx * n
    var -= s_xz
    del s_xz
    np.clip(var, 0.0, None, out=var)
    np.sqrt(var, out=var)
    var[partial] = np.nan
    return var


def local_relief_3x3(z: np.ndarray) -> np.ndarray:
    """The legacy 3x3 elevation range, kept under its honest name."""
    valid = np.isfinite(z)
    hi = maximum_filter(np.where(valid, z, -np.inf), size=3, mode="constant", cval=-np.inf)
    lo = minimum_filter(np.where(valid, z, np.inf), size=3, mode="constant", cval=np.inf)
    out = hi - lo
    out[uniform_filter((~valid).astype("float32"), size=3, mode="constant", cval=1.0) > 1e-6] = np.nan
    return out


def max_step_per_pixel(z: np.ndarray) -> np.ndarray:
    """DERIVED edge proxy: largest height change (m) to a 4-neighbor, one pixel away. Not a rock map."""
    diffs = [np.abs(_shift(z, dr, dc) - z) for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))]
    return np.max(np.stack(diffs), axis=0)
