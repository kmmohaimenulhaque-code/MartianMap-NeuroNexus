"""RGB values for server-rendered overlays. They mirror frontend/src/ui/tokens.css exactly
(enforced by tests/test_hires_palette.py), so a PNG overlay and the legend never disagree."""
from __future__ import annotations

TOKENS = {
    "--nn-walk-ramp-hi": "#75e6ff",
    "--nn-walk-ramp-mid": "#d99a3d",
    "--nn-walk-ramp-lo": "#b8324a",
    "--nn-walk-hatch": "#2a0710",
    "--nn-green": "#8cf0b1",
    "--nn-amber": "#ffc46b",
    "--nn-red": "#ff647c",
    "--nn-text-dim": "#71848c",
    "--nn-series-4": "#c99bff",
    "--nn-series-2": "#ff9f68",
    "--nn-src-mola": "#6f858d",
}


def rgb(token: str) -> tuple[int, int, int]:
    h = TOKENS[token].lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


WALK_CLASS_RGB = {1: rgb("--nn-green"), 2: rgb("--nn-amber"), 3: rgb("--nn-red"), 0: rgb("--nn-text-dim")}
SOURCE_RGB = {1: rgb("--nn-series-4"), 2: rgb("--nn-series-2"), 3: rgb("--nn-src-mola")}
RAMP = (rgb("--nn-walk-ramp-lo"), rgb("--nn-walk-ramp-mid"), rgb("--nn-walk-ramp-hi"))  # walk 0, 50, 100
