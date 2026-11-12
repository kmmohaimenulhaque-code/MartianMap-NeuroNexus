from __future__ import annotations

from fastapi import (
    FastAPI,
    HTTPException,
    Query,
)

from fastapi.middleware.cors import (
    CORSMiddleware,
)

from science.media.rover_photos import (
    search_rover_photos,
)

from science.site_science import (
    build_site_science,
)

from science.terrain.api import (
    router as terrain_router,
)

from science.weather.models.environment_assessment import (
    assess_environment,
)

from science.weather.models.mars_environment import (
    MarsEnvironmentEngine,
)


app = FastAPI(
    title=(
        "NeuroNexus Mars Environment Engine"
    ),
    version="1.2.0",
    description=(
        "Unified Mars environmental context API "
        "combining USGS nomenclature, NASA THEMIS "
        "historical thermal observations, NASA Ames "
        "Mars GCM dust scenarios, and NASA MOLA terrain."
    ),
)


app.include_router(
    terrain_router
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


engine = MarsEnvironmentEngine()


@app.get("/environment")
def environment(
    latitude: float = Query(
        ...,
        ge=-90,
        le=90,
    ),
    longitude: float = Query(
        ...,
        ge=-180,
        le=360,
    ),
    sol: int = Query(
        ...,
        ge=1,
    ),
    solar_longitude: float | None = Query(
        None,
        ge=0,
        le=360,
    ),
):
    state = engine.get_environment(
        latitude=latitude,
        longitude=longitude,
        sol=sol,
        solar_longitude=solar_longitude,
    )

    state["assessment"] = (
        assess_environment(state)
    )

    nearest = (
        state
        .get("gazetteer", {})
        .get("nearest_feature")
    )

    if nearest:
        state["site_science"] = (
            build_site_science(
                nearest
            )
        )

    return state


@app.get("/places")
def places(
    q: str | None = Query(
        None,
        min_length=1,
        description=(
            "Optional case-insensitive "
            "feature-name search."
        ),
    ),
    limit: int = Query(
        2052,
        ge=1,
        le=2052,
    ),
):
    if q is not None:
        results = (
            engine.gazetteer.find(q)
        )
    else:
        results = (
            engine.gazetteer.all()
        )

    limited_results = (
        results[:limit]
    )

    return {
        "source": (
            "USGS Gazetteer of "
            "Planetary Nomenclature"
        ),
        "count": len(
            limited_results
        ),
        "total_matches": len(
            results
        ),
        "features": list(
            limited_results
        ),
    }


@app.get("/places/search")
def places_search(
    q: str = Query(
        ...,
        min_length=1,
    ),
    limit: int = Query(
        50,
        ge=1,
        le=2052,
    ),
):
    results = (
        engine.gazetteer.find(q)
    )

    limited_results = (
        results[:limit]
    )

    return {
        "source": (
            "USGS Gazetteer of "
            "Planetary Nomenclature"
        ),
        "query": q,
        "count": len(
            limited_results
        ),
        "total_matches": len(
            results
        ),
        "features": list(
            limited_results
        ),
    }


@app.get("/places/suggest")
def places_suggest(
    q: str = Query(
        ...,
        min_length=1,
    ),
    limit: int = Query(
        8,
        ge=1,
        le=20,
    ),
):
    needle = (
        q.strip()
        .casefold()
    )

    if not needle:
        return {
            "source": (
                "USGS Gazetteer of "
                "Planetary Nomenclature"
            ),
            "query": q,
            "count": 0,
            "suggestions": [],
        }

    starts_with: list[
        dict
    ] = []

    contains: list[
        dict
    ] = []

    for feature in (
        engine.gazetteer.all()
    ):
        name = str(
            feature.get(
                "feature_name",
                "",
            )
        )

        folded_name = (
            name.casefold()
        )

        suggestion = {
            "feature_name": name,
            "clean_name": feature.get(
                "clean_name"
            ),
            "feature_type": feature.get(
                "feature_type"
            ),
            "diameter_km": feature.get(
                "diameter_km"
            ),
            "latitude_deg": feature.get(
                "latitude_deg"
            ),
            "longitude_deg": feature.get(
                "longitude_deg"
            ),
        }

        if folded_name.startswith(
            needle
        ):
            starts_with.append(
                suggestion
            )
        elif needle in folded_name:
            contains.append(
                suggestion
            )

    suggestions = (
        starts_with
        + contains
    )[:limit]

    return {
        "source": (
            "USGS Gazetteer of "
            "Planetary Nomenclature"
        ),
        "query": q,
        "count": len(
            suggestions
        ),
        "suggestions": suggestions,
    }


@app.get("/places/nearest")
def nearest_place(
    latitude: float = Query(
        ...,
        ge=-90,
        le=90,
    ),
    longitude: float = Query(
        ...,
        ge=-180,
        le=360,
    ),
):
    feature = (
        engine.gazetteer.nearest(
            latitude=latitude,
            longitude=longitude,
        )
    )

    if feature is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No registered USGS Mars "
                "feature was found."
            ),
        )

    return {
        "source": (
            "USGS Gazetteer of "
            "Planetary Nomenclature"
        ),
        "latitude_deg": latitude,
        "longitude_deg": longitude,
        "feature": feature,
    }


