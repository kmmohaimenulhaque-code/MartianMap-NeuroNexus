from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from science.thermal.themis_pbt import ThemisPBTReader


BASE = "https://static.mars.asu.edu/pds/ODTGEO_v2/data"
PATHS = Path("data/indexes/themis/themis_product_paths.txt")
OUT = Path("data/indexes/themis/themis_archive_sample.json")
CACHE = Path("/tmp/themis_sample")

TARGETS = 12


def download(url: str, path: Path) -> None:
    if path.exists():
        return

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "NeuroNexus-THEMIS-Research/1.0"},
    )

    with urllib.request.urlopen(request, timeout=120) as response:
        path.write_bytes(response.read())


def main() -> int:
    rows = []

    for line in PATHS.read_text(encoding="utf-8").splitlines():
        product_id, archive_path = line.split("\t", 1)
        rows.append((product_id, archive_path))

    if not rows:
        raise RuntimeError("No resolved THEMIS products found.")

    if len(rows) <= TARGETS:
        selected = rows
    else:
        indices = [
            round(i * (len(rows) - 1) / (TARGETS - 1))
            for i in range(TARGETS)
        ]
        selected = [rows[i] for i in indices]

    CACHE.mkdir(parents=True, exist_ok=True)

    print(f"Total resolved products: {len(rows)}")
    print(f"Downloading sample: {len(selected)} products")
    print()

    results = []

    for number, (product_id, archive_path) in enumerate(selected, 1):
        filename = archive_path.rsplit("/", 1)[-1]
        local_path = CACHE / filename
        url = f"{BASE}/{archive_path}"

        print(f"[{number}/{len(selected)}] {product_id}")
        print(f"  URL: {url}")

        try:
            download(url, local_path)

            print(f"  File: {local_path}")

            reader = ThemisPBTReader(local_path)
            m = reader.metadata

            result = {
                "product_id": product_id,
                "archive_path": archive_path,
                "observation_start": m.observation_start,
                "observation_stop": m.observation_stop,
                "solar_longitude_deg": m.solar_longitude_deg,
                "local_solar_time_hours": m.local_solar_time_hours,
                "minimum_latitude": m.minimum_latitude,
                "maximum_latitude": m.maximum_latitude,
                "westernmost_longitude": m.westernmost_longitude,
                "easternmost_longitude": m.easternmost_longitude,
                "resolution_m": m.map_scale_km * 1000.0,
            }

            results.append(result)

            print(
                f"  Ls={m.solar_longitude_deg}° | "
                f"LST={m.local_solar_time_hours} h | "
                f"lat={m.minimum_latitude:.2f}..{m.maximum_latitude:.2f}° | "
                f"lon={m.westernmost_longitude:.2f}..{m.easternmost_longitude:.2f}°"
            )

        except Exception as exc:
            print(f"  ERROR: {exc}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(results, indent=2),
        encoding="utf-8",
    )

    print()
    print("=== ARCHIVE SAMPLE COMPLETE ===")
    print(f"Valid products: {len(results)}")
    print(f"Output: {OUT}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
