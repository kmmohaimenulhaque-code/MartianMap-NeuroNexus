from pathlib import Path

from science.landing_sites import LandingSiteRegistry
from science.spatial.mola_core import MolaSpatialCore


MANIFEST = Path("data/manifests/mars_landing_sites.json")
MOLA_CATALOG = Path("data/manifests/mola_tiles.json")


def main() -> None:
    landing = LandingSiteRegistry(MANIFEST)
    mola = MolaSpatialCore(MOLA_CATALOG)

    sites = landing.all()

    print(f"Landing sites: {len(sites)}")
    print()

    for site in sites:
        result = mola.query(
            site.latitude_deg,
            site.longitude_deg,
        )

        print(
            f"{site.site_id:28} "
            f"lat={site.latitude_deg:9.4f} "
            f"lon={site.longitude_deg:9.4f} "
            f"elev={result['elevation_m']:10.2f} m "
            f"tile={result['tile']}"
        )

        assert -90 <= result["latitude"] <= 90
        assert 0 <= result["longitude"] < 360
        assert result["dataset"] == "MOLA MEGDR 128 ppd"
        assert result["projection"] == "SIMPLE CYLINDRICAL"
        assert result["elevation_m"] is not None
        assert result["tile"]

    print()
    print("LANDING → MOLA SPATIAL VALIDATION: GREEN")


if __name__ == "__main__":
    main()
