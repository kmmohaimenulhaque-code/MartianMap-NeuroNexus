"""USGS Astrogeology STAC client: disk-cached searches, asset probing and a 404 ledger.

Searches are cached for 24 h (``settings.STAC_CACHE_TTL_S``). In DEMO_PACK mode only the
demo pack's cached responses are used. Every URL passes the host allowlist.
"""
from __future__ import annotations

import hashlib
import json
import random
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import requests

from science import settings

STAC_API = "https://stac.astrogeology.usgs.gov/api"
HIRISE_COLLECTION = "mro_hirise_socet_dtms"
CTX_COLLECTION = "mro_ctx_controlled_usgs_dtms"
_lock = threading.Lock()


def _stac_dir() -> Path:
    base = settings.demo_pack_dir() / "stac" if settings.demo_pack_mode() else settings.cache_root() / "stac"
    base.mkdir(parents=True, exist_ok=True)
    return base


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _request(method: str, url: str, *, attempts: int = 3, **kwargs) -> requests.Response:
    settings.check_url(url)
    kwargs.setdefault("timeout", (settings.CONNECT_TIMEOUT_S, settings.READ_TIMEOUT_S))
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.request(method, url, **kwargs)
            if response.status_code < 500:
                return response
            last = OSError(f"HTTP {response.status_code}")
        except requests.RequestException as exc:
            last = exc
        time.sleep((2 ** attempt) * 0.5 + random.uniform(0, 0.25))  # backoff with jitter
    raise OSError(f"{method} {url} failed after {attempts} attempts: {last}")


def search(collections: list[str], *, bbox: list[float] | None = None, intersects: dict | None = None,
           limit: int = 100, max_items: int = 2000) -> dict:
    """POST /search with paging. Returns {"features": [...], "retrieved_at", "cached"}."""
    body = {"collections": sorted(collections), "limit": limit}
    if bbox is not None:
        body["bbox"] = [round(float(v), 6) for v in bbox]
    if intersects is not None:
        body["intersects"] = intersects
    key = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:24]
    path = _stac_dir() / f"search_{key}.json"
    if path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        fresh = time.time() - path.stat().st_mtime < settings.STAC_CACHE_TTL_S
        if fresh or settings.demo_pack_mode():
            return {**cached, "cached": True}
    if settings.demo_pack_mode():
        raise FileNotFoundError(f"DEMO_PACK: STAC search {key} not in the demo pack")
    features: list[dict] = []
    url, payload = f"{STAC_API}/search", dict(body)
    while url and len(features) < max_items:
        response = _request("POST", url, json=payload)
        response.raise_for_status()
        page = response.json()
        features.extend(page.get("features", []))
        nxt = next((link for link in page.get("links", []) if link.get("rel") == "next"), None)
        # The API pages through its API Gateway host; keep the request on the allowlisted host.
        url = f"{STAC_API}/search" if nxt and str(nxt.get("href", "")).endswith("/search") else None
        payload = nxt.get("body", payload) if nxt else payload
    result = {"request": body, "features": features[:max_items], "retrieved_at": now_iso()}
    path.write_text(json.dumps(result), encoding="utf-8")
    return {**result, "cached": False}


def _status_path() -> Path:
    return _stac_dir() / "asset_status.json"


def asset_status() -> dict:
    try:
        return json.loads(_status_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def probe_asset(href: str, *, refresh: bool = False) -> dict:
    """HEAD an asset once; record OK or UNAVAILABLE(reason) in data/cache/stac/asset_status.json."""
    with _lock:
        ledger = asset_status()
        if href in ledger and not refresh:
            return ledger[href]
    if settings.demo_pack_mode():
        return {"status": "UNAVAILABLE", "reason": "not probed in demo pack", "checked_at": None}
    try:
        response = _request("HEAD", href, allow_redirects=True)
        entry = ({"status": "OK", "bytes": int(response.headers.get("content-length", 0))}
                 if response.status_code == 200 else
                 {"status": "UNAVAILABLE", "reason": f"HTTP {response.status_code}"})
    except (OSError, ValueError) as exc:
        entry = {"status": "UNAVAILABLE", "reason": str(exc)[:200]}
    entry["checked_at"] = now_iso()
    with _lock:
        ledger = asset_status()
        ledger[href] = entry
        _status_path().write_text(json.dumps(ledger, indent=1, sort_keys=True), encoding="utf-8")
    return entry
