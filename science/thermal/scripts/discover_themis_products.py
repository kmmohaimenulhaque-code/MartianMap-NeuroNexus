from __future__ import annotations

import csv
import re
import urllib.request
from pathlib import Path

BASE = "https://static.mars.asu.edu/pds/ODTGEO_v2/data"
INVENTORY = (
    "https://static.mars.asu.edu/pds/ODTGEO_v2/data/"
    "collection_data_irpbt_inventory.csv"
)

OUT = Path("data/indexes/themis/themis_product_candidates.txt")


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def main() -> None:
    print("Downloading official THEMIS IR-PBT inventory...")
    text = fetch(INVENTORY)

    print(f"Inventory lines: {len(text.splitlines())}")

    # Extract product identifiers such as i78601002pbt.
    ids = sorted(
        set(
            match.lower()
            for match in re.findall(
                r"\b(i\d{8}pbt)\b",
                text,
                flags=re.IGNORECASE,
            )
        )
    )

    print(f"Candidate product IDs found: {len(ids)}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(ids) + "\n", encoding="utf-8")

    print(f"Written: {OUT}")

    # Show first few candidates.
    print("\n=== SAMPLE CANDIDATES ===")
    for product_id in ids[:20]:
        print(product_id)


if __name__ == "__main__":
    main()
