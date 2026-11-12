# Session summary: mission console v2 (branch `feature/mission-console-v2`)

Written 2026-10-22 so work can resume after a session reset. Everything listed under "Done" is committed
and pushed; Render auto-deploys the branch.

## Live deployments (Render, workspace "My Workspace")
| Service | URL | Notes |
|---|---|---|
| `martian-map-console` (web, one URL) | https://martian-map-console.onrender.com | API + built console from one server |
| `martian-map-api` (web, API) | https://martian-map-api.onrender.com | `science.serve:app` |
| `martian-map-console-ui` (static) | https://martian-map-console-ui.onrender.com | built with `VITE_API_ORIGIN=https://martian-map-api.onrender.com` |

All three are on the free plan (cold start about a minute) and auto-deploy on push to this branch.
Older services (`martian-map-backend`, `martian-map-ui`, `martian-map`) were not touched.

## Done (latest commits first)
- `78c5d21` Landing-site manifest/API tests (11 sites, exclusions, sources).
- `15b7fb5` Agent work, integrated and verified (lint 0 errors, 90 unit tests, 206 backend tests, build, device e2e):
  - Loading pop-up (`frontend/src/state/fetchTracker.js`, `frontend/src/ui/LoadingOverlay.jsx`, `loadingOverlay.css`):
    glass-blur, search-bar style card listing in-flight `/api` requests with progress; shows after 700 ms;
    CLOSE / Esc dismisses (requests keep running); ignores health, AI status, briefing and sol-playback frames;
    14 px Switzer cyan.
  - 2D map (`components/mars/MarsMap.jsx`, `mapMarkers.css`): visible cyan selection ring; gentler wheel zoom
    (zoomSnap 0.25, zoomDelta 0.5, 120 px per level) also on the MARSWALK map (`marswalk/SiteMap.jsx`);
    every fly/fit/pan guarded against hidden zero-size maps.
  - Rovers (`useContextLayerData.js`, `ContextLayers.jsx`, `ArcgisLayeredMap.jsx`, `Mars3DView.jsx`):
    "PERSEVERANCE @ SOL <latest mission sol>" beside "CURIOSITY @ SOL <n>" on the 2D, ArcGIS and 3D maps.
    Perseverance landed in MY36, after the MY34 scenario year, so it shows its latest NASA MMGIS localization.
  - Landing sites (`data/manifests/mars_landing_sites.json`, `science/landing_sites/api.py`): 11 sites; added
    Beagle 2 (Royal Society Open Science 2017) and the Schiaparelli crash site (HiRISE ESP_062731_1780);
    Chinese and Russian/Soviet landers excluded; labels on all three maps.
  - `science/hires/palette.py`: HiRISE swatch token follows the single cyan.
- `cdb0bef` Phone crash fix: tapping the ArcGIS LAYERED map on a phone ran a Leaflet fly-to on the hidden
  (0x0) 2D map, throwing "Invalid LatLng (NaN, NaN)" and stopping the console. Hidden maps now jump without animation.
- `2b8f11b` `VITE_API_ORIGIN` (`frontend/src/apiOrigin.js`): lets the console run as a static site against a separate API.
- `d1e0f43` `CLAUDE.md` with layout, commands and conventions.
- Earlier this session: radial wheel labels fit their slices (grain kept, no box), single cyan `#01FFFF`,
  regular-weight cyan text, Switzer everywhere, 12/13/14 px type scale, two-column Selected site with
  thermal summary, desktop panel shadows, removal of the guided tour and Install as app, honest Browser
  Optimization readouts, map sync across 2D / ArcGIS / USGS app / 3D, popovers and menus on `<body>`.

## Not finished when the session reset
- Cross-device bug hunt + fix (workflow `wf_51b81d02-315`, stages Hunt and Fix). The hunters (desktop,
  phone, tablet, MARSWALK lenses) were running; no results were recorded yet and no fixes were made after
  `78c5d21`. To redo it: start the server, then for each lens reproduce bugs twice with Playwright and fix
  root causes (see "How to verify").
- Live MARSWALK route on Render not yet exercised (the build pulls Git LFS terrain but does not fail if the
  pull fails, so missing terrain would only show there).

## How to verify
```bash
cd frontend && npm run build && cd ..
python -m uvicorn science.serve:app --host 0.0.0.0 --port 7860   # background
cd frontend && npm run lint && npm test          # 0 errors, 90 tests
cd .. && python -m pytest -q                      # 206+ tests
cd frontend && node e2e/devices.mjs               # Playwright, Chromium; desktop, iPads, iPhone 393, Android 360
```
Playwright: `ln -sfn $(npm root -g)/playwright frontend/node_modules/playwright` if the import fails.

## Standing user preferences
- Commit and push only to `feature/mission-console-v2`; no PRs unless asked; no Hugging Face upload or
  demo re-record unless asked.
- UI: one cyan `#01FFFF`, cyan text never bold, labels gray, Switzer only, no wrapping of chrome
  (scroll sideways instead), no emoji, never "safe", no fabricated data.
- After each round, the user wants screenshots of the whole console and a short list of check questions.
