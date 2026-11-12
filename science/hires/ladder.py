"""Terrain resolution ladder: a per-pixel priority mosaic HiRISE -> CTX -> MOLA.

Analytics never blend products: each pixel takes the best-ranked valid product, and a
uint8 source raster records the rung (1 HiRISE, 2 CTX, 3 MOLA, 0 none). A provenance table
lists every product used or excluded, with its datum check and why. Seams are flagged.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field

import numpy as np

from science.hires import catalog, datum, reader, stac
from science.hires.catalog import FAMILY_CODE, MOLA_GSD_M, Product
from science.hires.grid import LocalGrid
from science.terrain import mola_store

ENGINE_VERSION = "ladder-1.0.0"
TERRAIN_MODES = {"ladder": ("HIRISE", "CTX", "MOLA"), "ctx_mola": ("CTX", "MOLA"), "mola": ("MOLA",)}
SOURCE_NAMES = {0: "NONE", 1: "HIRISE", 2: "CTX", 3: "MOLA"}
NOMINAL_GSD_M = {1: 1.0, 2: 20.0, 3: MOLA_GSD_M}
SEAM_STEP_FLAG_M = 2.0
_cache: OrderedDict[str, TerrainWindow] = OrderedDict()
_cache_lock = threading.Lock()
CACHE_WINDOWS = 6


@dataclass
class TerrainWindow:
    grid: LocalGrid
    mode: str
    elevation: np.ndarray
    source: np.ndarray
    product_index: np.ndarray
    products: list[dict]
    excluded: list[dict]
    seams: np.ndarray
    seam_steps: list[dict]
    timings_s: dict = field(default_factory=dict)

    def source_fractions(self) -> dict[str, float]:
        total = self.source.size
        return {SOURCE_NAMES[c]: float((self.source == c).sum() / total) for c in (1, 2, 3, 0)}

    def gsd_for(self, code: int) -> float:
        return NOMINAL_GSD_M[code]

    def data_versions(self) -> list[dict]:
        return [{k: p.get(k) for k in ("product_id", "family", "ledger_id", "dtm_href", "datum_checked_at",
                                       "retrieved_at")} for p in self.products]


def _probe_and_check(product: Product) -> Product:
    product.asset_status = stac.probe_asset(product.dtm_href)
    if product.asset_status["status"] == "OK":
        try:
            product.datum = datum.check_product(product)
        except (OSError, ValueError, FileNotFoundError) as exc:
            product.datum = {"accepted": False, "status": "UNREADABLE", "reason": str(exc)[:200]}
        if product.family == "CTX" and product.qa_href:
            product.qa = catalog.fetch_qa(product)
    return product


def _exclusion(product: Product, reason: str) -> dict:
    return {"product_id": product.product_id, "family": product.family, "ledger_id": product.ledger_id,
            "status": "UNAVAILABLE" if "HTTP" in reason or "unreadable" in reason.lower() else "EXCLUDED",
            "reason": reason, "datum": product.datum or None}


def _candidates(grid: LocalGrid, family: str) -> list[Product]:
    bbox = grid.lonlat_bbox()
    products = [p for p in catalog.products_in_bbox(bbox, (family,)) if p.family == family]
    if family == "CTX":  # thousands of stereo pairs at Gale: probe only the best footprints
        products.sort(key=lambda p: (-round(catalog.footprint_coverage(p, bbox), 2), p.gsd_m,
                                     catalog._negated(p.product_id)))
        products = products[:catalog.CTX_PRESELECT]
    return products


def build_window(lat: float, lon: float, half_width_m: float, res_m: float, mode: str = "ladder") -> TerrainWindow:
    if mode not in TERRAIN_MODES:
        raise ValueError(f"terrain_mode must be one of {sorted(TERRAIN_MODES)}")
    grid = LocalGrid(float(lat), float(lon), float(half_width_m), float(res_m))
    key = f"{grid.key()}_{mode}"
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    window = _build(grid, mode)
    with _cache_lock:
        _cache[key] = window
        while len(_cache) > CACHE_WINDOWS:
            _cache.popitem(last=False)
    return window


def _build(grid: LocalGrid, mode: str) -> TerrainWindow:
    t0 = time.perf_counter()
    elevation = np.full(grid.shape, np.nan, dtype="float32")
    source = np.zeros(grid.shape, dtype="uint8")
    product_index = np.full(grid.shape, -1, dtype="int16")
    used: list[dict] = []
    excluded: list[dict] = []
    arrays: list[np.ndarray] = []
    timings: dict[str, float] = {}
    bbox = grid.lonlat_bbox()
    for family in (f for f in TERRAIN_MODES[mode] if f != "MOLA"):
        if np.isfinite(elevation).all():
            break
        tf = time.perf_counter()
        try:
            candidates = [_probe_and_check(p) for p in _candidates(grid, family)]
        except (OSError, ValueError, FileNotFoundError) as exc:
            excluded.append({"family": family, "status": "UNAVAILABLE", "reason": f"catalog: {exc}"[:240]})
            continue
        readable = []
        for product in candidates:
            if product.asset_status.get("status") != "OK":
                excluded.append(_exclusion(product, product.asset_status.get("reason", "unreadable")))
            elif not product.datum.get("accepted"):
                excluded.append(_exclusion(product, product.datum.get("status", "DATUM MISMATCH")))
            elif not catalog.qa_pass(product):
                excluded.append(_exclusion(product, "QA gate failed (NMAD vs MOLA too high)"))
            else:
                try:
                    array, meta = reader.read_to_grid(product.dtm_href, grid)
                except (OSError, ValueError, FileNotFoundError) as exc:
                    excluded.append(_exclusion(product, f"read failed: {exc}"[:240]))
                    continue
                if product.datum.get("convert") == "sphere_to_areoid":
                    lat_g, lon_g = grid.latlon_grid
                    array = (array + datum.SAMPLER.sphere_to_areoid_offset(lat_g, lon_g)).astype("float32")
                readable.append((product, array, meta))
        readable.sort(key=lambda item: catalog.rank_key(item[0], bbox, item[2]["valid_fraction"]))
        for product, array, meta in readable:
            fill = np.isnan(elevation) & np.isfinite(array)
            if not fill.any():
                excluded.append(_exclusion(product, "fully covered by a higher-ranked product"))
                continue
            idx = len(used)
            elevation[fill] = array[fill]
            source[fill] = FAMILY_CODE[product.family]
            product_index[fill] = idx
            arrays.append(array)
            used.append({**product.to_dict(), "pixels": int(fill.sum()), "fraction": float(fill.mean()),
                         "read": meta, "datum_checked_at": product.datum.get("checked_at"),
                         "retrieved_at": product.asset_status.get("checked_at")})
        timings[family.lower()] = round(time.perf_counter() - tf, 3)
    tm = time.perf_counter()
    if "MOLA" in TERRAIN_MODES[mode] and np.isnan(elevation).any():
        try:
            mola = datum.SAMPLER.on_grid(grid, "t")
            fill = np.isnan(elevation) & np.isfinite(mola)
            idx = len(used)
            elevation[fill] = mola[fill]
            source[fill] = FAMILY_CODE["MOLA"]
            product_index[fill] = idx
            arrays.append(mola)
            tile = mola_store.tile_name_for(grid.lat0, grid.lon0)
            used.append({"product_id": f"MOLA MEGDR 128 ppd {tile}", "family": "MOLA", "ledger_id": "MOLA_MEGDR",
                         "gsd_m": MOLA_GSD_M, "pixels": int(fill.sum()), "fraction": float(fill.mean()),
                         "datum": {"status": "REFERENCE", "datum_detected": "areoid"},
                         "read": {"method": "bilinear from the 463 m grid"},
                         "retrieved_at": mola_store.read_manifest().get("tiles", {}).get(tile, {}).get("retrieved_at"),
                         "dtm_href": f"{mola_store.PDS_MEG128_URL}{tile}.img"})
        except (FileNotFoundError, ValueError) as exc:
            excluded.append({"family": "MOLA", "ledger_id": "MOLA_MEGDR", "status": "UNAVAILABLE",
                             "reason": str(exc)[:240]})
    timings["mola"] = round(time.perf_counter() - tm, 3)
    seams, steps = _seams(product_index, arrays, used)
    timings["total"] = round(time.perf_counter() - t0, 3)
    return TerrainWindow(grid, mode, elevation, source, product_index, used, excluded, seams, steps, timings)


def _seams(product_index: np.ndarray, arrays: list[np.ndarray], used: list[dict]) -> tuple[np.ndarray, list[dict]]:
    """Seam pixels (product changes to a 4-neighbor) and per-pair elevation steps across them (V6)."""
    seam = np.zeros(product_index.shape, dtype=bool)
    pairs: dict[tuple[int, int], list[float]] = {}
    for axis in (0, 1):
        a = product_index if axis == 0 else product_index.T
        left, right = a[:-1], a[1:]
        diff = (left != right) & (left >= 0) & (right >= 0)
        rows, cols = np.nonzero(diff)
        if axis == 1:
            rows, cols = cols, rows
            seam[rows, cols] = True
            seam[rows, cols + 1] = True
            nr, nc = rows, cols + 1
        else:
            seam[rows, cols] = True
            seam[rows + 1, cols] = True
            nr, nc = rows + 1, cols
        for r, c, r2, c2 in zip(rows, cols, nr, nc, strict=True):
            i, j = int(product_index[r, c]), int(product_index[r2, c2])
            hi, lo = min(i, j), max(i, j)
            # Step = the two products' heights at the same pixel, on either side, when both cover it.
            for rr, cc in ((r, c), (r2, c2)):
                za, zb = arrays[hi][rr, cc], arrays[lo][rr, cc]
                if np.isfinite(za) and np.isfinite(zb):
                    pairs.setdefault((hi, lo), []).append(float(abs(za - zb)))
                    break
    steps = []
    for (hi, lo), values in sorted(pairs.items()):
        v = np.asarray(values)
        steps.append({"upper": used[hi]["product_id"], "lower": used[lo]["product_id"], "n": int(v.size),
                      "median_step_m": float(np.median(v)), "p90_step_m": float(np.percentile(v, 90)),
                      "max_step_m": float(v.max()), "flagged": bool(np.median(v) > SEAM_STEP_FLAG_M)})
    return seam, steps
