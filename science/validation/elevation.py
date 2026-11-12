"""V1 elevation consistency (rover vs DTMs) and V2 independent vertical check (MOLA shots vs DTMs)."""
from __future__ import annotations

import csv
import io
import json

import numpy as np
import rasterio
from pyproj import Transformer
from scipy.ndimage import map_coordinates
from shapely.geometry import box, shape

from science import settings
from science.hires import catalog, datum, reader, stac
from science.hires.grid import GEOGRAPHIC_CRS
from science.validation import stats

MAX_SHOT_PRODUCTS = 4


def column(rows, key) -> np.ndarray:
    return np.array([np.nan if r.get(key) is None else r[key] for r in rows], dtype="float64")


def v1(rows: list[dict]) -> dict:
    rover = column(rows, "elev_geoid")
    out = {"metric": "rover elev_geoid minus DTM elevation at the waypoint", "unit": "m"}
    for fam in ("hirise", "ctx", "mola"):
        out[fam] = stats.summarize_diff(rover - column(rows, f"elev_{fam}"))
    out["caveat"] = ("Rover localization is registered to HiRISE base maps and the DTMs are tied to MOLA: a consistency "
                     "check, not an accuracy check.")
    return out


def _shots(product) -> np.ndarray:
    cache = settings.cache_root() / "validation" / "mola_shots"
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"{product.product_id}.json"
    if path.exists():
        return np.array(json.loads(path.read_text()), dtype="float64").reshape(-1, 3)
    response = stac._request("GET", product.mola_csv_href)
    response.raise_for_status()
    rows = []
    for rec in csv.DictReader(io.StringIO(response.text)):
        try:
            rows.append([float(rec["latitude"]), float(rec["longitude"]), float(rec["radius"])])
        except (KeyError, TypeError, ValueError):
            continue
    path.write_text(json.dumps(rows))
    return np.array(rows, dtype="float64").reshape(-1, 3)


def _sample_product(href: str, lat: np.ndarray, lon: np.ndarray, factor_cap: int = 4) -> np.ndarray:
    """Bilinear DTM heights at points (NaN outside or on nodata), read once at a modest overview."""
    out = np.full(lat.shape, np.nan)
    with rasterio.Env(**reader.GDAL_ENV), rasterio.open(reader.open_path(href)) as ds:
        factor = max([1, *[o for o in ds.overviews(1) if o <= factor_cap]])
        shape_ = (ds.height // factor, ds.width // factor)
        z = ds.read(1, out_shape=shape_).astype("float64")
        z[~reader._valid(z, ds.nodata)] = np.nan
        x, y = Transformer.from_crs(GEOGRAPHIC_CRS, ds.crs, always_xy=True).transform(lon, lat)
        col, row = ~ds.transform * (np.asarray(x), np.asarray(y))
        col, row = col / factor - 0.5, row / factor - 0.5
    inside = (row >= 0) & (col >= 0) & (row <= shape_[0] - 1) & (col <= shape_[1] - 1)
    if inside.any():
        vals = map_coordinates(np.nan_to_num(z, nan=0.0), [row[inside], col[inside]], order=1)
        bad = map_coordinates(np.isnan(z).astype("float64"), [row[inside], col[inside]], order=1)
        out[inside] = np.where(bad > 1e-9, np.nan, vals)
    return out


def v2(rows: list[dict], hirise: list, ctx) -> dict:
    lats, lons = column(rows, "lat"), column(rows, "lon")
    bbox = [float(np.nanmin(lons)) - 0.02, float(np.nanmin(lats)) - 0.02, float(np.nanmax(lons)) + 0.02, float(np.nanmax(lats)) + 0.02]
    window = box(*bbox)
    shot_products = [p for p in catalog.products_in_bbox(bbox, ("CTX",)) if p.mola_csv_href]
    shot_products.sort(key=lambda p: (-shape(p.geometry).buffer(0).intersection(window).area, p.product_id))
    shot_products = shot_products[:MAX_SHOT_PRODUCTS]
    shots = []
    for p in shot_products:
        try:
            shots.append(_shots(p))
        except (OSError, ValueError):
            continue
    if not shots:
        return {"status": "UNAVAILABLE", "reason": "no CTX item with a mola_csv asset intersects the traverse"}
    s = np.unique(np.vstack(shots), axis=0)
    keep = (s[:, 0] >= bbox[1]) & (s[:, 0] <= bbox[3]) & (s[:, 1] >= bbox[0]) & (s[:, 1] <= bbox[2])
    s = s[keep]
    lat, lon = s[:, 0], s[:, 1]
    h = s[:, 2] - datum.SAMPLER.areoid_radius(lat, lon)
    out = {"metric": "MOLA shot height above the areoid minus DTM elevation", "unit": "m", "shots": int(len(s)),
           "shot_sources": [p.product_id for p in shot_products]}
    hi = np.full(lat.shape, np.nan)
    for p in hirise:
        vals = _sample_product(p.dtm_href, lat, lon)
        hi = np.where(np.isnan(hi), vals, hi)
    out["hirise"] = stats.summarize_diff(h - hi)
    if ctx is not None:
        out["ctx"] = stats.summarize_diff(h - _sample_product(ctx.dtm_href, lat, lon, factor_cap=1))
    out["caveat"] = ("CTX DTMs were aligned to MOLA with pc_align, so CTX-vs-shots is not independent; HiRISE-vs-shots is "
                     "the stronger check.")
    return out
