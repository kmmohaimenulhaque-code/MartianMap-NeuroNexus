from __future__ import annotations

import json
from pathlib import Path

from science.gazetteer.mars_places import MarsGazetteer
from science.landing_sites import LandingSiteRegistry
from science.landing_sites.context import LandingSiteContextBuilder


LANDING_MANIFEST = Path(
    "data/manifests/mars_landing_sites.json"
)

MOLA_CATALOG = Path(
    "data/manifests/mola_tiles.json"
)

OUTPUT = Path(
    "data/manifests/landing_site_contexts.json"
)


def main() -> None:
    landing = LandingSiteRegistry(LANDING_MANIFEST)

    builder = LandingSiteContextBuilder(
        MOLA_CATALOG,
        MarsGazetteer(),
    )

    contexts = []

    for site in landing.all():
        context = builder.build(site)

        contexts.append(
            {
                "site_id": context.site_id,
                "mission": context.mission,
                "spacecraft": context.spacecraft,
                "region": context.region,

                "location": {
                    "latitude_deg": context.latitude_deg,
                    "longitude_deg": context.longitude_deg
                },

                "terrain": {
                    "elevation_m": context.elevation_m,
                    "slope_deg": context.slope_deg,
                    "aspect_deg": context.aspect_deg,
                    "roughness_m": context.roughness_m
                },

                "nearby_places": list(
                    context.nearby_places
                )
            }
        )

    payload = {
        "project": "NeuroNexus",
        "version": "0.1.0",
        "dataset_type": "landing_site_spatial_context",
        "source": {
            "landing_sites": str(LANDING_MANIFEST),
            "terrain": "NASA MOLA MEGDR 128 ppd",
            "gazetteer": "NeuroNexus Mars Gazetteer"
        },
        "sites": contexts
    }

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT.write_text(
        json.dumps(
            payload,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("Exported:", OUTPUT)
    print("Landing sites:", len(contexts))

    for item in contexts:
        terrain = item["terrain"]

        print(
            f'{item["site_id"]:28} '
            f'elev={terrain["elevation_m"]:10.2f} m '
            f'slope={terrain["slope_deg"]:7.3f}° '
            f'rough={terrain["roughness_m"]:7.2f} m'
        )

    assert len(contexts) == 9

    print()
    print("ALL LANDING SITE CONTEXTS: GREEN")


if __name__ == "__main__":
    main()
