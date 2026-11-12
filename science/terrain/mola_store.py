"""MOLA MEGDR 128 ppd tile store without Git LFS.

Fresh clones carry 134-byte Git LFS pointer stubs under data/raw/mola/. This
module resolves a tile name to a real file: the repository path when it holds
real data, otherwise a cache directory filled by ``tools/fetch_mola.py``
straight from the PDS Geosciences Node. Nothing is ever synthesized; a missing
tile raises FileNotFoundError so the API keeps its honest 503 path.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PDS_MEG128_URL = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/"
ROWS, COLS = 5632, 11520
TILE_BYTES = ROWS * COLS * 2  # 129,761,280 bytes, MSB int16
REPO_DIR = PROJECT_ROOT / "data" / "raw" / "mola" / "meg128" / "topography"
LAT_BANDS = (("88n", 44.0, 88.0), ("44n", 0.0, 44.0), ("00n", -44.0, 0.0), ("44s", -88.0, -44.0))


def cache_dir() -> Path:
    override = os.environ.get("NEURONEXUS_MOLA_DIR")
    return Path(override) if override else PROJECT_ROOT / "data" / "cache" / "mola" / "meg128"


def is_real_tile(path: Path) -> bool:
    return path.is_file() and path.stat().st_size == TILE_BYTES


def tile_name_for(latitude: float, longitude: float, kind: str = "t") -> str:
    """MEGDR tile name, e.g. ``megt00n090hb`` (kind ``t`` topography, ``r`` radius)."""
    if not -88.0 <= latitude <= 88.0:
        raise ValueError(f"Latitude outside MEG128 coverage: {latitude}")
    lon = float(longitude) % 360.0
    code = next(c for c, lo, _hi in LAT_BANDS if latitude >= lo)
    return f"meg{kind}{code}{int(lon // 90) * 90:03d}hb"


def tile_bounds(name: str) -> tuple[float, float, float, float]:
    """(lat_min, lat_max, lon_min, lon_max) of a MEG128 tile name."""
    code, lon = name[4:7], int(name[7:10])
    _c, lo, hi = next(b for b in LAT_BANDS if b[0] == code)
    return lo, hi, float(lon), float(lon + 90)


def resolve_tile(name: str) -> Path | None:
    for candidate in (REPO_DIR / f"{name}.img", cache_dir() / f"{name}.img"):
        if is_real_tile(candidate):
            return candidate
    return None


def tile_path(name: str) -> Path:
    path = resolve_tile(name)
    if path is None:
        raise FileNotFoundError(
            f"MOLA tile {name} unavailable: the repository copy is a Git LFS stub and no "
            f"cached copy exists. Run: python tools/fetch_mola.py --tiles {name}"
        )
    return path


def _manifest_path() -> Path:
    return cache_dir() / "manifest.json"


def read_manifest() -> dict:
    try:
        return json.loads(_manifest_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"source": PDS_MEG128_URL, "tiles": {}}


def fetch_tile(name: str, *, timeout: float = 60.0, chunk: int = 1 << 20) -> Path:
    """Download one tile from PDS, verify its size, record sha256 in the manifest."""
    import requests

    if resolve_tile(name):
        return resolve_tile(name)  # type: ignore[return-value]
    dest = cache_dir()
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / f"{name}.img"
    part = target.with_suffix(".img.part")
    digest = hashlib.sha256()
    with requests.get(f"{PDS_MEG128_URL}{name}.img", stream=True, timeout=(10, timeout)) as resp:
        resp.raise_for_status()
        with part.open("wb") as fh:
            for block in resp.iter_content(chunk):
                fh.write(block)
                digest.update(block)
    if part.stat().st_size != TILE_BYTES:
        size = part.stat().st_size
        part.unlink(missing_ok=True)
        raise OSError(f"{name}: downloaded {size} bytes, expected {TILE_BYTES}")
    part.replace(target)
    manifest = read_manifest()
    manifest["tiles"][name] = {
        "url": f"{PDS_MEG128_URL}{name}.img",
        "bytes": TILE_BYTES,
        "sha256": digest.hexdigest(),
        "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    _manifest_path().write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return target


def status() -> dict:
    """Which topography tiles are usable and where they come from."""
    tiles = {}
    for code, _lo, _hi in LAT_BANDS:
        for lon in (0, 90, 180, 270):
            name = f"megt{code}{lon:03d}hb"
            path = resolve_tile(name)
            tiles[name] = None if path is None else ("repository" if path.parent == REPO_DIR else "pds-cache")
    return {"available": sum(v is not None for v in tiles.values()), "total": len(tiles), "tiles": tiles}
