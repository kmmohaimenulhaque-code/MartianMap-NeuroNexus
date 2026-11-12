from __future__ import annotations

import re
import urllib.request
from pathlib import Path

BASE = "https://static.mars.asu.edu/pds/ODTGEO_v2/data"
CANDIDATES = Path("data/indexes/themis/themis_product_candidates.txt")
OUT = Path("data/indexes/themis/themis_product_paths.txt")


def fetch(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "NeuroNexus-THEMIS-Research/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def main() -> None:
    ids = {
        x.strip().lower()
        for x in CANDIDATES.read_text(encoding="utf-8").splitlines()
        if x.strip()
    }

    groups = sorted({product_id[:4] for product_id in ids})

    print(f"Product IDs: {len(ids)}")
    print(f"Groups: {len(groups)}")

    print("\nFetching archive volume list once...")
    html = fetch(BASE + "/")

    volumes = sorted(
        set(
            re.findall(
                r'href=["\'](odtip2_\d{4})/["\']',
                html,
                flags=re.IGNORECASE,
            )
        )
    )

    print(f"IR-PBT volumes discovered: {len(volumes)}")

    resolved = []

    for index, volume in enumerate(volumes, 1):
        print(f"[{index}/{len(volumes)}] {volume}")

        volume_html = fetch(f"{BASE}/{volume}/")

        volume_groups = set(
            re.findall(
                r'href=["\'](i\d{3}xxpbt)/["\']',
                volume_html,
                flags=re.IGNORECASE,
            )
        )

        relevant_groups = volume_groups.intersection(
            {f"{group}xxpbt" for group in groups}
        )

        for group in sorted(relevant_groups):
            group_html = fetch(f"{BASE}/{volume}/{group}/")

            for filename in re.findall(
                r'href=["\']([^"\']+\.IMG)["\']',
                group_html,
                flags=re.IGNORECASE,
            ):
                product_id = filename[:-4].lower()

                if product_id in ids:
                    resolved.append(
                        f"{product_id}\t{volume}/{group}/{filename}"
                    )

    resolved = sorted(set(resolved))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "\n".join(resolved) + ("\n" if resolved else ""),
        encoding="utf-8",
    )

    print("\n=== RESOLUTION COMPLETE ===")
    print(f"Resolved products: {len(resolved)}")
    print(f"Output: {OUT}")

    for line in resolved[:20]:
        print(line)


if __name__ == "__main__":
    main()
