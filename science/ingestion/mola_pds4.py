"""
NeuroNexus MOLA PDS4 ingestion.

NASA MGS MOLA MEGDR
16 pixels/degree global topography.
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

import numpy as np


BASE_URL = (
    "https://pds-geosciences.wustl.edu/"
    "mgs/urn-nasa-pds-mgs_mola_topography_derived/"
    "meg016/"
)

PRODUCT = "megt90n000eb.img"
LABEL = "megt90n000eb.xml"

WIDTH = 360 * 16
HEIGHT = 180 * 16


def download_file(filename: str, output_dir: str | Path) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    destination = output_dir / filename

    if destination.exists():
        print(f"Already exists: {destination}")
        return destination

    url = BASE_URL + filename

    print(f"Downloading:")
    print(url)

    urllib.request.urlretrieve(url, destination)

    print(f"Saved: {destination}")
    return destination


def read_mola_topography(path: str | Path) -> np.ndarray:
    path = Path(path)

    data = np.fromfile(path, dtype=">i2")

    expected = WIDTH * HEIGHT

    if data.size != expected:
        raise ValueError(
            f"Unexpected sample count: {data.size}; "
            f"expected {expected}"
        )

    return data.reshape((HEIGHT, WIDTH))


def main() -> None:
    raw_dir = Path("data/raw/mola/meg016")

    img = download_file(PRODUCT, raw_dir)
    xml = download_file(LABEL, raw_dir)

    elevation = read_mola_topography(img)

    print()
    print("==============================================")
    print("       NEURONEXUS REAL MOLA TEST")
    print("==============================================")
    print(f"Product      : {PRODUCT}")
    print(f"PDS4 label   : {xml.name}")
    print(f"Grid         : {elevation.shape}")
    print(f"Dtype        : {elevation.dtype}")
    print(f"Samples      : {elevation.size:,}")
    print(f"Minimum raw  : {elevation.min()}")
    print(f"Maximum raw  : {elevation.max()}")
    print(f"Mean raw     : {elevation.mean():.2f}")
    print("==============================================")
    print("🟢 REAL MOLA DATA LOADED")
    print("==============================================")


if __name__ == "__main__":
    main()
