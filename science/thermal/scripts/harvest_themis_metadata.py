#!/usr/bin/env python3

from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

import aiohttp
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

BASE_URL = "https://static.mars.asu.edu/pds/ODTGEO_v2/data"
PATH_FILE = ROOT / "data/indexes/themis/themis_product_paths.txt"

OUT_DIR = ROOT / "data/indexes/themis/metadata"
OUT_FILE = OUT_DIR / "themis_metadata.jsonl"
FAIL_FILE = OUT_DIR / "failed_products.jsonl"
CHECKPOINT = OUT_DIR / "checkpoint.json"

CONCURRENCY = 32
RANGE_BYTES = 65536
TIMEOUT = aiohttp.ClientTimeout(total=90)

KEYS = [
    "PRODUCT_ID",
    "PRODUCT_CREATION_TIME",
    "START_TIME",
    "STOP_TIME",
    "LOCAL_TIME",
    "SOLAR_LONGITUDE",
    "LINES",
    "LINE_SAMPLES",
    "RECORD_BYTES",
    "LABEL_RECORDS",
    "SAMPLE_TYPE",
    "SAMPLE_BITS",
    "NULL_CONSTANT",
    "SCALING_FACTOR",
    "MAP_PROJECTION_TYPE",
    "MAP_LONGITUDE_SYSTEM",
    "A_AXIS_RADIUS",
    "CENTER_LATITUDE",
    "CENTER_LONGITUDE",
    "MAP_SCALE",
    "MAP_RESOLUTION",
    "SAMPLE_PROJECTION_OFFSET",
    "LINE_PROJECTION_OFFSET",
    "MINIMUM_LATITUDE",
    "MAXIMUM_LATITUDE",
    "WESTERNMOST_LONGITUDE",
    "EASTERNMOST_LONGITUDE",
]


def parse_value(text: str, key: str) -> str | None:
    m = re.search(
        rf"(?im)^\s*{re.escape(key)}\s*=\s*(.+?)\s*$",
        text,
    )
    if not m:
        return None

    value = m.group(1).strip()

    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]

    return value


def cast_value(value: str | None) -> Any:
    if value is None:
        return None

    value = value.strip()

    try:
        if re.fullmatch(r"[+-]?\d+", value):
            return int(value)

        if re.fullmatch(
            r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?",
            value,
        ):
            return float(value)
    except ValueError:
        pass

    return value


def parse_label(raw: bytes, product_id: str, archive_path: str, url: str) -> dict[str, Any]:

    # PDS labels are ASCII-compatible.
    text = raw.decode("ascii", errors="replace")

    record_bytes = parse_value(text, "RECORD_BYTES")
    label_records = parse_value(text, "LABEL_RECORDS")

    record_bytes_i = cast_value(record_bytes)
    label_records_i = cast_value(label_records)

    result: dict[str, Any] = {
        "product_id": product_id,
        "archive_path": archive_path,
        "source_url": url,
        "record_bytes": record_bytes_i,
        "label_records": label_records_i,
    }

    for key in KEYS:
        if key in {"PRODUCT_ID"}:
            continue

        result[key.lower()] = cast_value(parse_value(text, key))

    # Embedded PDS3 THEMIS naming.
    sample_name = re.search(
        r'(?im)^\s*ODY:SAMPLE_NAME\s*=\s*"([^"]+)"',
        text,
    )
    sample_unit = re.search(
        r'(?im)^\s*ODY:SAMPLE_UNIT\s*=\s*"([^"]+)"',
        text,
    )

    result["sample_name"] = sample_name.group(1) if sample_name else None
    result["sample_unit"] = sample_unit.group(1) if sample_unit else None

    # Preserve only useful scientific metadata.
    result["measurement"] = result.get("sample_name")
    result["unit"] = result.get("sample_unit")

    result["status"] = "metadata_harvested"

    return result


def load_products() -> list[tuple[str, str]]:
    products = []

    with PATH_FILE.open() as f:
        for line in f:
            line = line.strip()

            if not line:
                continue

            parts = line.split(maxsplit=1)

            if len(parts) != 2:
                continue

            product_id, archive_path = parts
            products.append((product_id, archive_path))

    return products


