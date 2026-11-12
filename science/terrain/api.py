from __future__ import annotations

from typing import Any

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
)

from fastapi.responses import Response

from pydantic import BaseModel, Field

from science.terrain.derivatives import (
    MOLA128Derivatives,
)

from science.terrain.local_waypoint_analysis import (
    sample_waypoint,
)

from science.terrain.mola128_window import (
    MOLA128WindowExtractor,
)

from science.terrain.route_geometry import (
    RoutePoint,
    build_route_plan,
)

from science.terrain.tile_renderer import (
    MOLA128TileRenderer,
)

from science.terrain.contour_renderer import MOLA128ContourRenderer

router = APIRouter(
    prefix="/terrain",
    tags=["terrain"],
)


renderer = MOLA128TileRenderer()

contour_renderer = MOLA128ContourRenderer(
    renderer=renderer,
)

window_extractor = (
    MOLA128WindowExtractor()
)

derivative_engine = (
    MOLA128Derivatives()
)


class RoutePointInput(BaseModel):
    latitude_deg: float = Field(
        ge=-88.0,
        le=88.0,
        description=(
            "Mars latitude in degrees."
        ),
    )

    longitude_deg: float = Field(
        ge=0.0,
        lt=360.0,
        description=(
            "Mars longitude in degrees [0, 360)."
        ),
    )

    label: str | None = Field(
        default=None,
        max_length=120,
    )


class RoutePlanRequest(BaseModel):
    points: list[
        RoutePointInput
    ] = Field(
        min_length=2,
        max_length=32,
        description=(
            "User-defined route waypoints "
            "in traversal order."
        ),
    )


@router.get("/metadata")
def terrain_metadata() -> dict:
    return renderer.metadata()


@router.get(
    "/tile/{z}/{x}/{y}.png"
)
def terrain_tile(
    z: int,
    x: int,
    y: int,
):
    try:
        png = (
            renderer.render_png(
                z=z,
                x=x,
                y=y,
            )
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
            "Cache-Control": (
                "public, max-age=86400"
            ),
        },
    )


@router.get(
    "/contours/{z}/{x}/{y}.svg"
)
def terrain_contours(
    z: int,
    x: int,
    y: int,
):
    """
    Return one transparent SVG contour tile
    generated directly from real MOLA elevation.

    The SVG contains:
      - minor contour lines
      - thicker index contours
      - elevation labels

    It contains no background raster.
    """

    try:
        svg = (
           contour_renderer.render_svg(
                z=z,
                x=x,
                y=y,
            )
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
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": (
                "public, max-age=86400"
            ),
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
        4.0,
        gt=0,
        le=20,
    ),
    height_km: float = Query(
        4.0,
        gt=0,
        le=20,
    ),
) -> dict[str, Any]:
    """
    Return a bounded local high-resolution
    MOLA terrain window.

    This endpoint is only for local terrain
    inspection and is deliberately capped.
    """

    try:
        window = (
            window_extractor.extract(
                latitude_deg=latitude,
                longitude_deg=longitude,
                width_km=width_km,
                height_km=height_km,
            )
        )

        derivatives = (
            derivative_engine.compute(
                window
            )
        )

    except (
        ValueError,
        FileNotFoundError,
    ) as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

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
        "width_km": (
            window.width_km
        ),
        "height_km": (
            window.height_km
        ),
        "rows": window.rows,
        "cols": window.cols,
        "pixels_per_degree": (
            window.pixels_per_degree
        ),
        "sample_spacing_deg": (
            1.0
            /
            window.pixels_per_degree
        ),
        "latitudes_deg": (
            window.latitudes_deg
            .tolist()
        ),
        "longitudes_deg": (
            window.longitudes_deg
            .tolist()
        ),
        "elevations_m": (
            window.elevations_m
            .astype(float)
            .tolist()
        ),
        "slope_deg": (
            derivatives.slope_deg
            .astype(float)
            .tolist()
        ),
        "aspect_deg": (
            derivatives.aspect_deg
            .astype(float)
            .tolist()
        ),
        "roughness_m": (
            derivatives.roughness_m
            .astype(float)
            .tolist()
        ),
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


