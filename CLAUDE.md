# CLAUDE.md

NeuroNexus · Martian Map: a Marswalk planning console for NASA Space Apps 2026. It turns NASA mission
data (MSL/RAD, MRO MCS / Ames MGCM dust, MOLA, HiRISE/CTX, THEMIS, USGS) into route decisions with
exposed uncertainty. The map is a decision instrument, not a visualization.

## Layout
- `frontend/`: React 19 + Vite, Leaflet (2D), ArcGIS Maps SDK 4.33 via AMD (ArcGIS layered map and 3D globe).
- `science/`: FastAPI backend. `science.serve:app` serves the API under `/api` plus `frontend/dist`.
- `tests/`: pytest suite. `frontend/src/__tests__/`: vitest. `frontend/e2e/devices.mjs`: Playwright device checks.
- `tools/`: demo-pack recorder, static Hugging Face deploy, backend runner.

## Commands
```bash
# backend + built console on :7860
cd frontend && npm run build && cd ..
python -m uvicorn science.serve:app --host 0.0.0.0 --port 7860

cd frontend && npm run lint && npm test && npm run build   # must be 0 errors
python -m pytest -q                                         # from repo root
node frontend/e2e/devices.mjs                               # needs the server on :7860 and Playwright (Chromium)
```

## Rules
- Never fabricate data or label anything "safe". Statuses are WITHIN PLANNING LIMITS / REVIEW REQUIRED /
  EXCEEDS PLANNING LIMIT; planning limits are not safety limits. Missing data shows "n/a" or UNAVAILABLE.
- Every value carries a source tag resolving to the ledger (`science/sources`); keep that true for new values.
- American spelling, no emoji, no em dashes in UI text.
- Never commit secrets, `.env`, rasters over 20 MB, caches or `build/`.
- Do not upload to Hugging Face or re-record the demo pack unless explicitly asked.

## UI conventions
- Font: Switzer everywhere (`--nn-font`). Scale: 12 px labels, 13 px body, 14 px key figures.
- One cyan: `#01FFFF` (`--nn-cyan`). Cyan text is regular weight (never bold). Labels are gray.
  Status colors keep their meaning: amber review, coral exceeds, green nominal.
- No wrapping of chrome (buttons, chips, titles, labels): overflow scrolls sideways. Prose may wrap.
- Popovers and menus render on `<body>` via `ui/FloatingCard.jsx` so panels never clip them.
- Layers are shared by the 2D, ArcGIS and 3D maps (`components/layers/layerStore.js`); a pick on any map
  syncs all maps.
- Layouts: cockpit at >= 768 px; phones < 768 px use the 2-row HUD (<= 88 px), dock and bottom sheets.
  Keep `e2e/devices.mjs` green on desktop, iPads, iPhone 393 and Android 360.
