"""Footprint catalog and deterministic product selector for the terrain ladder.

Ranking (T1.3), in order: family (HiRISE > CTX > MOLA), QA pass, valid coverage of the
window, finer gsd, lower |MOLA offset|, newer product id; ties broken by product id.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field

from shapely.geometry import box, shape

from science import settings
from science.hires import stac

FAMILY_CODE = {"HIRISE": 1, "CTX": 2, "MOLA": 3}
FAMILY_LEDGER = {"HIRISE": "HIRISE_STAC_DTM", "CTX": "CTX_STAC_DTM", "MOLA": "MOLA_MEGDR"}
MOLA_GSD_M = 463.0
CTX_PRESELECT = 6  # CTX candidates per window that get probed and datum-checked


@dataclass
class Product:
    product_id: str
    family: str
    collection: str
    gsd_m: float
    bbox: list[float]
    geometry: dict
    dtm_href: str
    dtm_asset: str
    datum_family: str  # "areoid" | "sphere" | "unknown" (verified empirically in datum.py)
    hillshade_href: str | None = None
    ortho_href: str | None = None
    qa_href: str | None = None
    mola_csv_href: str | None = None
    asset_status: dict = field(default_factory=dict)
    qa: dict = field(default_factory=dict)
    datum: dict = field(default_factory=dict)

    @property
    def ledger_id(self) -> str:
        return FAMILY_LEDGER[self.family]

    @property
    def family_code(self) -> int:
        return FAMILY_CODE[self.family]

    def to_dict(self) -> dict:
        out = asdict(self)
        out.pop("geometry")
        out["ledger_id"] = self.ledger_id
        return out


def _first_ortho(assets: dict) -> str | None:
    keys = sorted(k for k in assets if re.fullmatch(r"(ortho_\d+|.*_ORTHO)", k))
    # Prefer RED (grayscale) orthos over IRB color for a consistent basemap.
    keys.sort(key=lambda k: (0 if "RED" in k or k.startswith("ortho_") else 1, k))
    return assets[keys[0]]["href"] if keys else None


def product_from_item(item: dict) -> Product | None:
    assets, props = item.get("assets", {}), item.get("properties", {})
    collection = item.get("collection", "")
    if collection == stac.HIRISE_COLLECTION and "dtm" in assets:
        family, key, datum = "HIRISE", "dtm", "areoid"
    elif collection == stac.CTX_COLLECTION and "geoid_adjusted_dem" in assets:
        family, key, datum = "CTX", "geoid_adjusted_dem", "areoid"
    elif collection == stac.CTX_COLLECTION and "dtm" in assets:
        family, key, datum = "CTX", "dtm", "unknown"
    else:
        return None
    return Product(
        product_id=item["id"], family=family, collection=collection,
        gsd_m=float(props.get("gsd") or (1.0 if family == "HIRISE" else 20.0)),
        bbox=[float(v) for v in item["bbox"]], geometry=item["geometry"],
        dtm_href=assets[key]["href"], dtm_asset=key, datum_family=datum,
        hillshade_href=assets.get("hillshade", {}).get("href"),
        ortho_href=_first_ortho(assets) or assets.get("orthoimage", {}).get("href"),
        qa_href=assets.get("qa_metrics", {}).get("href"),
        mola_csv_href=assets.get("mola_csv", {}).get("href"),
    )


def products_in_bbox(bbox: list[float], families: tuple[str, ...] = ("HIRISE", "CTX")) -> list[Product]:
    collections = [c for f, c in (("HIRISE", stac.HIRISE_COLLECTION), ("CTX", stac.CTX_COLLECTION)) if f in families]
    if not collections:
        return []
    result = stac.search(collections, bbox=bbox, limit=200, max_items=6000)
    window = box(*bbox)
    products = []
    for item in result["features"]:
        product = product_from_item(item)
        if product and shape(item["geometry"]).buffer(0).intersects(window):
            products.append(product)
    products.sort(key=lambda p: p.product_id)
    return products


def footprint_coverage(product: Product, bbox: list[float]) -> float:
    window = box(*bbox)
    return float(shape(product.geometry).buffer(0).intersection(window).area / window.area)


QA_PATTERNS = {
    "max_m": r"Max difference:\s*(-?[\d.]+)", "min_m": r"Min difference:\s*(-?[\d.]+)",
    "mean_m": r"Mean difference:\s*(-?[\d.]+)", "std_m": r"StdDev of difference:\s*(-?[\d.]+)",
    "median_m": r"Median difference:\s*(-?[\d.]+)",
}


def parse_qa_metrics(text: str) -> dict:
    """Parse an ASP pc_align geodiff summary (qa_metrics.txt) into numbers."""
    out = {}
    for key, pattern in QA_PATTERNS.items():
        match = re.search(pattern, text)
        if match:
            out[key] = float(match.group(1))
    return out


def fetch_qa(product: Product) -> dict:
    if not product.qa_href:
        return {"status": "UNAVAILABLE", "reason": "no qa_metrics asset"}
    cache = settings.cache_root() / "stac" / "qa"
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"{product.product_id}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    probe = stac.probe_asset(product.qa_href)
    if probe["status"] != "OK":
        qa = {"status": "UNAVAILABLE", "reason": probe.get("reason", "unreadable")}
    else:
        response = stac._request("GET", product.qa_href)
        qa = {"status": "OK", **parse_qa_metrics(response.text)} if response.ok else \
            {"status": "UNAVAILABLE", "reason": f"HTTP {response.status_code}"}
    path.write_text(json.dumps(qa), encoding="utf-8")
    return qa


def qa_pass(product: Product) -> bool:
    """QA gate (NeuroNexus planning choice): readable DTM, datum accepted, CTX not jittery."""
    if product.asset_status.get("status") != "OK" or not product.datum.get("accepted"):
        return False
    if product.family == "CTX":
        nmad = product.datum.get("nmad_m")
        if nmad is None or nmad > 40.0:
            return False
        if product.qa.get("status") == "OK" and abs(product.qa.get("median_m", 0.0)) > 60.0:
            return False
    return True


def rank_key(product: Product, bbox: list[float], valid_coverage: float | None = None):
    coverage = footprint_coverage(product, bbox) if valid_coverage is None else valid_coverage
    offset = abs(product.datum.get("median_m") or 0.0)
    return (product.family_code, 0 if qa_pass(product) else 1, -round(coverage, 2), round(product.gsd_m, 2),
            round(offset, 1), _negated(product.product_id), product.product_id)


def _negated(product_id: str) -> tuple:
    # Newer product ids sort first: invert each character code.
    return tuple(-ord(c) for c in product_id)