@app.get("/places/nearby")
def nearby_places(
    latitude: float = Query(
        ...,
        ge=-90,
        le=90,
    ),
    longitude: float = Query(
        ...,
        ge=-180,
        le=360,
    ),
    radius_km: float = Query(
        100.0,
        ge=0,
        le=10000,
    ),
):
    results = (
        engine.gazetteer.nearby(
            latitude=latitude,
            longitude=longitude,
            radius_km=radius_km,
        )
    )

    return {
        "source": (
            "USGS Gazetteer of "
            "Planetary Nomenclature"
        ),
        "latitude_deg": latitude,
        "longitude_deg": longitude,
        "radius_km": radius_km,
        "count": len(results),
        "features": list(results),
    }


@app.get("/environment/by-place")
def environment_by_place(
    name: str = Query(
        ...,
        min_length=1,
    ),
    sol: int = Query(
        ...,
        ge=1,
    ),
    solar_longitude: float | None = Query(
        None,
        ge=0,
        le=360,
    ),
):
    needle = (
        name.strip()
        .casefold()
    )

    if not needle:
        raise HTTPException(
            status_code=400,
            detail=(
                "Place name must not be empty."
            ),
        )

    matches = tuple(
        feature
        for feature in (
            engine.gazetteer.all()
        )
        if str(
            feature.get(
                "feature_name",
                "",
            )
        ).casefold() == needle
    )

    if not matches:
        raise HTTPException(
            status_code=404,
            detail=(
                f'USGS Mars feature "{name}" '
                "was not found."
            ),
        )

    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail=(
                f'USGS Mars feature name "{name}" '
                "is not unique."
            ),
        )

    feature = matches[0]

    latitude = float(
        feature["latitude_deg"]
    )

    longitude = float(
        feature["longitude_deg"]
    )

    state = engine.get_environment(
        latitude=latitude,
        longitude=longitude,
        sol=sol,
        solar_longitude=solar_longitude,
    )

    state["assessment"] = (
        assess_environment(state)
    )

    state["query"] = {
        "mode": "named_place",
        "requested_name": name,
        "resolved_name": (
            feature["feature_name"]
        ),
        "source": (
            "USGS Gazetteer of "
            "Planetary Nomenclature"
        ),
    }

    state[
        "gazetteer"
    ][
        "selected_feature"
    ] = feature

    state["site_science"] = (
        build_site_science(
            feature
        )
    )

    return state


@app.get("/media/rover-photos")
def rover_photos(
    name: str = Query(
        ...,
        min_length=1,
        description=(
            "Mars feature or site name."
        ),
    ),
    limit: int = Query(
        8,
        ge=1,
        le=12,
    ),
):
    return search_rover_photos(
        name,
        limit=limit,
    )
