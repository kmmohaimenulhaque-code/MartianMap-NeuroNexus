---
title: NeuroNexus project and Team NeuroNexus
evidence_class: PROJECT DOCS
as_of: 2026-10
sources: README.md; docs/architecture/mission-console-v2.md; https://www.spaceappschallenge.org/2026/find-a-team/neuronexus1/
---

## Team NeuroNexus and NASA Space Apps Challenge 2026
- NeuroNexus — "Interplanetary Survival Guide: Martian Map" — is Team NeuroNexus' project for the NASA International Space Apps Challenge 2026.
- Team page: https://www.spaceappschallenge.org/2026/find-a-team/neuronexus1/ (also reachable from ☰ Command Index → Meet the Team).
- Challenge: give the first astronauts on Mars the best map possible, with route and destination details, current conditions and the data needed for safe, scientifically meaningful decisions.
- NASA Space Apps 2026 space agency partners: GGPEN (Angola), CONAE (Argentina), BSA (Bahrain), AEB (Brazil), CSA (Canada), ESA (Europe), ISRO (India), ASI (Italy), JAXA (Japan), KASA (South Korea), NASRDA (Nigeria), AEP (Paraguay), ASES (Senegal), AEE (Spain), TUA (Turkey), MBRSC (United Arab Emirates) and UKSA (United Kingdom).

## What NeuroNexus does
- Synchronised 2D Mars map, USGS scientific map (SIM 3292 geology) and interactive 3D Mars (ArcGIS SceneView, Mars 2000 coordinates).
- 2,052 USGS/IAU named features are searchable, and any coordinate can be selected.
- Site context:
  - NASA MOLA terrain (elevation, slope, roughness, with AT SITE / MIN / MEAN / MAX over a selectable window);
  - historical NASA THEMIS thermal evidence;
  - the NASA Ames MY34 dust scenario (opacity chart over all 668 sols, dust-top height, global dust map, sol scrubber);
  - site science and habitability context;
  - rover imagery.
- Routes:
  - manual multi-waypoint routes;
  - the AI Route Designer (deterministic multi-objective candidates over MOLA terrain: EVA, terrain, science and operational objectives);
  - saved routes with along-track MIN / MEAN / MAX statistics, shown in 2D and 3D;
  - side-by-side comparison with best/worst marking and elevation profiles;
  - per-route and combined USGS snapshots;
  - JSON/CSV exports.
- Mission awareness: Crewed Mars console (mission profile, EVA, life support, resources), NASA/JPL near-Mars small-body close-approach tracking, and the NASA Mars reference feed.
- Mars Intelligence: a Gemini-powered assistant that answers from application tools, a curated Mars knowledge base and project documentation, with optional Google Search grounding. It never generates route geometry and never alters deterministic numbers.

## Data model and evidence classes
- OBSERVED: measured by an instrument (THEMIS brightness temperature, MOLA altimetry).
- MODELED: model output (Ames MGCM MY34 dust scenario).
- DERIVED: computed from observations (slope, roughness, walkability, along-track statistics).
- SIMULATED: synthetic or scenario values (parts of the crewed console).
- Nothing in NeuroNexus certifies a site or route as safe. Every metric is a planning aid with stated provenance.

## Data sources
- NASA MOLA MEGDR 128 pixels/degree (MGS-M-MOLA-5-MEGDR-L3-V1.0).
- NASA THEMIS IR-PBT (Mars Odyssey), historical brightness temperatures.
- NASA Ames Mars GCM V3.2 dust scenario MY34 (Montabone et al. 2015 climatology).
- USGS Gazetteer of Planetary Nomenclature (IAU), USGS SIM 3292 Geologic Map of Mars, and USGS/Esri Mars map services (Viking MDIM 2.1, MOLA hillshade).
- NASA/JPL SBDB close-approach API, NASA Image and Video Library, NASA Science Mars feed.
- Full citations: SOURCES_MLA.md.

## Architecture (summary)
- Backend: Python FastAPI (science/), started as `uvicorn science.weather.api.environment:app` on port 8002. Routers: /environment, /places, /terrain, /routes, /dust, /usgs, /orbital, /mars3d, /hazards, /mission, /ai.
- Frontend: React 19 + Vite (frontend/). The dev server proxies /api to the backend.
- AI: server-side only (GEMINI_API_KEY never reaches the browser). The provider is selectable through AI_PROVIDER, and tools register through the @tool decorator in science/ai/knowledge_tools.py.
- Deployment guide: DEPLOYMENT.md.

## Copyright
© 2026 Team NeuroNexus. Built for the NASA International Space Apps Challenge 2026. NASA does not endorse any non-U.S. Government entity and is not responsible for information contained on non-U.S. Government websites. Mars data courtesy of NASA, USGS and their partners.
