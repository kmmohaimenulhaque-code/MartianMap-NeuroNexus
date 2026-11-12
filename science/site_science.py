from __future__ import annotations

from typing import Any


NASA_MARS_FACTS = (
    "https://science.nasa.gov/mars/"
)

NASA_MARS = (
    "https://science.nasa.gov/mars/"
)

NASA_CRISM = (
    "https://science.nasa.gov/mission/"
    "mars-reconnaissance-orbiter/crism/"
)

NASA_CURIOSITY = (
    "https://science.nasa.gov/mission/"
    "mars-science-laboratory/"
)

NASA_PDS = (
    "https://pds.nasa.gov/"
)


def _field(
    *,
    status: str,
    value: str,
    note: str,
    source: str,
    url: str | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "value": value,
        "note": note,
        "source": source,
        "url": url,
    }


def build_site_science(
    feature: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    Build the site-science context layer.

    This intentionally distinguishes actual measurements from
    global reference information and not-yet-ingested datasets.
    """

    name = str(
        (feature or {}).get(
            "feature_name"
        )
        or ""
    ).strip()

    folded = name.casefold()

    atmosphere: dict[str, Any] = {
        "status": "global_reference",
        "reference": "Mars global atmosphere",
        "gases": [
            {
                "name": "Carbon dioxide (CO₂)",
                "volume_percent": 95.3,
            },
            {
                "name": "Nitrogen (N₂)",
                "volume_percent": 2.7,
            },
            {
                "name": "Argon (Ar)",
                "volume_percent": 1.6,
            },
        ],
        "note": (
            "Global Mars atmosphere reference. These values are "
            "not treated as a site-specific measurement for every "
            "USGS feature."
        ),
        "source": "NASA Mars reference data",
        "url": NASA_MARS_FACTS,
    }

    if "gale" in folded:
        atmosphere = {
            "status": "site_measurement_context",
            "reference": (
                "Curiosity / Gale Crater atmospheric context"
            ),
            "gases": [
                {
                    "name": "Carbon dioxide (CO₂)",
                    "volume_percent": 95.9,
                },
                {
                    "name": "Argon (Ar)",
                    "volume_percent": None,
                },
                {
                    "name": "Nitrogen (N₂)",
                    "volume_percent": None,
                },
                {
                    "name": "Oxygen (O₂)",
                    "volume_percent": None,
                },
                {
                    "name": "Carbon monoxide (CO)",
                    "volume_percent": None,
                },
            ],
            "note": (
                "A Curiosity/SAM measurement context is available "
                "for Gale Crater. Only the explicitly represented "
                "measurement is shown numerically here."
            ),
            "source": "NASA Curiosity / SAM",
            "url": NASA_CURIOSITY,
        }

    soil = _field(
        status="context_only",
        value="Martian regolith / rock",
        note=(
            "NeuroNexus does not yet ingest a complete site-specific "
            "soil chemistry record for every USGS feature."
        ),
        source="NASA Mars reference data",
        url=NASA_MARS_FACTS,
    )

    minerals = _field(
        status="not_ingested",
        value=(
            "Site-specific mineral assemblage not yet loaded"
        ),
        note=(
            "Future ingestion can incorporate orbital mineralogy "
            "and rover-derived mineral/geochemical observations."
        ),
        source="NASA orbital + rover science archives",
        url=NASA_CRISM,
    )

    bioavailability = _field(
        status="proxy_only",
        value=(
            "No direct site-specific bioavailability conclusion"
        ),
        note=(
            "A defensible bioavailability layer needs site-linked "
            "evidence for water activity, nutrients, salts, oxidants, "
            "organics, and related environmental constraints."
        ),
        source="NeuroNexus science roadmap",
        url=NASA_PDS,
    )

    vegetation = _field(
        status="no_confirmed_native_vegetation",
        value="No confirmed native vegetation",
        note=(
            "NeuroNexus does not treat vegetation as an observed "
            "native Martian surface resource."
        ),
        source="NASA Mars reference data",
        url=NASA_MARS_FACTS,
    )

    return {
        "feature_name": name,
        "soil": soil,
        "minerals": minerals,
        "atmosphere": atmosphere,
        "bioavailability": bioavailability,
        "vegetation": vegetation,
        "provenance": {
            "note": (
                "Measured values are shown only when linked to an "
                "identified source and site context. Missing "
                "site-specific datasets remain explicitly marked."
            )
        },
    }
