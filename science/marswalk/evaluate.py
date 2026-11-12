"""Along-track metrics for any polyline at meter scale (POST /marswalk/evaluate and the planner).

The polyline is densified at the window resolution in the LocalGrid metric frame. Elevation is
sampled bilinearly; slope, roughness, class and source by nearest pixel. Full resolution is used
for every metric; only the returned profile is decimated (A10).
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import map_coordinates

from science.hires.ladder import SOURCE_NAMES, TerrainWindow
from science.hires.layers import CLASS_NAMES
from science.marswalk import eva_model

FAMILY_LEDGER = {1: "HIRISE_STAC_DTM", 2: "CTX_STAC_DTM", 3: "MOLA_MEGDR", 0: None}
PROFILE_MAX_ROWS = 2000


def densify(xy: np.ndarray, step_m: float) -> np.ndarray:
    pts = [xy[0]]
    for a, b in zip(xy[:-1], xy[1:], strict=True):
        n = max(1, int(np.ceil(np.hypot(*(b - a)) / step_m)))
        for k in range(1, n + 1):
            pts.append(a + (b - a) * k / n)
    return np.asarray(pts)


def _sample(window: TerrainWindow, layer: np.ndarray, xy: np.ndarray, order: int) -> np.ndarray:
    rows, cols = window.grid.to_rowcol(xy[:, 0], xy[:, 1])
    if order == 0:
        r = np.clip(np.rint(rows).astype(int), 0, layer.shape[0] - 1)
        c = np.clip(np.rint(cols).astype(int), 0, layer.shape[1] - 1)
        out = layer[r, c].astype("float64")
        inside = (rows >= -0.5) & (rows <= layer.shape[0] - 0.5) & (cols >= -0.5) & (cols <= layer.shape[1] - 0.5)
        return np.where(inside, out, np.nan)
    filled = np.nan_to_num(layer.astype("float64"), nan=0.0)
    vals = map_coordinates(filled, [rows, cols], order=1, mode="constant", cval=np.nan)
    # Any nodata among the 4 neighbors makes the bilinear sample nodata (no filling across gaps).
    bad = map_coordinates(np.isnan(layer).astype("float64"), [rows, cols], order=1, mode="constant", cval=1.0)
    return np.where(bad > 1e-9, np.nan, vals)


def evaluate(window: TerrainWindow, layers: dict, latlon: list[tuple[float, float]], v: dict,
             densify_path: bool = True) -> dict:
    """``densify_path=False`` for planner paths: the vertices already are the occupied pixel centers."""
    grid = window.grid
    lat = np.array([p[0] for p in latlon], dtype="float64")
    lon = np.array([p[1] for p in latlon], dtype="float64")
    x, y = grid.to_xy(lat, lon)
    pts = densify(np.column_stack([x, y]), grid.res_m) if densify_path else np.column_stack([x, y])
    elev = _sample(window, layers["elevation"], pts, 1)
    src = _sample(window, window.source.astype("float32"), pts, 0)
    cls = _sample(window, layers["walk_class"].astype("float32"), pts, 0)
    s3 = _sample(window, layers["slope_3m"], pts, 0)
    s3b = _sample(window, layers["slope_3m_baseline"], pts, 0)
    s1 = _sample(window, layers["slope_1m"], pts, 0) if "slope_1m" in layers else np.full(len(pts), np.nan)
    rough = _sample(window, layers["roughness_5m"], pts, 0)
    walk = _sample(window, layers["walkability"], pts, 0)
    prod = _sample(window, window.product_index.astype("float32"), pts, 0)
    ds = np.hypot(*np.diff(pts, axis=0).T)
    cum = np.concatenate([[0.0], np.cumsum(ds)])
    dz = np.diff(elev)
    valid_step = np.isfinite(dz)
    out_of_window = ~np.isfinite(src) | (np.nan_to_num(src) == 0)
    track = eva_model.along_track(ds, np.where(valid_step, dz, 0.0), rough[1:], v)
    lat_s, lon_s = grid.to_latlon(pts[:, 0], pts[:, 1])
    return {"pts": pts, "lat": lat_s, "lon": lon_s, "cum": cum, "ds": ds, "elev": elev, "src": src, "cls": cls,
            "slope_3m": s3, "slope_3m_baseline": s3b, "slope_1m": s1, "rough": rough, "walk": walk, "prod": prod,
            "track": track, "valid_step": valid_step, "outside": out_of_window, "length_m": float(cum[-1])}


def segments(ev: dict, window: TerrainWindow) -> list[dict]:
    """Consecutive samples with the same class and terrain source form one segment."""
    cls = np.nan_to_num(ev["cls"], nan=0).astype(int)
    src = np.nan_to_num(ev["src"], nan=0).astype(int)
    key = cls * 10 + src
    bounds = np.concatenate([[0], np.nonzero(np.diff(key))[0] + 1, [len(key)]])
    out = []
    for a, b in zip(bounds[:-1], bounds[1:], strict=True):
        sl = slice(a, b)
        code = int(src[a])
        idx = ev["prod"][sl]
        pid = int(np.nanmax(idx)) if np.isfinite(idx).any() else -1
        product = window.products[pid] if 0 <= pid < len(window.products) else None

        def mx(arr, sl=sl):
            seg = arr[sl]
            return round(float(np.nanmax(seg)), 2) if np.isfinite(seg).any() else None
        out.append({"from_m": round(float(ev["cum"][a]), 1), "to_m": round(float(ev["cum"][min(b, len(ev["cum"]) - 1)]), 1),
                    "class": CLASS_NAMES[int(cls[a])], "source": SOURCE_NAMES[code], "ledger_id": FAMILY_LEDGER[code],
                    "product_id": product["product_id"] if product else None,
                    "gsd_m": product.get("gsd_m") if product else None,
                    "max_slope_3m": mx(ev["slope_3m"]), "slope_baseline_m": mx(ev["slope_3m_baseline"]),
                    "max_slope_1m": mx(ev["slope_1m"]) if code == 1 else None,
                    "max_roughness_5m": mx(ev["rough"]),
                    "mean_walkability": round(float(np.nanmean(ev["walk"][sl])), 1) if np.isfinite(ev["walk"][sl]).any() else None})
    return out


def profile(ev: dict, pnr_index: int | None = None) -> dict:
    n = len(ev["cum"])
    step = max(1, int(np.ceil(n / PROFILE_MAX_ROWS)))
    idx = np.unique(np.concatenate([np.arange(0, n, step), [n - 1]]))
    t_cum = np.concatenate([[0.0], np.cumsum(ev["track"]["t_out"])]) / 3600.0

    def col(arr, d):
        return [None if not np.isfinite(a) else round(float(a), d) for a in arr[idx]]
    return {"rows": len(idx), "decimated_from": n, "display_only": step > 1,
            "distance_m": col(ev["cum"], 1), "elevation_m": col(ev["elev"], 2), "slope_3m_deg": col(ev["slope_3m"], 2),
            "slope_1m_deg": col(ev["slope_1m"], 2), "slope_3m_baseline_m": col(ev["slope_3m_baseline"], 1),
            "walkability": col(ev["walk"], 1), "class": [int(c) if np.isfinite(c) else 0 for c in ev["cls"][idx]],
            "source": [SOURCE_NAMES[int(s)] if np.isfinite(s) else "NONE" for s in ev["src"][idx]],
            "cum_time_h": col(t_cum, 4), "lat": col(ev["lat"], 7), "lon": col(ev["lon"], 7),
            "pnr_distance_m": None if pnr_index is None else round(float(ev["cum"][pnr_index]), 1)}
