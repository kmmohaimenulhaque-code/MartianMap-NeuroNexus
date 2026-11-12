from __future__ import annotations

import json
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = PROJECT_ROOT / "data" / "manifests" / "datasets.json"


class DatasetRegistry:
    def __init__(self, path: Path = REGISTRY_PATH):
        self.path = path
        self.data = self._load()

    def _load(self) -> dict[str, Any]:
        with self.path.open("r", encoding="utf-8") as f:
            return json.load(f)

    @property
    def datasets(self) -> list[dict[str, Any]]:
        return self.data.get("datasets", [])

    def get(self, dataset_id: str) -> dict[str, Any]:
        for dataset in self.datasets:
            if dataset.get("id") == dataset_id:
                return dataset
        raise KeyError(f"Dataset not found: {dataset_id}")

    def list_ids(self) -> list[str]:
        return [dataset["id"] for dataset in self.datasets]

    def summary(self) -> None:
        print(f"Project : {self.data.get('project')}")
        print(f"Version : {self.data.get('version')}")
        print(f"Datasets: {len(self.datasets)}")
        print()

        for dataset in self.datasets:
            print(f"- {dataset['id']}")
            print(f"  Product : {dataset.get('product')}")
            print(f"  Type    : {dataset.get('type')}")
            print(f"  Status  : {dataset.get('status')}")


if __name__ == "__main__":
    registry = DatasetRegistry()
    registry.summary()
