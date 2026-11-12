# HANDOFF — NeuroNexus Mission Console v2 + Marswalk meter-scale work

Team NeuroNexus · NASA Space Apps Challenge 2026 · Branch `feature/mission-console-v2`

## Current session (2026-10-20): Marswalk work in progress

Following `docs/prompts/NEURONEXUS_MARSWALK_ONE_SHOT_PROMPT.txt`. Live phase status, verified facts and next
steps: **`docs/REPORT_marswalk_hires.md`**. To resume in a new session: read that file and `git log`, run
`python tools/fetch_mola.py --sites gale jezero` (MOLA now comes from PDS, not Git LFS), then continue from the
first phase whose gate is not met.

Quick checks: `python -m pytest -q` (network tests skipped), `python tools/build_ledger.py --check`,
`cd frontend && npm run lint && npm test && npm run build`.

---

## Status

All requested features are implemented and pushed. Latest commit: `726c8d8` (README project tour, extended architecture diagrams).

| Area | State |
| --- | --- |
| Dust scenario graphs (MY34, 668 sols) | Done. Sol is adjustable, `DustScenario_MY34.nc` kept. |
| Site morphology (AT SITE + MIN/MEAN/MAX) | Done. Elevation, slope, roughness over 2/4/10/20 km windows. |
| Command Index (☰, Ctrl/⌘+K) | Done. Categorised from `frontend/src/features/commands.json`, every entry has a handler. |
| Meet the Team | Done. Links to the Space Apps 2026 NeuroNexus page. Copyright and credits in footer. |
| Saved routes in 3D + comparison | Done. ROUTES panel, show/hide, fly-to, multi-route compare. |
| Route Projection (3D) | Done. Projects selected routes on the globe, reframes camera. |
| Saved routes: MIN/MEAN/MAX + USGS snapshots | Done. Schema v3 with along-track evaluation and profile. |
| AI Route Designer: named, reproducible saves | Done. `SAVE AS ROUTE` / `SAVE ALL`, `VERIFY` replays the request. |
| Multi-route USGS snapshot | Done. Selected routes drawn in one frame. |
| Mars Intelligence v2 | Done. 26 tools, BM25 knowledge base, provider switch, optional web search. Tool usage still shown. |
| Scope rule | Only NASA, Space Apps 2026 partner agencies and SpaceX. No Soviet/Chinese references. Enforced by a test. |
| README | "NEW FEATURES" section (12 screenshots) and "Project tour" section (17 screenshots) beneath the source ledger. |

## How to run

No Docker, no nginx.

```bash
# Backend (FastAPI, port 8002)
python3 -m uvicorn science.weather.api.environment:app --host 127.0.0.1 --port 8002 --workers 2

# Frontend production preview (port 4173)
cd frontend && npm run build && npx vite preview --host 0.0.0.0 --port 4173

# Frontend dev (port 5173)
cd frontend && npm run dev
```

If port 8002 is "address already in use", a leftover uvicorn worker is holding it. Kill it, then restart.

## Tests

- Backend: `pytest` (99 passing, including `tests/test_mission_console_v2.py`).
- Frontend: `npm test` runs vitest (`src/`) and node:test (`tests/*.test.js`). 10 vitest and 45 node:test pass.
- Verified in the real app: 6 AI candidates generated, saved by name, 4-route USGS snapshot drawn, VERIFY returned REPRODUCED, Route Projection shown on the globe.

## Known issues

1. **MOLA terrain (fixed 2026-10-20).** The LFS pointer stubs are no longer needed: `python tools/fetch_mola.py --all` downloads the 16 MEG128 tiles from PDS into `data/cache/mola/meg128/` (gitignored); the loaders use them automatically.
2. **Docker and compose files are untested.** `docker-compose.yml`, `deploy/*` and `DEPLOYMENT.md` exist but were never run. The user banned Docker for this session.
3. **Pre-existing lint warnings** remain in `comparisonRoutes`, `handleMapLocationSelect`, a setState-in-effect in `App.jsx`, `MarsBriefingPanel`, `MarsMap`, `RoverPhotosPanel`, and some `Mars3DView` hook dependencies. None were introduced by v2 work.

## Decisions and gotchas

- **Briefing 500 (`KeyError: 'published_ts'`).** Cause: a shared cache entry was mutated. Fix: copy `chosen` before changing it.
- **Snapshot scale.** `scale` must be read after tile stitching, not before. Otherwise routes render at the wrong scale on the first build.
- **Saved-route layers.** Layers must be listed in the `layers: [...]` array in `Mars3DView.jsx`. `L.savedRoutes` and `L.projection` were missing at first.
- **Deterministic candidates.** AI candidate ids (`cand-<objective>`) come from the same inputs every time. That is what makes replay verification possible. Do not add randomness to candidate generation.
- **Saved-route schema v3.** Includes a stable colour, a `geometryHash` (FNV-1a), an `evaluation` block (profile capped at 256 rows) and a `generation` record. Migrates from v2 in localStorage.
- **Evidence classes.** OBSERVED, MODELED, DERIVED, SIMULATED, UNAVAILABLE for data. The AI also uses NASA REFERENCE, PROJECT DOCS, COMPUTED, GENERAL KNOWLEDGE and WEB.
- **Gemini key.** Server-side only, through `google-genai`. Never expose it to the browser.

## Key files

- Architecture: `docs/architecture/mission-console-v2.md` (§11 implementation record, follow-up on reproducible routes)
- Backend: `science/weather/api/dust.py`, `science/weather/config.py` (`dust_file()`), `science/terrain/api.py`, `science/routing/{metrics,engine,api}.py`, `science/usgs/{api,arcgis}.py`, `science/ai/{knowledge_base,knowledge_tools,provider,tools,gemini,api}.py`, `science/ai/knowledge/*.md`
- Frontend: `frontend/src/App.jsx`, `frontend/src/components/mars3d/Mars3DView.jsx`, `frontend/src/components/route/AiRouteDesigner.jsx`, `frontend/src/route/RouteComparisonWorkspace.jsx`, `frontend/src/command/CommandIndex.jsx`, `frontend/src/features/{commands.json,registry.js}`, `frontend/src/utils/savedRoutes.js`, `frontend/src/panels/{DustScenarioPanel,SiteMorphologyPanel}.jsx`
- Docs: `README.md`, screenshots in `assets/screenshots/v2/` and `assets/screenshots/tour/`

## Next steps (if asked)

- Run `git lfs pull` to restore full MOLA coverage, then re-check high-latitude exploration zones.
- Decide whether to delete or test the Docker files.
- Clean up the pre-existing lint warnings listed above.
