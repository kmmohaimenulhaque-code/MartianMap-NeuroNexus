from __future__ import annotations
from science.terrain.api import router as terrain_router
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from science.weather.models.environment_assessment import assess_environment
from science.weather.models.mars_environment import MarsEnvironmentEngine


app = FastAPI(
    title="NeuroNexus Mars Environment Engine",
    version="1.1.0",
    description=(
        "Unified Mars environmental context API combining USGS "
        "nomenclature, NASA THEMIS historical thermal observations, "
        "NASA Ames Mars GCM dust scenarios, and NASA MOLA terrain."
    ),
)
app.include_router(terrain_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = MarsEnvironmentEngine()


# ---------------------------------------------------------------------------
# Environmental query
# ---------------------------------------------------------------------------

@app.get("/environment")
def environment(
    latitude: float = Query(
        ...,
        ge=-90,
        le=90,
        description="Mars latitude in degrees.",
    ),
    longitude: float = Query(
        ...,
        ge=-180,
        le=360,
        description="Mars longitude in degrees.",
    ),
    sol: int = Query(
        ...,
        ge=1,
        description="Mars sol index for the GCM dataset.",
    ),
    solar_longitude: float | None = Query(
        None,
        ge=0,
        le=360,
        description="Optional areocentric solar longitude in degrees.",
    ),
):
    """Return the unified environmental state for a Mars coordinate."""

    state = engine.get_environment(
        latitude=latitude,
        longitude=longitude,
        sol=sol,
        solar_longitude=solar_longitude,
    )

    state["assessment"] = assess_environment(state)

    return state


# ---------------------------------------------------------------------------
# Place listing
# ---------------------------------------------------------------------------

@app.get("/places")
def places(
    q: str | None = Query(
        None,
        min_length=1,
        description="Optional case-insensitive feature-name search.",
    ),
    limit: int = Query(
        2052,
        ge=1,
        le=2052,
        description="Maximum number of returned features.",
    ),
):
    """Return authoritative USGS Mars nomenclature features."""

    if q is not None:
        results = engine.gazetteer.find(q)
    else:
        results = engine.gazetteer.all()

    limited_results = results[:limit]

    return {
        "source": "USGS Gazetteer of Planetary Nomenclature",
        "count": len(limited_results),
        "total_matches": len(results),
        "features": list(limited_results),
    }


# ---------------------------------------------------------------------------
# Place search
# ---------------------------------------------------------------------------

@app.get("/places/search")
def places_search(
    q: str = Query(
        ...,
        min_length=1,
        description="Case-insensitive Mars feature-name search.",
    ),
    limit: int = Query(
        50,
        ge=1,
        le=2052,
        description="Maximum number of returned features.",
    ),
):
    """Search authoritative USGS Mars feature names."""

    results = engine.gazetteer.find(q)
    limited_results = results[:limit]

    return {
        "source": "USGS Gazetteer of Planetary Nomenclature",
        "query": q,
        "count": len(limited_results),
        "total_matches": len(results),
        "features": list(limited_results),
    }


# ---------------------------------------------------------------------------
# Place autocomplete / suggestions
# ---------------------------------------------------------------------------

@app.get("/places/suggest")
def places_suggest(
    q: str = Query(
        ...,
        min_length=1,
        description="Partial Mars feature name for autocomplete.",
    ),
    limit: int = Query(
        8,
        ge=1,
        le=20,
        description="Maximum number of suggestions.",
    ),
):
    """
    Return compact USGS feature suggestions for UI autocomplete.

    Matching order:
    1. Names beginning with the query.
    2. Names containing the query elsewhere.
    """

    needle = q.strip().casefold()

    if not needle:
        return {
            "source": "USGS Gazetteer of Planetary Nomenclature",
            "query": q,
            "count": 0,
            "suggestions": [],
        }

    starts_with: list[dict] = []
    contains: list[dict] = []

    for feature in engine.gazetteer.all():
        name = str(feature.get("feature_name", ""))
        folded_name = name.casefold()

        suggestion = {
            "feature_name": name,
            "clean_name": feature.get("clean_name"),
            "feature_type": feature.get("feature_type"),
            "diameter_km": feature.get("diameter_km"),
            "latitude_deg": feature.get("latitude_deg"),
            "longitude_deg": feature.get("longitude_deg"),
        }

        if folded_name.startswith(needle):
            starts_with.append(suggestion)
        elif needle in folded_name:
            contains.append(suggestion)

    suggestions = (starts_with + contains)[:limit]

    return {
        "source": "USGS Gazetteer of Planetary Nomenclature",
        "query": q,
        "count": len(suggestions),
        "suggestions": suggestions,
    }


# ---------------------------------------------------------------------------
# Nearest place
# ---------------------------------------------------------------------------

@app.get("/places/nearest")
def nearest_place(
    latitude: float = Query(
        ...,
        ge=-90,
        le=90,
        description="Mars latitude in degrees.",
    ),
    longitude: float = Query(
        ...,
        ge=-180,
        le=360,
        description="Mars longitude in degrees.",
    ),
):
    """Return the nearest registered USGS Mars feature."""

    feature = engine.gazetteer.nearest(
        latitude=latitude,
        longitude=longitude,
    )

    if feature is None:
        raise HTTPException(
            status_code=404,
            detail="No registered USGS Mars feature was found.",
        )

    return {
        "source": "USGS Gazetteer of Planetary Nomenclature",
        "latitude_deg": latitude,
        "longitude_deg": longitude,
        "feature": feature,
    }


# ---------------------------------------------------------------------------
# Nearby places
# ---------------------------------------------------------------------------

@app.get("/places/nearby")
def nearby_places(
    latitude: float = Query(
        ...,
        ge=-90,
        le=90,
        description="Mars latitude in degrees.",
    ),
    longitude: float = Query(
        ...,
        ge=-180,
        le=360,
        description="Mars longitude in degrees.",
    ),
    radius_km: float = Query(
        100.0,
        ge=0,
        le=10000,
        description="Search radius in kilometers.",
    ),
):
    """Return registered USGS Mars features within radius_km."""

    results = engine.gazetteer.nearby(
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
    )

    return {
        "source": "USGS Gazetteer of Planetary Nomenclature",
        "latitude_deg": latitude,
        "longitude_deg": longitude,
        "radius_km": radius_km,
        "count": len(results),
        "features": list(results),
    }


# ---------------------------------------------------------------------------
# Named-place environment query
# ---------------------------------------------------------------------------

@app.get("/environment/by-place")
def environment_by_place(
    name: str = Query(
        ...,
        min_length=1,
        description="Exact USGS Mars feature name.",
    ),
    sol: int = Query(
        ...,
        ge=1,
        description="Mars sol index for the GCM dataset.",
    ),
    solar_longitude: float | None = Query(
        None,
        ge=0,
        le=360,
        description="Optional areocentric solar longitude in degrees.",
    ),
):
    """
    Resolve an exact USGS Mars feature name and run the environment engine
    at that feature's authoritative Gazetteer center coordinate.
    """

    needle = name.strip().casefold()

    if not needle:
        raise HTTPException(
            status_code=400,
            detail="Place name must not be empty.",
        )

    matches = tuple(
        feature
        for feature in engine.gazetteer.all()
        if str(feature.get("feature_name", "")).casefold() == needle
    )

    if not matches:
        raise HTTPException(
            status_code=404,
            detail=f'USGS Mars feature "{name}" was not found.',
        )

    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail=f'USGS Mars feature name "{name}" is not unique.',
        )

    feature = matches[0]

    latitude = float(feature["latitude_deg"])
    longitude = float(feature["longitude_deg"])

    state = engine.get_environment(
        latitude=latitude,
        longitude=longitude,
        sol=sol,
        solar_longitude=solar_longitude,
    )

    state["assessment"] = assess_environment(state)

    state["query"] = {
        "mode": "named_place",
        "requested_name": name,
        "resolved_name": feature["feature_name"],
        "source": "USGS Gazetteer of Planetary Nomenclature",
    }

    state["gazetteer"]["selected_feature"] = feature

    return state
