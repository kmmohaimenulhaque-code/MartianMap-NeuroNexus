from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
import json


@dataclass(frozen=True)
class ImageryProduct:
    product_id: str
    mission: str
    instrument: str
    path: Path
    format: str
    width: int
    height: int
    projection: str | None
    coordinate_system: str | None
    resolution_m_per_pixel: float | None
    source_url: str
    checksum_sha256: str | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        data["path"] = str(self.path)
        return data


class ImageryRegistry:
    """Machine-readable registry for validated NASA imagery products."""

    def __init__(self) -> None:
        self._products: dict[str, ImageryProduct] = {}

    def add(self, product: ImageryProduct) -> None:
        if product.product_id in self._products:
            raise ValueError(
                f"duplicate imagery product: {product.product_id}"
            )

        self._products[product.product_id] = product

    def get(self, product_id: str) -> ImageryProduct:
        try:
            return self._products[product_id]
        except KeyError:
            raise KeyError(f"unknown imagery product: {product_id}")

    def all(self) -> tuple[ImageryProduct, ...]:
        return tuple(self._products.values())

    def export_json(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "project": "NeuroNexus",
            "products": [
                product.to_dict()
                for product in self._products.values()
            ],
        }

        path.write_text(
            json.dumps(payload, indent=2),
            encoding="utf-8",
        )
