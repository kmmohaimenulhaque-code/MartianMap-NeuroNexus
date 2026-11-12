from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "data/manifests/mola_tiles.json"
OUTPUT_PATH = ROOT / "data/manifests/mola_planet_mesh.json"


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))

    tiles = catalog["tiles"]

    manifest_tiles = []
    total_samples = 0

    for tile in tiles:
        rows = int(tile["rows"])
        columns = int(tile["columns"])
        native_samples = rows * columns

        total_samples += native_samples

        record = {
            "id": tile["id"],
            "product": tile["product"],
            "type": tile["type"],
            "path": tile["path"],
            "label": tile["label"],
            "rows": rows,
            "columns": columns,
            "native_samples": native_samples,
            "size_bytes": int(tile["size_bytes"]),
        }

        # Global MEG128 metadata
        if tile["product"] == "MOLA MEGDR 128 ppd":
            record.update(
                {
                    "projection": tile["projection"],
                    "resolution_px_per_degree": tile[
                        "resolution_px_per_degree"
                    ],
                    "north_latitude": tile["north_latitude"],
                    "south_latitude": tile["south_latitude"],
                    "west_longitude": tile["west_longitude"],
                    "east_longitude": tile["east_longitude"],
                }
            )

        # Polar MEG512 metadata
        elif tile["product"] == "MOLA MEGDR Polar 512 ppd":
            record.update(
                {
                    "hemisphere": tile["hemisphere"],
                    "projection": tile.get("projection"),
                    "resolution_px_per_degree": tile.get(
                        "resolution_px_per_degree"
                    ),
                    "maximum_latitude": tile.get("maximum_latitude"),
                    "minimum_latitude": tile.get("minimum_latitude"),
                }
            )

        manifest_tiles.append(record)

    manifest = {
        "project": "NeuroNexus",
        "dataset": "MOLA native-resolution planetary mesh source",
        "version": "1.0.0",
        "source_catalog": str(CATALOG_PATH.relative_to(ROOT)),
        "global_tile_count": sum(
            t["product"] == "MOLA MEGDR 128 ppd"
            for t in tiles
        ),
        "polar_tile_count": sum(
            t["product"] == "MOLA MEGDR Polar 512 ppd"
            for t in tiles
        ),
        "total_tile_count": len(tiles),
        "total_native_samples": total_samples,
        "tiles": manifest_tiles,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    OUTPUT_PATH.write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )

    print("=" * 75)
    print("NEURONEXUS NATIVE MOLA PLANET MANIFEST")
    print("=" * 75)
    print(f"Global MEG128 : {manifest['global_tile_count']}")
    print(f"Polar MEG512  : {manifest['polar_tile_count']}")
    print(f"Total tiles   : {manifest['total_tile_count']}")
    print()
    print(
        f"Native samples: "
        f"{manifest['total_native_samples']:,}"
    )
    print()
    print(f"Output: {OUTPUT_PATH}")
    print()
    print("✅ NATIVE-RESOLUTION PLANET MANIFEST CREATED")


if __name__ == "__main__":
    main()
