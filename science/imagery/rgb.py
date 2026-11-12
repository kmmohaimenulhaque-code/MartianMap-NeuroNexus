from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image


@dataclass(frozen=True)
class RGBImage:
    """Validated RGB imagery loaded by the NeuroNexus imagery layer."""

    path: Path
    width: int
    height: int
    mode: str


class RGBLoader:
    """
    Basic RGB imagery loader.

    This layer deliberately handles image integrity and metadata first.
    Geographic reprojection/georeferencing will be added once a specific
    NASA imagery product is registered.
    """

    SUPPORTED_MODES = {"RGB", "RGBA", "L", "LA"}

    def load(self, path: str | Path) -> RGBImage:
        path = Path(path)

        if not path.exists():
            raise FileNotFoundError(path)

        if not path.is_file():
            raise ValueError(f"not a file: {path}")

        with Image.open(path) as image:
            image.verify()

        with Image.open(path) as image:
            mode = image.mode
            width, height = image.size

        if mode not in self.SUPPORTED_MODES:
            raise ValueError(
                f"unsupported image mode: {mode!r}; "
                f"expected one of {sorted(self.SUPPORTED_MODES)}"
            )

        return RGBImage(
            path=path,
            width=width,
            height=height,
            mode=mode,
        )