def _analyze_waypoint(
    point: RoutePoint,
) -> dict[str, Any]:
    try:
        terrain = (
            sample_waypoint(
                latitude_deg=(
                    point.latitude_deg
                ),
                longitude_deg=(
                    point.longitude_deg
                ),
            )
        )

    except (
        ValueError,
        FileNotFoundError,
    ) as exc:
        return {
            "label": point.label,
            "latitude_deg": (
                point.latitude_deg
            ),
            "longitude_deg": (
                point.longitude_deg
            ),
            "status": "unavailable",
            "message": str(exc),
        }

    return {
        "label": point.label,
        "latitude_deg": (
            point.latitude_deg
        ),
        "longitude_deg": (
            point.longitude_deg
        ),
        "status": "available",
        "source": (
            "NASA MOLA MEGDR "
            "128 pixels/degree"
        ),
        "sample_grid": (
            f"{terrain.sample_grid_size}x"
            f"{terrain.sample_grid_size} "
            "pixels"
        ),
        "elevation_m": (
            terrain.elevation_m
        ),
        "slope_deg": (
            terrain.slope_deg
        ),
        "aspect_deg": (
            terrain.aspect_deg
        ),
        "roughness_m": (
            terrain.roughness_m
        ),
        "local_elevation_min_m": (
            terrain.local_min_m
        ),
        "local_elevation_max_m": (
            terrain.local_max_m
        ),
    }


def _build_guidance(
    analysis: list[
        dict[str, Any]
    ],
) -> dict[str, Any]:
    notes: list[str] = []

    available = [
        item
        for item in analysis
        if item.get("status")
        == "available"
    ]

    unavailable = [
        item
        for item in analysis
        if item.get("status")
        != "available"
    ]

    if any(
        float(
            item["slope_deg"]
        )
        >= 25.0
        for item in available
    ):
        notes.append(
            "One or more selected waypoints "
            "have a local slope of 25° or greater. "
            "Manually review the planned path."
        )

    elif any(
        float(
            item["slope_deg"]
        )
        >= 15.0
        for item in available
    ):
        notes.append(
            "One or more selected waypoints "
            "have a local slope of 15° or greater. "
            "Manually review the planned path."
        )

    if any(
        float(
            item["roughness_m"]
        )
        >= 100.0
        for item in available
    ):
        notes.append(
            "At least one waypoint has relatively "
            "high local MOLA roughness. Consider "
            "rover mobility constraints."
        )

    if unavailable:
        notes.append(
            f"Local MOLA analysis was unavailable "
            f"at {len(unavailable)} waypoint(s). "
            "Those locations must not be treated "
            "as analyzed."
        )

    if not notes:
        notes.append(
            "No threshold-based terrain warning "
            "was triggered at the selected "
            "waypoint samples."
        )

    return {
        "engine": (
            "NeuroNexus waypoint terrain "
            "guidance v0.1"
        ),
        "ai_context_ready": True,
        "ai_model_connected": False,
        "notes": notes,
        "disclaimer": (
            "Guidance is a NeuroNexus research aid, "
            "not a NASA-certified mission safety "
            "assessment."
        ),
    }


@router.post(
    "/route-plan"
)
def route_plan(
    request: RoutePlanRequest,
) -> dict[str, Any]:
    """
    Build a user-defined multi-point Mars route.

    Distance is pure Haversine geometry over the
    selected waypoints.

    No:
      - corridor search
      - A*
      - route-wide MOLA raster search
    """

    points = [
        RoutePoint(
            latitude_deg=float(
                item.latitude_deg
            ),
            longitude_deg=float(
                item.longitude_deg
            ),
            label=(
                item.label
                or f"WP {index}"
            )
            .strip()[:120],
        )
        for index, item in enumerate(
            request.points,
            start=1,
        )
    ]

    try:
        geometry = (
            build_route_plan(
                points
            )
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    waypoint_analysis = [
        _analyze_waypoint(
            point
        )
        for point in points
    ]

    return {
        "source": (
            "NeuroNexus user-defined "
            "route geometry"
        ),
        "model": {
            "distance": (
                "Haversine great-circle "
                "surface distance on "
                "spherical Mars"
            ),
            "routing": (
                "user_defined_waypoints"
            ),
            "terrain_search": "none",
            "waypoint_terrain": (
                "small local 3x3 "
                "MOLA sample per waypoint"
            ),
            "certification": (
                "not mission-certified"
            ),
        },
        "displacement": {
            "distance_km": (
                geometry[
                    "displacement_km"
                ]
            ),
            "start": (
                geometry[
                    "waypoints"
                ][0]
            ),
            "end": (
                geometry[
                    "waypoints"
                ][-1]
            ),
        },
        "planned_route": geometry,
        "waypoint_analysis": (
            waypoint_analysis
        ),
        "guidance": (
            _build_guidance(
                waypoint_analysis
            )
        ),
    }
