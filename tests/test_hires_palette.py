"""Server overlay colors must equal the frontend design tokens (R8)."""
import re
from pathlib import Path

from science.hires.palette import TOKENS

CSS = (Path(__file__).resolve().parents[1] / "frontend/src/ui/tokens.css").read_text(encoding="utf-8")


def test_palette_matches_tokens_css():
    for token, value in TOKENS.items():
        match = re.search(rf"{re.escape(token)}:\s*(#[0-9a-fA-F]{{6}})\s*;", CSS)
        assert match, f"{token} missing from tokens.css"
        assert match.group(1).lower() == value.lower(), token


def test_ramp_luminance_falls_from_hi_to_lo():
    def lum(hexv):
        r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (1, 3, 5))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    hi, mid, lo = (TOKENS[f"--nn-walk-ramp-{k}"] for k in ("hi", "mid", "lo"))
    assert lum(hi) - lum(mid) > 0.15 and lum(mid) - lum(lo) > 0.15
