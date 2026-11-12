from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from science.terrain.tile_renderer import (
    MOLA128TileRenderer,
)


router = APIRouter(
    prefix="/terrain",
    tags=["terrain"],
)

renderer = MOLA128TileRenderer()


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
