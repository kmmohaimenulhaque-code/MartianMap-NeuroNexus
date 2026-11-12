#!/usr/bin/env python3

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
from pathlib import Path

import aiohttp


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

BASE_URL = "https://static.mars.asu.edu/pds/ODTGEO_v2/data/"

DEFAULT_INDEX = (
    ROOT
    / "data/indexes/themis/themis_product_paths.txt"
)

DEFAULT_DEST = Path("/scratch/themis/raw")

DEFAULT_MANIFEST = (
    Path("/scratch/themis/manifests")
    / "download_manifest.jsonl"
)

DEFAULT_FAILURES = (
    Path("/scratch/themis/manifests")
    / "download_failures.jsonl"
)


def load_products(index: Path):
    products = []

    with index.open() as f:
        for line in f:
            line = line.strip()

            if not line:
                continue

            parts = line.split(maxsplit=1)

            if len(parts) != 2:
                continue

            product_id, archive_path = parts

            products.append(
                {
                    "product_id": product_id,
                    "archive_path": archive_path,
                    "url": BASE_URL + archive_path,
                }
            )

    return products


def existing_valid(path: Path) -> bool:
    return path.exists() and path.is_file() and path.stat().st_size > 0


async def download_one(
    session: aiohttp.ClientSession,
    item: dict,
    destination: Path,
    semaphore: asyncio.Semaphore,
    retries: int,
):
    product_id = item["product_id"]
    archive_path = item["archive_path"]
    url = item["url"]

    output = destination / archive_path
    output.parent.mkdir(parents=True, exist_ok=True)

    if existing_valid(output):
        return {
            "status": "exists",
            "product_id": product_id,
            "archive_path": archive_path,
            "bytes": output.stat().st_size,
        }

    partial = output.with_suffix(output.suffix + ".part")

    async with semaphore:

        for attempt in range(1, retries + 1):

            try:
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=1800),
                ) as response:

                    response.raise_for_status()

                    expected = response.headers.get(
                        "Content-Length"
                    )

                    expected_bytes = (
                        int(expected)
                        if expected
                        else None
                    )

                    with partial.open("wb") as f:

                        async for chunk in response.content.iter_chunked(
                            1024 * 1024
                        ):
                            f.write(chunk)

                actual = partial.stat().st_size

                if expected_bytes is not None:
                    if actual != expected_bytes:
                        raise IOError(
                            f"size mismatch: "
                            f"{actual} != {expected_bytes}"
                        )

                os.replace(partial, output)

                return {
                    "status": "downloaded",
                    "product_id": product_id,
                    "archive_path": archive_path,
                    "bytes": actual,
                }

            except Exception as exc:

                try:
                    partial.unlink(missing_ok=True)
                except Exception:
                    pass

                if attempt == retries:
                    return {
                        "status": "failed",
                        "product_id": product_id,
                        "archive_path": archive_path,
                        "error": repr(exc),
                    }

                delay = min(
                    30,
                    2 ** attempt,
                ) + random.random()

                await asyncio.sleep(delay)


async def main():

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--index",
        type=Path,
        default=DEFAULT_INDEX,
    )

    parser.add_argument(
        "--destination",
        type=Path,
        default=DEFAULT_DEST,
    )

    parser.add_argument(
        "--concurrency",
        type=int,
        default=64,
    )

    parser.add_argument(
        "--retries",
        type=int,
        default=5,
    )

    args = parser.parse_args()

    args.destination.mkdir(
        parents=True,
        exist_ok=True,
    )

    DEFAULT_MANIFEST.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    DEFAULT_FAILURES.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    products = load_products(args.index)

    print("=" * 72)
    print("THEMIS IR-PBT FULL ARCHIVE DOWNLOADER")
    print("=" * 72)
    print(f"Products    : {len(products):,}")
    print(f"Destination : {args.destination}")
    print(f"Concurrency : {args.concurrency}")
    print(f"Retries     : {args.retries}")
    print()

    semaphore = asyncio.Semaphore(
        args.concurrency
    )

    connector = aiohttp.TCPConnector(
        limit=args.concurrency,
        limit_per_host=args.concurrency,
    )

    timeout = aiohttp.ClientTimeout(
        total=1800
    )

    headers = {
        "User-Agent":
            "NeuroNexus/1.0 "
            "(NASA Space Apps research project)"
    }

    async with aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        headers=headers,
    ) as session:

        tasks = [
            asyncio.create_task(
                download_one(
                    session,
                    item,
                    args.destination,
                    semaphore,
                    args.retries,
                )
            )
            for item in products
        ]

        downloaded = 0
        existed = 0
        failed = 0
        completed = 0
        total_bytes = 0

        with DEFAULT_MANIFEST.open(
            "a",
            buffering=1,
        ) as manifest, DEFAULT_FAILURES.open(
            "a",
            buffering=1,
        ) as failures:

            for future in asyncio.as_completed(tasks):

                result = await future

                completed += 1

                status = result["status"]

                if status == "downloaded":
                    downloaded += 1

                elif status == "exists":
                    existed += 1

                elif status == "failed":
                    failed += 1
                    failures.write(
                        json.dumps(result)
                        + "\n"
                    )

                total_bytes += result.get(
                    "bytes",
                    0,
                )

                manifest.write(
                    json.dumps(result)
                    + "\n"
                )

                if completed % 100 == 0:

                    print(
                        f"{completed:6,}/"
                        f"{len(products):,}  "
                        f"downloaded={downloaded:,}  "
                        f"exists={existed:,}  "
                        f"failed={failed:,}  "
                        f"data="
                        f"{total_bytes / 1024**3:,.2f} GiB"
                    )

    print()
    print("=" * 72)
    print("DOWNLOAD COMPLETE")
    print("=" * 72)
    print(f"Downloaded : {downloaded:,}")
    print(f"Existing   : {existed:,}")
    print(f"Failed     : {failed:,}")
    print(
        f"Data       : "
        f"{total_bytes / 1024**3:,.2f} GiB"
    )
    print()
    print(f"Manifest   : {DEFAULT_MANIFEST}")
    print(f"Failures   : {DEFAULT_FAILURES}")


if __name__ == "__main__":
    asyncio.run(main())
