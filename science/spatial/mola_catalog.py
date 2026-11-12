from __future__ import annotations

from pathlib import Path
import json
import re


ROOT = Path(__file__).resolve().parents[2]

LABEL_DIR = ROOT / "data/raw/mola/meg128/labels"
IMAGE_DIR = ROOT / "data/raw/mola/meg128/topography"

OUTPUT = ROOT / "data/manifests/mola_tiles.json"


def read_label(path: Path) -> dict:
    text = path.read_text(encoding="latin-1")

    def get_number(key: str):
        match = re.search(
            rf"^\s*{key}\s*=\s*([-+]?\d+(?:\.\d+)?)",
            text,
            re.MULTILINE,
        )
        if not match:
            raise ValueError(f"{key} not found in {path.name}")
        return float(match.group(1))

    def get_string(key: str):
        match = re.search(
            rf'^\s*{key}\s*=\s*"([^"]+)"',
            text,
            re.MULTILINE,
        )
        if not match:
            raise ValueError(f"{key} not found in {path.name}")
        return match.group(1)

    return {
        "projection": get_string("MAP_PROJECTION_TYPE"),
        "resolution_px_per_degree": get_number("MAP_RESOLUTION"),
        "north_latitude": get_number("MAXIMUM_LATITUDE"),
        "south_latitude": get_number("MINIMUM_LATITUDE"),
        "west_longitude": get_number("WESTERNMOST_LONGITUDE"),
        "east_longitude": get_number("EASTERNMOST_LONGITUDE"),
    }


tiles = []


# ============================================================
# GLOBAL MEG128
# ============================================================

for label_path in sorted(LABEL_DIR.glob("megt*.lbl")):

    image_path = IMAGE_DIR / f"{label_path.stem}.img"

    if not image_path.exists():
        raise FileNotFoundError(
            f"Image missing for label: {label_path.name}"
        )

    metadata = read_label(label_path)

    tile = {
        "id": label_path.stem,
        "product": "MOLA MEGDR 128 ppd",
        "type": "topography",
        "path": str(image_path.relative_to(ROOT)),
        "label": str(label_path.relative_to(ROOT)),
        "rows": 5632,
        "columns": 11520,
        "size_bytes": image_path.stat().st_size,
        **metadata,
    }

    tiles.append(tile)


# ============================================================
# POLAR MEG512
# ============================================================

polar_products = [
    (
        "north",
        ROOT / "data/raw/mola/polar512/north/megt_n_512_1.img",
        ROOT / "data/raw/mola/polar512/north/megt_n_512_1.lbl",
    ),
    (
        "south",
        ROOT / "data/raw/mola/polar512/south/megt_s_512_1.img",
        ROOT / "data/raw/mola/polar512/south/megt_s_512_1.lbl",
    ),
]


for hemisphere, image_path, label_path in polar_products:

    if not image_path.exists():
        raise FileNotFoundError(image_path)

    tile = {
        "id": image_path.stem,
        "product": "MOLA MEGDR Polar 512 ppd",
        "type": "topography",
        "hemisphere": hemisphere,
        "path": str(image_path.relative_to(ROOT)),
        "label": str(label_path.relative_to(ROOT)),
        "rows": 12288,
        "columns": 12288,
        "size_bytes": image_path.stat().st_size,
    }

    # Polar labels don't have the same longitude-bound fields
    # as the global simple-cylindrical products.
    if label_path.exists():
        text = label_path.read_text(encoding="latin-1")

        match = re.search(
            r'MAP_PROJECTION_TYPE\s*=\s*"([^"]+)"',
            text,
        )

        if match:
            tile["projection"] = match.group(1)

        match = re.search(
            r'MAP_RESOLUTION\s*=\s*([-+]?\d+(?:\.\d+)?)',
            text,
        )

        if match:
            tile["resolution_px_per_degree"] = float(match.group(1))

        match = re.search(
            r'MAXIMUM_LATITUDE\s*=\s*([-+]?\d+(?:\.\d+)?)',
            text,
        )

        if match:
            tile["maximum_latitude"] = float(match.group(1))

        match = re.search(
            r'MINIMUM_LATITUDE\s*=\s*([-+]?\d+(?:\.\d+)?)',
            text,
        )

        if match:
            tile["minimum_latitude"] = float(match.group(1))

    tiles.append(tile)


# ============================================================
# WRITE CATALOG
# ============================================================

catalog = {
    "project": "NeuroNexus",
    "version": "0.3.0",
    "source_of_truth": "MOLA PDS label metadata",
    "tiles": tiles,
}


with OUTPUT.open("w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2)


print("=" * 75)
print("NEURONEXUS MOLA TILE CATALOG")
print("=" * 75)

global_tiles = [
    t for t in tiles
    if t["product"] == "MOLA MEGDR 128 ppd"
]

polar_tiles = [
    t for t in tiles
    if "Polar" in t["product"]
]

print(f"Global MEG128 : {len(global_tiles)}")
print(f"Polar MEG512  : {len(polar_tiles)}")
print(f"Total         : {len(tiles)}")
print()

for tile in global_tiles:
    print(
        f"{tile['id']:20s} "
        f"lat {tile['south_latitude']:7.1f} → "
        f"{tile['north_latitude']:7.1f}   "
        f"lon {tile['west_longitude']:7.1f} → "
        f"{tile['east_longitude']:7.1f}"
    )

print()

for tile in polar_tiles:
    print(
        f"{tile['id']:20s} "
        f"{tile['hemisphere']:5s} polar   "
        f"{tile.get('projection', 'unknown')}"
    )

print()
print(f"Output: {OUTPUT}")
print()
print("✅ NASA-LABEL-DRIVEN CATALOG CREATED")
