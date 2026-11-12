"""RGB values for server-rendered overlays. They mirror frontend/src/ui/tokens.css exactly
(enforced by tests/test_hires_palette.py), so a PNG overlay and the legend never disagree."""
from __future__ import annotations

TOKENS = {
    "--nn-walk-ramp-hi": "#dcf8ff",
    "--nn-walk-ramp-mid": "#ffc46b",
    "--nn-walk-ramp-lo": "#ff647c",
    "--nn-walk-hatch": "#081014",
    "--nn-green": "#8cf0b1",
    "--nn-amber": "#ffc46b",
    "--nn-red": "#ff647c",
    "--nn-text-dim": "#71848c",
    "--nn-src-hirise": "#01ffff",
    "--nn-src-ctx": "#4ea8de",
    "--nn-src-mola": "#6f858d",
}


def rgb(token: str) -> tuple[int, int, int]:
    h = TOKENS[token].lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


WALK_CLASS_RGB = {1: rgb("--nn-green"), 2: rgb("--nn-amber"), 3: rgb("--nn-red"), 0: rgb("--nn-text-dim")}
SOURCE_RGB = {1: rgb("--nn-src-hirise"), 2: rgb("--nn-src-ctx"), 3: rgb("--nn-src-mola")}
RAMP = (rgb("--nn-walk-ramp-lo"), rgb("--nn-walk-ramp-mid"), rgb("--nn-walk-ramp-hi"))  # walk 0, 50, 100
