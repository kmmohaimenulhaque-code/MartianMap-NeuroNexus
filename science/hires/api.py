"""Hi-res terrain endpoints: /terrain/sources, /terrain/hires/window, /terrain/hires/image."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Query
from fastapi.responses import Response

from science.hires import catalog, derivatives, ladder, layers, reader, stac
from science.hires.grid import LocalGrid
from science.marswalk import config
from science.ops.errors import bad_request, unavailable

router = APIRouter(prefix="/terrain", tags=["terrain-hires"])
LAYER_NAMES = ("elevation", "source", "slope_1m", "slope_3m", "slope_5m", "slope_20m", "slope_100m", "slope_463m",
               "roughness_5m", "roughness_25m", "local_relief_3x3", "walkability", "walk_class")
IMAGE_LAYERS = ("hillshade", "ortho", "walkability", "slope", "source")
EVIDENCE = {"elevation": "OBSERVED", "source": "DERIVED", "walkability": "DERIVED", "walk_class": "DERIVED"}


def _window(lat, lon, half_width_m, res_m, mode):
    try:
        return ladder.build_window(lat, lon, half_width_m, res_m, mode)
    except ValueError as exc:
        raise bad_request(str(exc), "half_width_m <= 5000, res_m >= 1, at most 2500 px per side") from exc
    except (OSError, FileNotFoundError) as exc:
        raise unavailable(str(exc), "run tools/fetch_mola.py or build the demo pack") from exc


def _meta(window) -> dict:
    g = window.grid
    return {"center": {"lat": g.lat0, "lon": g.lon0}, "half_width_m": g.extent_m, "res_m": g.res_m,
            "shape": list(g.shape), "crs": g.crs.to_proj4(), "transform": list(g.transform)[:6],
            "bbox_lonlat": g.lonlat_bbox(), "mode": window.mode, "engine_version": ladder.ENGINE_VERSION,
            "source_fractions": window.source_fractions(), "products": window.products,
            "excluded": window.excluded, "seam_steps": window.seam_steps, "timings_s": window.timings_s,
            "limitation": derivatives.LIMITATION_NOTE,
            "source_codes": {"1": "HIRISE", "2": "CTX", "3": "MOLA", "0": "NONE"}}


@router.get("/sources")
def terrain_sources(lat: float = Query(..., ge=-88, le=88), lon: float = Query(..., ge=-180, le=360),
                    radius_km: float = Query(3.0, gt=0, le=10), families: str = Query("HIRISE,CTX")):
    wanted = tuple(f for f in ("HIRISE", "CTX") if f in families.upper().split(","))
    grid = LocalGrid(lat, ((lon + 180) % 360) - 180, radius_km * 1000.0, max(radius_km * 1000.0 / 1000.0, 1.0))
    bbox = grid.lonlat_bbox()
    out, selected, unavailable_list = [], [], []
    try:
        for family in wanted:
            for product in ladder._candidates(grid, family):
                ladder._probe_and_check(product)
                entry = {**product.to_dict(), "coverage_fraction": round(catalog.footprint_coverage(product, bbox), 4),
                         "qa_pass": catalog.qa_pass(product)}
                out.append(entry)
                if product.asset_status.get("status") != "OK":
                    unavailable_list.append({"product_id": product.product_id,
                                             "reason": product.asset_status.get("reason")})
    except (OSError, FileNotFoundError) as exc:
        raise unavailable(f"STAC catalog unavailable: {exc}") from exc
    ranked = sorted((e for e in out if e["qa_pass"]),
                    key=lambda e: (catalog.FAMILY_CODE[e["family"]], -round(e["coverage_fraction"], 2), e["gsd_m"],
                                   round(abs((e.get("datum") or {}).get("median_m") or 0), 1), e["product_id"]))
    selected = [e["product_id"] for e in ranked]
    return {"center": {"lat": lat, "lon": lon}, "radius_km": radius_km, "bbox_lonlat": bbox, "products": out,
            "selected": selected, "unavailable": unavailable_list,
            "mola": {"ledger_id": "MOLA_MEGDR", "gsd_m": catalog.MOLA_GSD_M, "role": "always available fallback rung"},
            "ranking": "family (HiRISE > CTX > MOLA), QA pass, coverage, finer gsd, lower |MOLA offset|, newer id",
            "source": {"ledger_id": "USGS_ASTROGEOLOGY_STAC", "retrieved_at": stac.now_iso()}}


def _display(a: np.ndarray, max_side: int, decimals: int) -> list:
    step = int(np.ceil(max(a.shape) / max_side))
    sub = a[::step, ::step] if step > 1 else a
    return [[None if not np.isfinite(x) else round(float(x), decimals) for x in row] for row in sub]


@router.get("/hires/window")
def hires_window(lat: float = Query(..., ge=-88, le=88), lon: float = Query(..., ge=-180, le=360),
                 half_width_m: float = Query(1000.0, gt=0, le=5000), res_m: float = Query(2.0, ge=1, le=100),
                 mode: str = Query("ladder"), layers_param: str = Query("elevation,slope_3m,walk_class", alias="layers"),
                 grid_max: int = Query(128, ge=16, le=384)):
    requested = [name for name in layers_param.split(",") if name]
    unknown = [name for name in requested if name not in LAYER_NAMES]
    if unknown:
        raise bad_request(f"unknown layers: {unknown}", f"choose from {list(LAYER_NAMES)}")
    window = _window(lat, ((lon + 180) % 360) - 180, half_width_m, res_m, mode)
    v = config.values(config.resolve())
    computed = layers.compute(window, v, only=set(requested))
    result = {**_meta(window), "layers": {}}
    for name in requested:
        array = computed[name]
        baseline = computed.get(f"{name}_baseline")
        result["layers"][name] = {
            "unit": {"elevation": "m", "walkability": "0-100", "walk_class": "class", "source": "code"}.get(
                name, "deg" if name.startswith("slope") else "m"),
            "evidence": EVIDENCE.get(name, "DERIVED"),
            "datum": "meters above the MOLA areoid" if name == "elevation" else None,
            "stats_by_source": layers.stats(array.astype("float64"), window.source.astype("float64")),
            "effective_baseline_m": layers.stats(baseline.astype("float64")) if baseline is not None else None,
            "grid": _display(array.astype("float64"), grid_max, 2 if name != "elevation" else 1),
        }
    step = int(np.ceil(window.grid.size / grid_max))
    # grid[r][c] is the pixel at row r*step, col c*step: its center in window meters is (x0 + c*step_m, y0 - r*step_m).
    result["display_grid"] = {"step_m": window.grid.res_m * step, "x0": -window.grid.extent_m + window.grid.res_m / 2,
                              "y0": window.grid.extent_m - window.grid.res_m / 2,
                              "rows": int(np.ceil(window.grid.size / step)), "cols": int(np.ceil(window.grid.size / step))}
    result["classes"] = layers.CLASS_NAMES
    result["status_rule"] = config.status_rule_text(v)
    return result


def ortho_on_grid(window) -> np.ndarray | None:
    out = None
    for product in window.products:
        href = product.get("ortho_href")
        if not href:
            continue
        try:
            array, _meta = reader.read_to_grid(href, window.grid, is_elevation=False)
        except (OSError, ValueError, FileNotFoundError):
            continue
        array[array <= 0] = np.nan  # 0 is the orthoimage fill value
        out = array if out is None else np.where(np.isfinite(out), out, array)
        if np.isfinite(out).all():
            break
    return out


@router.get("/hires/image")
def hires_image(layer: str = Query(...), lat: float = Query(..., ge=-88, le=88), lon: float = Query(..., ge=-180, le=360),
                half_width_m: float = Query(1000.0, gt=0, le=5000), res_m: float = Query(2.0, ge=1, le=100),
                mode: str = Query("ladder"), max_side: int = Query(1024, ge=64, le=2048), baseline_m: int = Query(3)):
    if layer not in IMAGE_LAYERS:
        raise bad_request(f"unknown image layer: {layer}", f"choose from {list(IMAGE_LAYERS)}")
    window = _window(lat, ((lon + 180) % 360) - 180, half_width_m, res_m, mode)
    v = config.values(config.resolve())
    needs = {"walkability": {"walkability", "walk_class"}, "slope": {f"slope_{baseline_m}m"}}.get(layer, set())
    computed = layers.compute(window, v, baselines=(baseline_m,), extras=False, only=needs)
    ortho = ortho_on_grid(window) if layer == "ortho" else None
    if layer == "ortho" and ortho is None:
        raise unavailable("no readable orthoimage covers this window")
    try:
        png = layers.render(f"slope_{baseline_m}m" if layer == "slope" else layer, window, computed, max_side, ortho)
    except ValueError as exc:
        raise bad_request(str(exc)) from exc
    ledger = {"ortho": "HIRISE_STAC_ORTHO", "hillshade": "NEURONEXUS_TERRAIN_LADDER"}.get(layer, "NEURONEXUS_WALKABILITY")
    return Response(png, media_type="image/png", headers={"Cache-Control": "public, max-age=3600",
                                                          "X-NeuroNexus-Ledger": ledger,
                                                          "X-NeuroNexus-Bounds": ",".join(f"{x:.3f}" for x in (
                                                              -window.grid.extent_m, -window.grid.extent_m,
                                                              window.grid.extent_m, window.grid.extent_m))})