def load_checkpoint() -> set[str]:
    if not CHECKPOINT.exists():
        return set()

    try:
        data = json.loads(CHECKPOINT.read_text())
        return set(data.get("completed", []))
    except Exception:
        return set()


def save_checkpoint(completed: set[str]) -> None:
    CHECKPOINT.write_text(
        json.dumps(
            {
                "completed": sorted(completed),
                "count": len(completed),
            },
            indent=2,
        )
    )


async def fetch_one(
    session: aiohttp.ClientSession,
    semaphore: asyncio.Semaphore,
    product_id: str,
    archive_path: str,
) -> tuple[str, dict[str, Any] | None, str | None]:

    url = f"{BASE_URL}/{archive_path}"

    async with semaphore:

        for attempt in range(5):

            try:

                async with session.get(
                    url,
                    headers={
                        "Range": f"bytes=0-{RANGE_BYTES - 1}",
                        "Accept-Encoding": "identity",
                    },
                ) as response:

                    if response.status not in (200, 206):
                        raise RuntimeError(
                            f"HTTP {response.status}"
                        )

                    raw = await response.read()

                    if not raw:
                        raise RuntimeError("empty response")

                    metadata = parse_label(
                        raw,
                        product_id,
                        archive_path,
                        url,
                    )

                    # Basic sanity checks.
                    if metadata.get("record_bytes") is None:
                        raise RuntimeError("missing RECORD_BYTES")

                    if metadata.get("start_time") is None:
                        raise RuntimeError("missing START_TIME")

                    if metadata.get("solar_longitude") is None:
                        raise RuntimeError(
                            "missing SOLAR_LONGITUDE"
                        )

                    return product_id, metadata, None

            except Exception as exc:

                if attempt == 4:
                    return (
                        product_id,
                        None,
                        f"{type(exc).__name__}: {exc}",
                    )

                await asyncio.sleep(1.5 * (attempt + 1))

    return product_id, None, "unknown failure"


async def main() -> None:

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    products = load_products()

    completed = load_checkpoint()

    pending = [
        item
        for item in products
        if item[0] not in completed
    ]

    print(f"Total products: {len(products):,}")
    print(f"Already complete: {len(completed):,}")
    print(f"Pending: {len(pending):,}")
    print(f"Concurrency: {CONCURRENCY}")
    print(f"Range bytes: {RANGE_BYTES:,}")

    connector = aiohttp.TCPConnector(
        limit=CONCURRENCY,
        limit_per_host=CONCURRENCY,
        ttl_dns_cache=300,
    )

    semaphore = asyncio.Semaphore(CONCURRENCY)

    async with aiohttp.ClientSession(
        connector=connector,
        timeout=TIMEOUT,
        headers={
            "User-Agent": "NeuroNexus-Mars-THEMIS-Research/1.0"
        },
    ) as session:

        tasks = [
            fetch_one(
                session,
                semaphore,
                product_id,
                archive_path,
            )
            for product_id, archive_path in pending
        ]

        with OUT_FILE.open("a") as out, FAIL_FILE.open("a") as fail:

            for future in tqdm(
                asyncio.as_completed(tasks),
                total=len(tasks),
                unit="product",
            ):

                product_id, metadata, error = await future

                if metadata is not None:

                    out.write(
                        json.dumps(
                            metadata,
                            separators=(",", ":"),
                        )
                        + "\n"
                    )

                    out.flush()

                    completed.add(product_id)

                else:

                    fail.write(
                        json.dumps(
                            {
                                "product_id": product_id,
                                "error": error,
                            },
                            separators=(",", ":"),
                        )
                        + "\n"
                    )

                    fail.flush()

                if len(completed) % 250 == 0:
                    save_checkpoint(completed)

    save_checkpoint(completed)

    print()
    print("==========================================")
    print("THEMIS METADATA HARVEST COMPLETE")
    print("==========================================")
    print(f"Completed: {len(completed):,}")
    print(f"Output:    {OUT_FILE}")
    print(f"Failures:  {FAIL_FILE}")
    print(f"Checkpoint:{CHECKPOINT}")


if __name__ == "__main__":
    asyncio.run(main())
