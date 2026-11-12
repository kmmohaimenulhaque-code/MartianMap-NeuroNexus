"""Download MOLA MEGDR 128 ppd tiles straight from the PDS Geosciences Node.

Replaces the Git LFS dependency. Only the tiles you ask for are fetched; each
is size-checked and its sha256 recorded in data/cache/mola/meg128/manifest.json.

  python tools/fetch_mola.py --sites gale jezero      # topography + radius for both sites
  python tools/fetch_mola.py --tiles megt00n090hb
  python tools/fetch_mola.py --all                    # all 16 topography tiles (~2.1 GB)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from science.terrain import mola_store  # noqa: E402

SITES = {"gale": (-4.6, 137.4), "jezero": (18.4, 77.4)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tiles", nargs="*", default=[])
    parser.add_argument("--sites", nargs="*", default=[], choices=sorted(SITES))
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--no-radius", action="store_true", help="skip megr radius tiles for --sites")
    args = parser.parse_args(argv)

    names = list(args.tiles)
    for site in args.sites:
        lat, lon = SITES[site]
        names.append(mola_store.tile_name_for(lat, lon, "t"))
        if not args.no_radius:
            names.append(mola_store.tile_name_for(lat, lon, "r"))
    if args.all:
        names += list(mola_store.status()["tiles"])
    if not names:
        parser.error("nothing to fetch: pass --tiles, --sites or --all")

    failures = 0
    for name in dict.fromkeys(names):
        try:
            path = mola_store.fetch_tile(name)
            print(f"ok   {name} -> {path}")
        except Exception as exc:  # report every tile, then exit non-zero
            failures += 1
            print(f"FAIL {name}: {exc}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
