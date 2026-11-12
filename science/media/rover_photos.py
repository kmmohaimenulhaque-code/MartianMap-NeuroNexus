from __future__ import annotations

from functools import lru_cache
from typing import Any

import httpx


NASA_IMAGE_SEARCH = (
    "https://images-api.nasa.gov/search"
)


KNOWN_ROVERS = (
    "Curiosity",
    "Perseverance",
    "Opportunity",
    "Spirit",
)


SITE_ROVER_HINTS = {
    "gale": ("Curiosity",),
    "jezero": ("Perseverance",),
    "endeavour": ("Opportunity",),
    "gusev": ("Spirit",),
}


def _tokens(
    value: str,
) -> set[str]:
    cleaned = "".join(
        ch.lower() if ch.isalnum() else " "
        for ch in value
    )

    return {
        token
        for token in cleaned.split()
        if len(token) >= 4
    }


def _matches_place(
    metadata_blob: str,
    place_name: str,
) -> bool:
    name_tokens = _tokens(
        place_name
    )

    if not name_tokens:
        return True

    return any(
        token in metadata_blob
        for token in name_tokens
    )


def _preview_link(
    item: dict[str, Any],
) -> str | None:
    for link in (
        item.get("links", [])
        or []
    ):
        relation = link.get("rel")
        href = link.get("href")

        if (
            relation in {
                "preview",
                "image",
            }
            and href
        ):
            return str(href)

    return None


@lru_cache(maxsize=64)
def _search(
    place_name: str,
    limit: int,
) -> dict[str, Any]:
    normalized = place_name.strip()

    if not normalized:
        return {
            "source": "NASA Image and Video Library",
            "query": normalized,
            "status": "not_applicable",
            "count": 0,
            "photos": [],
            "message": "NO PHOTOS APPLICABLE",
        }

    hinted_rovers: list[str] = []

    folded = normalized.casefold()

    for key, rovers in SITE_ROVER_HINTS.items():
        if key in folded:
            hinted_rovers.extend(
                rovers
            )

    rover_targets = (
        hinted_rovers
        or list(KNOWN_ROVERS)
    )

    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    try:
        with httpx.Client(
            timeout=15.0
        ) as client:
            for rover in rover_targets:
                response = client.get(
                    NASA_IMAGE_SEARCH,
                    params={
                        "q": (
                            f"Mars {normalized} "
                            f"{rover} rover"
                        ),
                        "media_type": "image",
                        "page_size": min(
                            max(limit, 1),
                            100,
                        ),
                    },
                )

                response.raise_for_status()

                payload = response.json()

                items = (
                    payload
                    .get("collection", {})
                    .get("items", [])
                    or []
                )

                for item in items:
                    data_entries = (
                        item.get("data", [])
                        or []
                    )

                    if not data_entries:
                        continue

                    metadata = data_entries[0]

                    item_id = str(
                        metadata.get("nasa_id")
                        or item.get("href")
                        or ""
                    )

                    if (
                        not item_id
                        or item_id in seen_ids
                    ):
                        continue

                    title = str(
                        metadata.get(
                            "title"
                        )
                        or ""
                    )

                    description = str(
                        metadata.get(
                            "description"
                        )
                        or ""
                    )

                    keywords = " ".join(
                        str(value)
                        for value in (
                            metadata.get(
                                "keywords",
                                [],
                            )
                            or []
                        )
                    )

                    blob = " ".join(
                        [
                            title,
                            description,
                            keywords,
                        ]
                    ).casefold()

                    if (
                        rover.casefold()
                        not in blob
                    ):
                        continue

                    if not _matches_place(
                        blob,
                        normalized,
                    ):
                        continue

                    preview_url = _preview_link(
                        item
                    )

                    if not preview_url:
                        continue

                    seen_ids.add(
                        item_id
                    )

                    results.append(
                        {
                            "id": item_id,
                            "title": (
                                title
                                or item_id
                            ),
                            "description": (
                                description
                            ),
                            "preview_url": (
                                preview_url
                            ),
                            "nasa_url": (
                                "https://images.nasa.gov/"
                                f"details/{item_id}"
                            ),
                            "rover": rover,
                            "match_scope": (
                                "NASA Image and Video Library "
                                "metadata match"
                            ),
                        }
                    )

                    if len(results) >= limit:
                        break

                if len(results) >= limit:
                    break

    except (
        httpx.HTTPError,
        ValueError,
        TypeError,
    ):
        return {
            "source": (
                "NASA Image and Video Library"
            ),
            "query": normalized,
            "status": "unavailable",
            "count": 0,
            "photos": [],
            "message": (
                "NASA Image and Video Library "
                "query is currently unavailable."
            ),
        }

    if not results:
        return {
            "source": (
                "NASA Image and Video Library"
            ),
            "query": normalized,
            "status": "not_applicable",
            "count": 0,
            "photos": [],
            "message": "NO PHOTOS APPLICABLE",
        }

    return {
        "source": (
            "NASA Image and Video Library"
        ),
        "query": normalized,
        "status": "available",
        "count": len(results),
        "photos": results,
    }


def search_rover_photos(
    place_name: str,
    limit: int = 8,
) -> dict[str, Any]:
    safe_limit = min(
        max(int(limit), 1),
        12,
    )

    return _search(
        place_name.strip(),
        safe_limit,
    )
