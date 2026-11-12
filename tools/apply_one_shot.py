from __future__ import annotations

from pathlib import Path

ROOT = Path.cwd()


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 match, found {count}")
    path.write_text(text.replace(old, new), encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. Copy the new mission operations component.
# ---------------------------------------------------------------------------
src = Path(__file__).resolve().parents[1] / "frontend/src/components/mission/MissionOpsPanel.jsx"
dst = ROOT / "frontend/src/components/mission/MissionOpsPanel.jsx"
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

# ---------------------------------------------------------------------------
# 2. App.jsx: add the mission operations panel without disturbing existing UI.
# ---------------------------------------------------------------------------
app = ROOT / "frontend/src/App.jsx"
replace_once(
    app,
    "import SiteSciencePanel from './components/mars/SiteSciencePanel'\n",
    "import SiteSciencePanel from './components/mars/SiteSciencePanel'\nimport MissionOpsPanel from './components/mission/MissionOpsPanel'\n",
)
replace_once(
    app,
    "          <MissionSystemsPanel />\n",
    "          <Panel\n            eyebrow=\"MISSION / OPERATIONS\"\n            title=\"Crewed Mars console\"\n          >\n            <MissionOpsPanel\n              selectedFeature={place}\n              sol={DEFAULT_SOL}\n              environment={environment}\n              routePlan={routePlan}\n            />\n          </Panel>\n",
)

# ---------------------------------------------------------------------------
# 3. Topographic map: add transparent real-MOLA contour tiles.
# ---------------------------------------------------------------------------
topo = ROOT / "frontend/src/components/mars/MarsTopographicMap.jsx"
replace_once(
    topo,
    "        <TileLayer\n          url=\"/api/terrain/tile/{z}/{x}/{y}.png\"\n          tileSize={180}\n          minZoom={0}\n          maxZoom={7}\n          noWrap\n          bounds={MARS_BOUNDS}\n        />\n",
    "        <TileLayer\n          url=\"/api/terrain/tile/{z}/{x}/{y}.png\"\n          tileSize={180}\n          minZoom={0}\n          maxZoom={7}\n          noWrap\n          bounds={MARS_BOUNDS}\n        />\n\n        <TileLayer\n          url=\"/api/terrain/contours/{z}/{x}/{y}.svg\"\n          tileSize={180}\n          minZoom={0}\n          maxZoom={7}\n          noWrap\n          bounds={MARS_BOUNDS}\n          opacity={0.95}\n        />\n",
)
replace_once(
    topo,
    "          128 PP DEG NATIVE MOLA TILES ·\n          HILLSHADE + ELEVATION TINT\n",
    "          128 PP DEG NATIVE MOLA TILES ·\n          HILLSHADE + ELEVATION TINT + CONTOURS\n",
)

# ---------------------------------------------------------------------------
# 4. Terrain API: expose the contour SVG tiles.
# ---------------------------------------------------------------------------
api = ROOT / "science/terrain/api.py"
replace_once(
    api,
    "from science.terrain.tile_renderer import (\n    MOLA128TileRenderer,\n)\n",
    "from science.terrain.tile_renderer import (\n    MOLA128TileRenderer,\n)\n\nfrom science.terrain.contour_renderer import (\n    contour_renderer,\n)\n",
)
replace_once(
    api,
    "renderer = MOLA128TileRenderer()\nwindow_extractor = MOLA128WindowExtractor()\n",
    "renderer = MOLA128TileRenderer()\nwindow_extractor = MOLA128WindowExtractor()\n",
)
needle = '''@router.get("/window")\ndef terrain_window(\n'''
insert = '''@router.get("/contours/{z}/{x}/{y}.svg")\ndef terrain_contours(\n    z: int,\n    x: int,\n    y: int,\n):\n    try:\n        svg = contour_renderer.render_svg(\n            z=z,\n            x=x,\n            y=y,\n        )\n    except ValueError as exc:\n        raise HTTPException(\n            status_code=400,\n            detail=str(exc),\n        ) from exc\n    except FileNotFoundError as exc:\n        raise HTTPException(\n            status_code=503,\n            detail=str(exc),\n        ) from exc\n\n    return Response(\n        content=svg,\n        media_type="image/svg+xml",\n        headers={\n            "Cache-Control": "public, max-age=86400",\n        },\n    )\n\n\n@router.get("/window")\ndef terrain_window(\n'''
replace_once(api, needle, insert)

# ---------------------------------------------------------------------------
# 4b. Copy mission state/API package for an AI-ready backend contract.
# ---------------------------------------------------------------------------
mission_src = Path(__file__).resolve().parents[1] / "science/mission"
mission_dst = ROOT / "science/mission"
mission_dst.mkdir(parents=True, exist_ok=True)
for name in ("__init__.py", "state.py", "api.py"):
    (mission_dst / name).write_text(
        (mission_src / name).read_text(encoding="utf-8"),
        encoding="utf-8",
    )

# environment.py: expose /mission/state without affecting existing endpoints.
env = ROOT / "science/weather/api/environment.py"
replace_once(
    env,
    "from science.media.rover_photos import (\n    search_rover_photos,\n)\n",
    "from science.media.rover_photos import (\n    search_rover_photos,\n)\n\nfrom science.mission.api import (\n    router as mission_router,\n)\n",
)
replace_once(
    env,
    "app.include_router(\n    terrain_router\n)\n",
    "app.include_router(\n    terrain_router\n)\n\napp.include_router(\n    mission_router\n)\n",
)

# ---------------------------------------------------------------------------
# 5. App.css: mission-control panel styles.
# ---------------------------------------------------------------------------
css_src = Path(__file__).resolve().parents[1] / "frontend/src/components/mission/mission-ops.css"
css = ROOT / "frontend/src/App.css"
existing_css = css.read_text(encoding="utf-8") if css.exists() else ""
mission_css = css_src.read_text(encoding="utf-8")
if ".mission-ops-panel" not in existing_css:
    css.write_text(existing_css.rstrip() + "\n\n" + mission_css, encoding="utf-8")

# ---------------------------------------------------------------------------
# 6. requirements: contour extraction dependency.
# ---------------------------------------------------------------------------
requirements = ROOT / "requirements.txt"
replace_once(requirements, "scipy\n", "scipy\nscikit-image\n")

# ---------------------------------------------------------------------------
# 7. tile_renderer: stronger contrast + robust fill masking.
# ---------------------------------------------------------------------------
tile = ROOT / "science/terrain/tile_renderer.py"
replace_once(
    tile,
    "MAX_ELEVATION_M = 21249.0\n\nLAT_LIMIT = 88.0\n",
    "MAX_ELEVATION_M = 21249.0\n\n# Display normalization is intentionally robust rather than tied to the\n# absolute global extremes. It keeps ordinary terrain readable while still\n# preserving the Mars elevation character.\nDISPLAY_MIN_ELEVATION_M = -6000.0\nDISPLAY_MAX_ELEVATION_M = 12000.0\n\nLAT_LIMIT = 88.0\n",
)
replace_once(
    tile,
    '            "rendering": "elevation tint + hillshade",\n',
    '            "rendering": "elevation tint + hillshade + transparent MOLA contours",\n            "display_normalization_m": [\n                DISPLAY_MIN_ELEVATION_M,\n                DISPLAY_MAX_ELEVATION_M,\n            ],\n',
)
replace_once(
    tile,
    "                block = self._tile_read(\n                    tile,\n                    latitudes[lat_indices],\n                    normalized_longitudes[lon_indices],\n                )\n\n                elevation[\n",
    "                block = self._tile_read(\n                    tile,\n                    latitudes[lat_indices],\n                    normalized_longitudes[lon_indices],\n                )\n\n                block = block.astype(np.float32, copy=False)\n                block[block < -30000.0] = np.nan\n\n                elevation[\n",
)
old_color = '''        normalized = (\n            elevation - MIN_ELEVATION_M\n        ) / (\n            MAX_ELEVATION_M - MIN_ELEVATION_M\n        )\n\n        normalized = np.clip(\n            normalized,\n            0.0,\n            1.0,\n        )\n\n        base = (\n            35.0\n            + normalized * 190.0\n        ).astype(np.float32)\n\n        # Keep the existing Mars color family, but modulate\n        # brightness with terrain illumination.\n        light = (\n            0.52\n            + 0.48 * hillshade\n        )\n'''
new_color = '''        safe_elevation = np.where(\n            valid,\n            elevation,\n            DISPLAY_MIN_ELEVATION_M,\n        )\n\n        normalized = (\n            safe_elevation - DISPLAY_MIN_ELEVATION_M\n        ) / (\n            DISPLAY_MAX_ELEVATION_M - DISPLAY_MIN_ELEVATION_M\n        )\n\n        normalized = np.clip(\n            normalized,\n            0.0,\n            1.0,\n        )\n\n        base = (\n            22.0\n            + normalized * 205.0\n        ).astype(np.float32)\n\n        # Preserve the existing warm Mars palette while allowing genuinely\n        # dark terrain shadows. Gamma keeps low-angle relief legible.\n        light = (\n            0.24\n            + 0.76 * np.power(\n                np.clip(hillshade, 0.0, 1.0),\n                1.35,\n            )\n        )\n'''
replace_once(tile, old_color, new_color)

print("ONE-SHOT PATCH APPLIED")
print("Next: install requirements, compile, start FastAPI, then inspect the contour endpoint.")
