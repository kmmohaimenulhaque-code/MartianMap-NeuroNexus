from __future__ import annotations

from pathlib import Path
import json
import geopandas as gpd
import pandas as pd


SOURCE = Path(
    "data/raw/gazetteer/mars/center_pts/"
    "MARS_nomenclature_center_pts.shp"
)

OUTPUT = Path(
    "data/processed/gazetteer/"
    "mars_nomenclature_center_pts.parquet"
)

MANIFEST = Path(
    "data/manifests/"
    "mars_gazetteer.json"
)


def normalize_longitude(value: float) -> float:
    value = float(value) % 360.0

    # Keep the canonical MOLA convention [0, 360).
    if value == 360.0:
        value = 0.0

    return value


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)

    gdf = gpd.read_file(SOURCE)

    required = {
        "name",
        "clean_name",
        "approvaldt",
        "origin",
        "diameter",
        "center_lon",
        "center_lat",
        "type",
        "code",
        "approval",
        "min_lon",
        "max_lon",
        "min_lat",
        "max_lat",
        "ethnicity",
        "continent",
        "quad_name",
        "quad_code",
        "link",
        "geometry",
    }

    missing = required - set(gdf.columns)

    if missing:
        raise RuntimeError(
            f"Missing required USGS fields: {sorted(missing)}"
        )

    # Preserve authoritative USGS values while creating
    # explicit NeuroNexus spatial fields.
    out = pd.DataFrame(
        {
            "feature_name": gdf["name"].astype(str),
            "clean_name": gdf["clean_name"].astype(str),

            "approval_date": pd.to_datetime(
                gdf["approvaldt"],
                errors="coerce",
            ).dt.strftime("%Y-%m-%d"),

            "naming_origin": gdf["origin"].astype(str),

            "diameter_km": pd.to_numeric(
                gdf["diameter"],
                errors="coerce",
            ),

            "longitude_deg": gdf["center_lon"].map(
                normalize_longitude
            ),

            "latitude_deg": pd.to_numeric(
                gdf["center_lat"],
                errors="coerce",
            ),

            "feature_type": gdf["type"].astype(str),
            "feature_code": gdf["code"].astype(str),
            "approval_status": gdf["approval"].astype(str),

            "min_longitude_deg": gdf["min_lon"].map(
                normalize_longitude
            ),

            "max_longitude_deg": gdf["max_lon"].map(
                normalize_longitude
            ),

            "min_latitude_deg": pd.to_numeric(
                gdf["min_lat"],
                errors="coerce",
            ),

            "max_latitude_deg": pd.to_numeric(
                gdf["max_lat"],
                errors="coerce",
            ),

            "namesake_ethnicity": gdf["ethnicity"],
            "namesake_continent": gdf["continent"],

            "quadrangle_name": gdf["quad_name"],
            "quadrangle_code": gdf["quad_code"],

            "usgs_feature_url": gdf["link"].astype(str),

            "geometry": gdf.geometry,
        }
    )

    # Convert back to GeoDataFrame so CRS is preserved.
    result = gpd.GeoDataFrame(
        out,
        geometry="geometry",
        crs=gdf.crs,
    )

    # Hard validation.
    assert len(result) == 2052
    assert result["feature_name"].notna().all()
    assert result["latitude_deg"].between(-90, 90).all()
    assert result["longitude_deg"].between(0, 360, inclusive="left").all()
    assert result["diameter_km"].notna().all()
    assert result["feature_type"].notna().all()
    assert result["usgs_feature_url"].notna().all()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    result.to_parquet(
        OUTPUT,
        index=False,
    )

    manifest = {
        "project": "NeuroNexus",
        "version": "0.3.0",
        "dataset_id": "mars_usgs_gazetteer",
        "dataset_type": "planetary_nomenclature",
        "authority": {
            "organization": "USGS",
            "program": "Gazetteer of Planetary Nomenclature",
            "target": "Mars",
        },
        "source_archive": (
            "MARS_nomenclature_center_pts.zip"
        ),
        "source_format": "ESRI Shapefile",
        "derived_format": "GeoParquet",
        "feature_count": len(result),
        "coordinate_convention": {
            "latitude": "planetocentric degrees",
            "longitude": "east longitude [0,360)",
        },
        "crs": str(gdf.crs),
        "fields": list(result.columns),
        "source_geometry": "feature center points",
        "status": "validated",
    }

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)

    MANIFEST.write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )

    print("========================================")
    print("USGS MARS GAZETTEER IMPORT")
    print("========================================")
    print("Features :", len(result))
    print("Output   :", OUTPUT)
    print("Manifest :", MANIFEST)
    print("CRS      :", result.crs)
    print()
    print("FEATURE TYPE COUNT:")
    print(result["feature_type"].value_counts().to_string())
    print()
    print("USGS MARS GAZETTEER → GEOPARQUET: GREEN")


if __name__ == "__main__":
    main()
