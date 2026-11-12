from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from science.terrain.derivatives import MOLA128Derivatives
from science.terrain.mola128_window import (
    MOLA128WindowExtractor,
)
from science.terrain.route_planner import (
    MarsRoutePlanner,
)
from science.terrain.tile_renderer import (
    MOLA128TileRenderer,
)


router = APIRouter(
    prefix="/terrain",
    tags=["terrain"],
)

renderer = MOLA128TileRenderer()

window_extractor = MOLA128WindowExtractor()

derivative_engine = MOLA128Derivatives()

route_planner = MarsRoutePlanner(
    extractor=window_extractor,
    derivatives=derivative_engine,
)


@router.get("/metadata")
def terrain_metadata():
    return renderer.metadata()


@router.get("/tile/{z}/{x}/{y}.png")
def terrain_tile(
    z: int,
    x: int,
    y: int,
):
    try:
        png = renderer.render_png(
            z=z,
            x=x,
            y=y,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.get("/window")
def terrain_window(
    latitude: float = Query(
        ...,
        ge=-88,
        le=88,
    ),
    longitude: float = Query(
        ...,
        ge=0,
        le=360,
    ),
    width_km: float = Query(
        40.0,
        gt=0,
        le=500,
    ),
    height_km: float = Query(
        40.0,
        gt=0,
        le=500,
    ),
):
    """
    Return a local high-resolution MOLA terrain window.

    The elevation grid comes directly from the NASA MOLA
    MEGDR 128 pixels/degree products.

    Derivatives are calculated server-side so the frontend
    never invents or approximates terrain science.
    """

    try:
        window = window_extractor.extract(
            latitude_deg=latitude,
            longitude_deg=longitude,
            width_km=width_km,
            height_km=height_km,
        )

        derivatives = derivative_engine.compute(
            window
        )

    except (
        ValueError,
        FileNotFoundError,
    ) as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    elevations = (
        window.elevations_m
        .astype(float)
        .tolist()
    )

    slope = (
        derivatives.slope_deg
        .astype(float)
        .tolist()
    )

    aspect = (
        derivatives.aspect_deg
        .astype(float)
        .tolist()
    )

    roughness = (
        derivatives.roughness_m
        .astype(float)
        .tolist()
    )

    return {
        "source": (
            "NASA MOLA MEGDR "
            "128 pixels/degree"
        ),
        "dataset": (
            "MGS-M-MOLA-5-MEGDR-L3-V1.0"
        ),
        "center": {
            "latitude_deg": (
                window.center_latitude_deg
            ),
            "longitude_deg": (
                window.center_longitude_deg
            ),
        },
        "width_km": window.width_km,
        "height_km": window.height_km,
        "rows": window.rows,
        "cols": window.cols,
        "pixels_per_degree": (
            window.pixels_per_degree
        ),
        "sample_spacing_deg": (
            1.0 / window.pixels_per_degree
        ),
        "latitudes_deg": (
            window.latitudes_deg.tolist()
        ),
        "longitudes_deg": (
            window.longitudes_deg.tolist()
        ),
        "elevations_m": elevations,
        "slope_deg": slope,
        "aspect_deg": aspect,
        "roughness_m": roughness,
        "summary": {
            "elevation_min_m": float(
                window.elevations_m.min()
            ),
            "elevation_max_m": float(
                window.elevations_m.max()
            ),
            "slope_max_deg": float(
                derivatives.slope_deg.max()
            ),
            "slope_mean_deg": float(
                derivatives.slope_deg.mean()
            ),
            "roughness_max_m": float(
                derivatives.roughness_m.max()
            ),
            "roughness_mean_m": float(
                derivatives.roughness_m.mean()
            ),
        },
    }


@router.get("/route")
def terrain_route(
    start_latitude: float = Query(
        ...,
        ge=-88,
        le=88,
    ),
    start_longitude: float = Query(
        ...,
        ge=0,
        le=360,
    ),
    end_latitude: float = Query(
        ...,
        ge=-88,
        le=88,
    ),
    end_longitude: float = Query(
        ...,
        ge=0,
        le=360,
    ),
    corridor_width_km: float = Query(
        20.0,
        gt=0,
        le=500,
    ),
    corridor_height_km: float = Query(
        20.0,
        gt=0,
        le=500,
    ),
):
    """
    Compute a terrain-aware A* route between two
    Mars surface coordinates.

    IMPORTANT:
    The terrain cost is a NeuroNexus research heuristic.
    It is not a NASA-certified mission safety score.
    """

    try:
        route = route_planner.plan(
            start_latitude=(
                start_latitude
            ),
            start_longitude=(
                start_longitude
            ),
            end_latitude=end_latitude,
            end_longitude=end_longitude,
            corridor_width_km=(
                corridor_width_km
            ),
            corridor_height_km=(
                corridor_height_km
            ),
        )
    except (
        ValueError,
        FileNotFoundError,
        RuntimeError,
    ) as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "source": (
            "NeuroNexus terrain-aware "
            "A* planner using NASA MOLA"
        ),
        "model": {
            "type": "A*",
            "terrain_cost": (
                "research heuristic"
            ),
            "certification": (
                "not mission-certified"
            ),
        },
        "start": {
            "latitude_deg": (
                start_latitude
            ),
            "longitude_deg": (
                start_longitude % 360.0
            ),
        },
        "end": {
            "latitude_deg": (
                end_latitude
            ),
            "longitude_deg": (
                end_longitude % 360.0
            ),
        },
        "route": {
            "coordinates": [
                [
                    float(latitude),
                    float(longitude),
                ]
                for latitude, longitude
                in route.coordinates
            ],
            "point_count": len(
                route.coordinates
            ),
            "distance_km": float(
                route.distance_km
            ),
            "terrain_cost": float(
                route.terrain_cost
            ),
            "max_slope_deg": float(
                route.max_slope_deg
            ),
            "mean_slope_deg": float(
                route.mean_slope_deg
            ),
            "mean_roughness_m": float(
                route.mean_roughness_m
            ),
        },
    }
