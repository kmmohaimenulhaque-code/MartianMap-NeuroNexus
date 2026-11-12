from __future__ import annotations

import urllib.parse
import urllib.request


ODE_SEARCH = "https://ode.rsl.wustl.edu/mars/productSearch.aspx"

TARGET_LAT = -4.5895
TARGET_LON = 137.4417


def fetch(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "NeuroNexus/0.1",
        },
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def main() -> None:
    print("NEURONEXUS THEMIS VGEO4 DISCOVERY")
    print("=" * 70)

    print("Target latitude :", TARGET_LAT)
    print("Target longitude:", TARGET_LON)
    print()

    params = {
        "instrument": "THEMIS",
        "dataset": "VGEO4",
        "maxlat": TARGET_LAT + 1.0,
        "minlat": TARGET_LAT - 1.0,
        "westlon": TARGET_LON - 1.0,
        "eastlon": TARGET_LON + 1.0,
    }

    url = ODE_SEARCH + "?" + urllib.parse.urlencode(params)

    print("ODE URL:")
    print(url)
    print()

    html = fetch(url)

    print("HTTP RESPONSE: GREEN")
    print("Bytes received:", len(html))
    print()

    lower = html.lower()

    checks = {
        "THEMIS": "themis" in lower,
        "VGEO4": "vgeo4" in lower,
        "product search": "product search" in lower,
        "latitude": "latitude" in lower,
        "longitude": "longitude" in lower,
    }

    print("CONTENT CHECKS")
    print("-" * 70)

    for name, passed in checks.items():
        print(f"{name:20}: {'GREEN' if passed else 'MISS'}")

    print()
    print("First 1000 characters:")
    print("-" * 70)
    print(html[:1000])


if __name__ == "__main__":
    main()
