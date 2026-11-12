"""Build the landing page's static media and headline numbers.

    python tools/build_landing_media.py          # write
    python tools/build_landing_media.py --check  # fail if anything is stale (CI)

Writes, from files already in the repository (nothing is downloaded or invented):

* frontend/public/landing/media/<key>.webp  every screenshot named in frontend/landing/data/tutorials.json
* frontend/public/landing/media/hero-hirise.webp  the 1 m terrain render of the Gale demo walk (MARSWALK screenshot)
* frontend/landing/data/headline.json  V3 numbers read from validation/reports/latest.json
* frontend/landing/data/media.json  pixel size of each tutorial image (so the page reserves space, no layout shift)

Re-run after `node frontend/e2e/screenshots.mjs` refreshes the screenshots (for example after the label fixes),
so the tutorials always show the current console.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TUTORIALS = ROOT / "frontend" / "landing" / "data" / "tutorials.json"
HEADLINE = ROOT / "frontend" / "landing" / "data" / "headline.json"
MEDIA_SIZES = ROOT / "frontend" / "landing" / "data" / "media.json"
MEDIA = ROOT / "frontend" / "public" / "landing" / "media"
LATEST = ROOT / "validation" / "reports" / "latest.json"

# Hero: the terrain panel of the MARSWALK screenshot (1920 x 1080), clear of the overlay note box.
HERO_SRC = ROOT / "assets" / "screenshots" / "v3" / "05_marswalk_mode.png"
HERO_BOX = (642, 165, 1250, 765)
# Scale: the planner reports "straight line 1200 m" between the start (1) and target (B) markers, which sit
# 252 px apart in the 1920 px screenshot (x 697 and 949). That gives about 4.76 m per screenshot pixel.
HERO_STRAIGHT_LINE_M = 1200.0
HERO_STRAIGHT_LINE_PX = 252.0
MOLA_PIXEL_M = 463.0


def fit(img: Image.Image, width: int) -> Image.Image:
    img = img.convert("RGB")
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    return img


def webp_bytes(img: Image.Image, width: int, quality: int = 80) -> bytes:
    img = fit(img, width)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def headline() -> dict:
    latest = json.loads(LATEST.read_text())
    out: dict = {"run_id": latest["run_id"], "generated_at": latest["generated_at"], "sites": {}}
    for site, entry in latest["sites"].items():
        rows = {row["label"]: row for row in entry["headline"] if row["id"] == "V3"}
        mola = rows["MOLA-only p90 underestimate"]
        hirise = rows["HiRISE @3 m p90 ratio (tilt / slope)"]
        rho = rows["Rover tilt vs HiRISE slope @3 m"]
        out["sites"][site] = {
            "mola_ratio": round(mola["number"], 2),
            "mola_ci95": mola["ci95"],
            "mola_n": mola["n"],
            "hirise_ratio": round(hirise["number"], 2),
            "hirise_ci95": hirise["ci95"],
            "hirise_n": hirise["n"],
            "rho": round(rho["number"], 2),
            "reproducible": f"{entry['V5']['identical']}/{entry['V5']['plans']}",
        }
    return out


def build() -> dict[Path, bytes]:
    spec = json.loads(TUTORIALS.read_text())
    files: dict[Path, bytes] = {}
    sizes: dict[str, list[int]] = {}
    for key, media in spec["media"].items():
        img = fit(Image.open(ROOT / media["src"]), media["w"])
        sizes[key] = [img.width, img.height]
        files[MEDIA / f"{key}.webp"] = webp_bytes(img, media["w"])
    files[MEDIA_SIZES] = (json.dumps(sizes, indent=2) + "\n").encode()
    hero = Image.open(HERO_SRC).crop(HERO_BOX)
    files[MEDIA / "hero-hirise.webp"] = webp_bytes(hero, hero.width, 88)
    meters_per_px = HERO_STRAIGHT_LINE_M / HERO_STRAIGHT_LINE_PX
    data = headline()
    data["hero"] = {
        "image": "/landing/media/hero-hirise.webp",
        "width_px": hero.width,
        "height_px": hero.height,
        "meters_per_px": round(meters_per_px, 3),
        "mola_pixel_px": round(MOLA_PIXEL_M / meters_per_px, 1),
        "source": "NeuroNexus MARSWALK render of the Gale demo walk on HiRISE 1 m terrain (assets/screenshots/v3/05_marswalk_mode.png)",
    }
    files[HEADLINE] = (json.dumps(data, indent=2) + "\n").encode()
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if headline.json is stale or media is missing")
    args = parser.parse_args(argv)
    files = build()
    if args.check:
        stale = [p for p, b in files.items() if not p.exists() or (p.suffix == ".json" and p.read_bytes() != b)]
        for p in stale:
            print(f"stale: {p.relative_to(ROOT)}")
        return 1 if stale else 0
    MEDIA.mkdir(parents=True, exist_ok=True)
    total = 0
    for path, data in files.items():
        path.write_bytes(data)
        total += len(data)
        print(f"{len(data) / 1024:8.1f} KB  {path.relative_to(ROOT)}")
    print(f"{total / 1024:8.1f} KB  total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
