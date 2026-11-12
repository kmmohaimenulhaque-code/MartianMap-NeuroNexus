## Team NeuroNexus - Interplanetary Survival Guide: Martian Map

NASA Space Apps Challenge 2026 · branch ```Master-Ai```

## 🎬 Demo Video

<div align="center">
  <a href="https://www.youtube.com/watch?v=0MLtYKHewcA" target="_blank">
    <img src="https://img.youtube.com/vi/0MLtYKHewcA/maxresdefault.jpg" alt="NeuroNexus: Interplanetary Survival Guide - Martian Map" width="100%" style="max-width: 900px; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);"/>
  </a>
  <br/>
  <p><strong>▶️ Click image to watch demo on YouTube</strong></p>
</div>

---

Setup first: SETUP_INSTRUCTIONS.md contains the complete installation, NASA data, Gemini API-key, backend/frontend startup, troubleshooting, and demo instructions.

Setup instructions:
https://github.com/kmmohaimenulhaque-code/martian-map/blob/Master-Ai/SETUP_INSTRUCTIONS.md

## OUR CHALLENGE:

NASA has explored Mars robotically for decades, studying its extreme environment, mapping its surface, and collecting many types of data.
Far from home, the first astronauts to set foot on Mars will want the best map possible, with information on the details of their routes and destinations, updates on current conditions, and the data necessary to make safe and scientifically meaningful decisions.

## Project Description 

NeuroNexus is an interactive planetary mission-planning and scientific intelligence system for Mars. It combines authoritative Mars datasets, deterministic terrain analysis, multi-objective route generation, and transparent AI interpretation to support mission planning and exploration decisions.

The goal is not to declare a universally "safe" place on Mars. NeuroNexus provides transparent evidence and derived planning aids so explorers can compare terrain, environment, science opportunities, and operational constraints before deciding on a route or site.

## What it does

* 2D Mars map + USGS scientific map: synchronized exploration views with 2,052 USGS/IAU named Martian features.
* Interactive 3D Mars: ArcGIS Maps SDK SceneView using Mars 2000 coordinates, public Mars terrain/imagery services, persistent annotations, USGS feature classes, geology, landing sites, rover locations, and terrain overlays.
* AI Route Designer: deterministic multi-objective route generation over bounded NASA MOLA terrain, with candidates for EVA, terrain, science, operational, distance, and terrain-risk objectives.
* Terrain intelligence: NASA MOLA elevation with derived slope, roughness, local relief, terrain burden, and a clearly labelled NeuroNexus walkability score.
* Environmental context: Mars weather/environment assessment, NASA Ames MY34 dust modelling, historical THEMIS thermal observations, and site-science provenance.
* Science + exploration context: ancient-habitability evidence, documented accessible-ice study regions, potential exploration zones, landing sites, rover traverses, and human-exploration context.
* Mission awareness: NASA/JPL near-Mars small-body close-approach tracking.
* USGS route snapshot + exports: route visualisation against USGS SIM 3292 geology plus JSON/CSV exports.
* Mars Intelligence: Google Gemini interprets structured NeuroNexus results and explains trade-offs; Gemini does not generate route geometry or alter deterministic numerical results.

## 🆕 NEW FEATURES — Mission Console v2

Everything in this section is **new** in the `feature/mission-console-v2` release. Screenshots were captured from the production build of the running application (`npm run build` + `vite preview` against the live API). Design record: [docs/architecture/mission-console-v2.md](docs/architecture/mission-console-v2.md) · Deployment: [DEPLOYMENT.md](DEPLOYMENT.md).

| # | New feature | One line |
|---|-------------|----------|
| 1 | [Dust scenario graphics](#1-new--dust-scenario-graphics-right-panel) | Opacity over all 668 sols, dust-top height, global dust map, sol scrubber |
| 2 | [Site morphology statistics](#2-new--site-morphology-min--mean--max) | Elevation, slope, roughness: AT SITE plus MIN / MEAN / MAX over a 2–20 km window |
| 3 | [☰ Mission Command Index](#3-new--mission-command-index-the--menu) | Every feature by category, searchable, keyboard-driven |
| 4 | [Team NeuroNexus credits + Meet the Team](#4-new--team-neuronexus-credits-and-meet-the-team) | Logo, copyright and a direct link to our Space Apps team page |
| 5 | [Mars Intelligence v2](#5-new--mars-intelligence-v2) | Answers about the mission, Mars, missions, history and the app, with cited sources |
| 6 | [Save AI routes by name](#6-new--save-ai-designed-routes-by-name) | Save any or all AI candidates; every saved route is reproducible |
| 7 | [Multi-route USGS snapshot](#7-new--multi-route-usgs-snapshot) | Every route selected for comparison drawn in one USGS SIM 3292 frame |
| 8 | [Route comparison workspace](#8-new--route-comparison-workspace) | Along-track MIN / MEAN / MAX, best/worst per row, profiles, per-route snapshots, **Verify** |
| 9 | [Route Projection on the 3D globe](#9-new--route-projection-on-the-3d-globe) | Tick saved routes and project them bold with names, camera reframes |

### 1. NEW · Dust scenario graphics (right panel)

![New: dust scenario panel with opacity over 668 sols, dust-top height, global dust map and sol scrubber](assets/screenshots/v2/01-dust-scenario.png)

The right-hand **Dust scenario** panel is now a full graphical view of the NASA Ames Mars GCM MY34 dust scenario, clearly labelled **MODELED**:

* **KPI strip:** opacity τ for the selected sol with its backend class (LOW / MODERATE / HIGH / VERY HIGH), dust-top height and areocentric season Ls.
* **Opacity chart:** τ at the selected site across all 668 sols, with threshold bands from the backend's own dust classes, MIN / MEAN / MAX and a pulsing marker on the current sol. Click the chart to jump to a sol.
* **Dust-top height** sparkline on the same axis.
* **Global dust map** for the current sol with a crosshair on the site. Click it to select any coordinate.
* **Sol scrubber** with previous / next / play. The console sol is now adjustable (it used to be fixed at sol 100) and drives the environment assessment.
* The screenshot shows sol 411, the site's modeled dust peak (the 2018 global storm).

### 2. NEW · Site morphology (MIN / MEAN / MAX)

![New: site morphology panel with at-site values and min, mean, max over a selectable window](assets/screenshots/v2/02-site-morphology.png)

Elevation, slope and roughness now show **AT SITE** (the local MOLA sample) separately from **MIN / MEAN / MAX** over a selectable **2 / 4 / 10 / 20 km** NASA MOLA window, with the valid-pixel count and slope p90 as the stated basis. Values above the route engine's own risk references are flagged amber (a planning aid, not a safety limit). Aspect is shown at the site only, because the mean of a circular quantity is not meaningful.

### 3. NEW · Mission Command Index (the ☰ menu)

![New: the Mission Command Index with every console feature grouped by category, search and keyboard shortcuts](assets/screenshots/v2/03-command-index.png)

The ☰ button now opens a categorised **Command Index** with **every feature in the console**: Site & Navigation, Route Planning, Saved Routes & Comparison, Analysis & Intelligence, Environment, Views, Mission Operations, Data & Export, Workspace, and System & Team.

* **Search** and keyboard control (`Ctrl/⌘ + K` anywhere, ↑ ↓ Enter, Esc) plus single-key shortcuts (R route mode, S save route, C compare, I intelligence, 3 globe…).
* Unavailable actions **say why** (for example "Needs at least 2 waypoints") instead of silently greying out.
* Field notes and the checklist moved into a tab of the same panel.

### 4. NEW · Team NeuroNexus credits and Meet the Team

![New: team tab with the Team NeuroNexus logo, Meet the Team link and copyright](assets/screenshots/v2/04-team-and-credits.png)

A **Team** tab in the Command Index (and **Meet the Team** in the Command Index list) opens our official Space Apps team page: https://www.spaceappschallenge.org/2026/find-a-team/neuronexus1/. The Team NeuroNexus logo appears in the top bar, the Command Index and the footer, with the copyright line and the NASA non-endorsement notice.

### 5. NEW · Mars Intelligence v2

![New: Mars Intelligence assistant welcome screen with grouped suggestions, web search toggle, export and clear](assets/screenshots/v2/05-mars-intelligence-welcome.png)

![New: Mars Intelligence answering a Mars-time, mission-history and how-to question with tool calls and cited sources](assets/screenshots/v2/06-mars-intelligence-answer.png)

The assistant answers three kinds of question, not only tool lookups:

* **This mission:** site, routes, terrain statistics, dust at any sol, thermal evidence, the crewed console.
* **Mars:** planetary science, every NASA and partner-agency mission, history, human exploration, ISRU, and exact Mars time (Ls, Mars Year, season) computed for any date.
* **This app and project:** how to use every feature, data sources, setup, deployment, the team.

How it works: 26 tools (8 new), a curated and cited knowledge base (185 sections: reference notes, project docs and the UI command catalogue), and an optional **WEB SEARCH** toggle for recent events. Each answer lists the **tools it called** and the **sources it cited**, with per-section evidence classes (NASA REFERENCE, PROJECT DOCS, COMPUTED…). History persists, answers can be copied and the conversation exported as Markdown. The screenshot shows one question that used three tools: a Mars-time calculation, the missions library (Opportunity and the 2018 storm) and the UI guide.

### 6. NEW · Save AI-designed routes by name

![New: AI Route Design with Save as route buttons and Save all candidates, six candidates saved as named routes](assets/screenshots/v2/07-ai-routes-saved-by-name.png)

Every AI Route Designer candidate now has **SAVE AS ROUTE** (you choose the name), and **SAVE ALL CANDIDATES** saves the whole set under a name prefix. **Every saved route is reproducible:** it stores its exact geometry plus the inputs that produced it. For AI routes that is the exact generation request, objective weights, candidate id and engine version. Saved routes are numbered with a stable colour and appear in 2D, 3D, the comparison workspace, exports and the AI assistant.

### 7. NEW · Multi-route USGS snapshot

![New: one USGS SIM 3292 snapshot showing four routes selected for comparison in their own colours](assets/screenshots/v2/08-multi-route-usgs-snapshot.png)

Select two or more routes for comparison and **USGS SNAPSHOT** draws **all of them in a single USGS SIM 3292 frame** over MOLA hillshade, each in its own colour with start and end markers, plus the geologic units each route crosses. With one route selected it behaves as before.

### 8. NEW · Route comparison workspace

![New: comparison workspace with four routes on the map](assets/screenshots/v2/09-route-comparison.png)

![New: comparison table with along-track min, mean, max elevation, slope and roughness and best/worst marked, plus elevation profiles](assets/screenshots/v2/10-comparison-table-and-profile.png)

![New: per-route USGS snapshots with statistics, units crossed and a Reproduced verification result](assets/screenshots/v2/11-snapshots-and-verify-reproducible.png)

* **Along-track statistics:** every saved route is evaluated along its whole path (not only at the waypoints) over NASA MOLA, giving **MIN / MEAN / MAX** elevation, slope and roughness plus gain/loss, slope p90, terrain risk proxy, EVA time and data support.
* **Best and worst** are marked per row by the metric's stated direction (★ best, ▾ worst). Elevation rows are informational.
* **Overlaid elevation profiles** of all compared routes, up to four at a time.
* **Per-route USGS snapshot** with the units crossed, and a **COMBINED SNAPSHOT** frame. CSV and JSON export.
* **RENAME** and **VERIFY** on every card: AI routes replay the stored request and compare geometry vertex by vertex; manual routes re-run the deterministic evaluation. The result reads REPRODUCED, DIFFERS or ERROR.

### 9. NEW · Route Projection on the 3D globe

![New: Route Projection on the 3D globe, three saved routes projected bold with name labels](assets/screenshots/v2/12-route-projection-3d.png)

The 3D toolbar has a new **◎ ROUTE PROJECTION** button. Turn it on, **tick saved routes**, and each ticked route is projected bold above the terrain with its name and start/end markers; unticked routes fade. The camera reframes to show every ticked route whenever the selection changes (PROJECT ALL, CLEAR and REFRAME buttons are in the panel). The 3D **⌁ ROUTES** panel also gives per-route show/hide, fly-to, compare, USGS and rename.

### Also new

* Deployment guide ([DEPLOYMENT.md](DEPLOYMENT.md)) with local, Docker Compose and split-hosting options.
* Test suites for the new engines (dust, terrain statistics, along-track statistics, snapshots, Mars time, knowledge base, route reproducibility) and for the command registry.
* Fixes: the NASA briefing endpoint no longer fails on repeated requests, and first-time USGS snapshots place routes at the right scale.

## Screenshots : the mission console in action

The screenshots below show the Master-Ai interface, including Gale site context, historical thermal evidence, route comparison, and the interactive 3D workspace. Displayed values belong to the captured application state used in this project.

### Site selection and synchronized maps

![NeuroNexus mission console showing Gale site details, the coloured 2D Mars map, the synchronized USGS scientific map, and the 3D Mars view](assets/screenshots/mission-console.png)

The main console brings USGS/IAU site identity and coordinates, applicable rover imagery, NASA Ames dust-model context, and NASA MOLA terrain metrics alongside the 2D, USGS geology, and 3D views.

### Historical THEMIS thermal evidence

![Gale thermal panel showing nearest historical brightness temperature, minimum, maximum, mean, sample counts, search radius, observation years, and seasonal coverage](assets/screenshots/historical-thermal-context.png)

The THEMIS panel keeps the nearest historical brightness temperature separate from the minimum, maximum, and mean shown directly beneath it in Kelvin and Celsius. Historical sample counts, the 50 km search radius, observation years, and seasonal coverage are available beside the thermal series.

### AI Route Designer : deterministic candidates

![AI Route Designer showing start and destination coordinates, mission-objective weights, EVA settings, and multiple terrain-aware route candidates](assets/screenshots/ai-route-design.png)

The route-design workspace lets users set start and destination coordinates, adjust mission-objective weights, and configure EVA pace and ascent allowance. Candidate cards compare distance, estimated travel time, terrain burden, roughness, and route suitability.

### Saved-route comparison

![Saved Marswalk routes plotted together with comparison cards for distance, waypoints, slope, roughness, MOLA coverage, and elevation range](assets/screenshots/route-comparison.png)

Colour-coded saved routes remain visible together while comparison cards show distance, waypoint counts, slope, roughness, MOLA coverage, elevation range, and review notes.

### Mars Intelligence : tool-grounded interpretation

![Mars Intelligence assistant discussing saved-route trade-offs while explicitly marking unavailable deterministic metrics and distinguishing project data from AI interpretation](assets/screenshots/mars-intelligence.png)

Mars Intelligence uses structured mission context and application tools to explain evidence and route trade-offs. This captured response lists saved routes but marks their quantitative comparison as unavailable when the deterministic metric is not present.

### Interactive 3D layers

![Interactive 3D Mars globe with terrain, imagery, colourised MOLA elevation, USGS named features, rover markers, and layer controls](assets/screenshots/mars-3d-layers.png)

The 3D layer panel groups terrain, imagery, colourised elevation, USGS/IAU named features, geology, and landing-site overlays. Observed and derived labels distinguish source data from NeuroNexus computed values.

### Map legend and rover context

![3D Mars legend identifying named-feature colours, USGS geology and landing-site symbols, and Curiosity and Perseverance traverse layers](assets/screenshots/mars-3d-legend.png)

The legend explains named-feature colours, geologic symbols, landing sites, and rover-traverse layers. It keeps the map symbology and provenance labels visible beside the interactive scene.

### Potential exploration zones

![Potential exploration-zone panel and 3D markers for documented study regions including Arcadia Planitia and Utopia Planitia](assets/screenshots/potential-exploration-zones.png)

The exploration-zone view connects derived candidate areas to documented study-region context and terrain summaries, with controls to fly to a region. These zones are NeuroNexus planning aids—no single zone is declared "safe" or habitable.

### Field notes and mission checklist

![Field Notes and Checklist workspace with a mission-objective text area, tickable mission actions, local-save information, and JSON, CSV, and print or PDF export controls](assets/screenshots/field-notes-checklist.png)

The mission workspace keeps field notes and tickable checklist actions alongside the planning workflow. It supports local-save persistence and export to JSON, CSV, and printable or PDF formats.

## Scientific data and external sources

# NASA

* NASA Planetary Data System (PDS): primary archival source framework.
* Mars Global Surveyor / MOLA: MEGDR 128 pixels/degree global topography and 512 pixels/degree polar topography for elevation and terrain analysis.
* Mars Odyssey / THEMIS: historical visible and thermal observations, including IR predicted brightness-temperature context.
* NASA Ames Research Center Mars Global Climate Model: MY34 dust scenario used for modelled dust context.
* Mars Science Laboratory / Curiosity: rover science context and historical RAD surface-radiation reference.
* Mars 2020 / Perseverance: mission science context and rover traversal data.
* NASA MMGIS: real Curiosity and Perseverance traverse layers used by the 3D rover-path visualisation.
* NASA Image and Video Library: mission and rover imagery metadata.
* NASA human-exploration references: EVA, Mars mission, radiation, Martian dust, life-support and mobility context.
* NASA SWIM / NASA Mars Water Maps: accessible-ice exploration context. The full SWIM ice-consensus raster is explicitly marked UNAVAILABLE in NeuroNexus; documented study regions are not presented as a substitute.

# USGS / IAU

* USGS Gazetteer of Planetary Nomenclature / IAU: 2,052 named Martian features, coordinates, feature types, and identity.
* USGS SIM 3292 — Geologic Map of Mars (Tanaka et al., 2014): geologic units, contacts, structures, landing-site layer, and scientific route snapshots.

# NASA/JPL

* NASA/JPL Solar System Dynamics Close-Approach Data API: near-Mars small-body close-approach awareness, distance and uncertainty information.

# Other external services and partners

* Esri / ArcGIS Mars services: public Mars terrain/elevation services, Viking MDIM imagery, colourised elevation, and ArcGIS delivery of USGS geology used by the 3D experience.
* ESA: Mars Express and ExoMars public feeds used by the Mars briefing subsystem.
* The Planetary Society: public Mars article feed used by the Mars briefing subsystem.
* Google Gemini API: AI interpretation of structured NeuroNexus results; the API key remains server-side and Gemini output is never treated as a NASA observation.

The machine-readable provenance ledger is available at data/manifests/source_ledger.json.

# Evidence and provenance

NeuroNexus distinguishes:

* OBSERVED / NASA OBSERVED - measurements or archived observations from a named source.
* NASA REFERENCE - published NASA/USGS reference information or catalogue data.
* MODELED - output of a physical model such as the NASA Ames Mars GCM.
* DERIVED / COMPUTED - values calculated by NeuroNexus from source data.
* SIMULATED - configurable project simulation values.
* UNAVAILABLE - no ingested evidence; NeuroNexus does not invent a substitute.

Examples of NeuroNexus-derived outputs include the multi-objective route engine, route metrics, walkability score, terrain-risk proxy, EVA-time estimate, and potential exploration-zone scoring.

NeuroNexus does not label any route or location as NASA-certified safe, universally best, habitable, or resource-confirmed.

# Architecture
```
Authoritative Mars data
        ↓
Ingestion + validation
        ↓
Scientific indexes / bounded terrain windows
        ↓
Deterministic terrain + route analysis
        ↓
FastAPI mission services
        ↓
React/Vite mission console
        ↙       ↓        ↘
     2D map   3D Mars   USGS map
        ↘       ↓        ↙
          shared mission state
                ↓
          Google Gemini
                ↓
AI interpretation of structured results
```
# Architecture (Mermaid Diagram)
# Architecture

```mermaid
flowchart TB
    USER["Mission operator"] --> APP

    subgraph FRONTEND["PRESENTATION LAYER · React 19 + Vite"]
        APP["App.jsx<br/>Shared mission state and UI orchestration"]

        MAP2D["2D Mars Explorer<br/>Leaflet · site search · map selection"]
        TOPO["MOLA Topographic Explorer<br/>Elevation tiles · contours · local terrain"]
        MAP3D["Interactive 3D Mars<br/>ArcGIS SceneView · loaded on demand"]
        ROUTEUI["Route Design & Comparison<br/>Waypoints · objective weights · EVA settings"]
        OPSUI["Science & Mission Panels<br/>Environment · hazards · thermal · rover photos<br/>Briefings · orbital tracking · mission operations"]
        INTELUI["Mars Intelligence<br/>Grounded Q&A · route trade-off explanations"]
        NOTES["Field Notes & Checklist<br/>Custom places · Safe Havens · exports"]

        CLIENT["marsEnvironmentApi.js<br/>REST / JSON client"]
        STORAGE[("Browser localStorage<br/>Saved routes · profile · places · notes<br/>Checklist · Safe Havens · objectives")]

        APP <--> MAP2D
        APP <--> TOPO
        APP <--> MAP3D
        APP <--> ROUTEUI
        APP <--> OPSUI
        APP <--> INTELUI
        APP <--> NOTES
        APP <--> STORAGE

        APP --> CLIENT
        MAP3D --> CLIENT
    end

    subgraph TRANSPORT["LOCAL API TRANSPORT"]
        PROXY["Vite proxy<br/>/api/* and /terrain/*"]
        API["FastAPI application · port 8002<br/>science/weather/api/environment.py"]
        PROXY <--> API
    end

    CLIENT <-->|"REST requests and JSON responses"| PROXY

    subgraph ROUTERS["FASTAPI DOMAIN ROUTERS"]
        SITEAPI["Environment & Place Catalogue<br/>Site context · USGS/IAU search"]
        TERRAINAPI["Terrain API<br/>Tiles · contours · windows · route geometry"]
        ROUTEAPI["Routing API<br/>Candidates · evaluation · methodology"]
        USGSAPI["USGS API<br/>Map synchronisation · route snapshots"]
        MARS3DAPI["Mars3D API<br/>Terrain grids · traverses · exploration zones"]
        HAZARDAPI["Hazards API<br/>Hazard overview · AI context"]
        MISSIONAPI["Mission API<br/>Explicitly simulated mission state"]
        ORBITAPI["Orbital API<br/>Near-Mars close approaches"]
        AIAPI["AI API<br/>Chat · route analysis · provenance"]
        MEDIAAPI["Briefing & Rover Media<br/>NASA and partner feeds · rover imagery"]
    end

    API --> SITEAPI
    API --> TERRAINAPI
    API --> ROUTEAPI
    API --> USGSAPI
    API --> MARS3DAPI
    API --> HAZARDAPI
    API --> MISSIONAPI
    API --> ORBITAPI
    API --> AIAPI
    API --> MEDIAAPI

    subgraph ENGINES["SCIENTIFIC & COMPUTATIONAL CORE"]
        ENV["MarsEnvironmentEngine<br/>Unified site context"]
        THERMAL["THEMIS Thermal Engine<br/>Historical brightness temperatures · coverage"]
        WEATHER["Mars Weather Model<br/>NASA Ames MY34 dust context"]
        TERRAIN["MOLA Terrain Processing<br/>Slope · roughness · relief · raster rendering"]
        ROUTING["Deterministic Multi-objective Route Engine<br/>Candidate generation · metrics · EVA estimates"]
        MAP3DENGINE["Mars 3D Context Builder<br/>Local terrain · rover traverses · study regions"]
        HAZARD["Hazard & Site Science Logic"]
        SIM["Mission Simulation Model<br/>Crew · vehicles · EVA · life support"]
        ORBITAL["Orbital Data Adapter"]
        MEDIA["Briefing & Imagery Adapters"]
        TOOLS["Server-side AI Tool Registry<br/>Reads structured site, terrain, route,<br/>thermal, hazard and orbital context"]
        PROVENANCE["Source Ledger & Evidence Classification<br/>Observed · Reference · Modelled · Derived<br/>Simulated · Unavailable"]
    end

    SITEAPI --> ENV
    SITEAPI --> PROVENANCE
    TERRAINAPI --> TERRAIN
    ROUTEAPI --> ROUTING
    USGSAPI --> PROVENANCE
    MARS3DAPI --> MAP3DENGINE
    HAZARDAPI --> HAZARD
    MISSIONAPI --> SIM
    ORBITAPI --> ORBITAL
    MEDIAAPI --> MEDIA
    AIAPI --> TOOLS
    AIAPI --> PROVENANCE

    subgraph LOCALDATA["LOCAL SCIENTIFIC DATA"]
        MOLA["NASA MOLA MEGDR<br/>Terrain tiles · Git LFS"]
        THEMIS["NASA THEMIS IR-PBT<br/>Indexed historical observations · Parquet"]
        DUST["NASA Ames Mars GCM · MY34<br/>NetCDF · external/mars-gcm submodule"]
        GAZETTEER["USGS / IAU Gazetteer<br/>Processed feature catalogue · Parquet"]
        MANIFEST["data/manifests<br/>Source ledger · checksums · dataset metadata"]
    end

    MOLA --> TERRAIN
    MOLA --> ROUTING
    MOLA --> MAP3DENGINE
    MOLA --> ENV

    THEMIS --> THERMAL
    THERMAL --> ENV

    DUST --> WEATHER
    WEATHER --> ENV

    GAZETTEER --> ENV
    MANIFEST --> PROVENANCE

    TOOLS --> ENV
    TOOLS --> THERMAL
    TOOLS --> TERRAIN
    TOOLS --> ROUTING
    TOOLS --> ORBITAL
    TOOLS --> PROVENANCE

    subgraph EXTERNAL["EXTERNAL DATA & SERVICES"]
        ARCGIS["Esri ArcGIS Mars Services<br/>Imagery · elevation · geology"]
        MMGIS["NASA MMGIS<br/>Rover traverse context"]
        JPL["NASA/JPL Close-Approach API"]
        FEEDS["NASA · ESA · Planetary Society<br/>Briefing feeds and mission context"]
        IMAGES["NASA Image and Video Library"]
        GEMINI["Google Gemini API<br/>Optional · server-side only"]
    end

    MAP3D <--> ARCGIS
    USGSAPI <--> ARCGIS
    MAP3DENGINE <--> MMGIS
    ORBITAL <--> JPL
    MEDIA <--> FEEDS
    MEDIA <--> IMAGES

    AIAPI <--> GEMINI
    GEMINI -. "Function-call requests" .-> TOOLS
    TOOLS -. "Structured tool results" .-> GEMINI

    ROUTING -. "Deterministic route metrics remain authoritative" .-> INTELUI
    ENV -. "Scientific context and evidence status" .-> OPSUI
```
# Simplified Architecture Mermaid Diagram 

```mermaid
flowchart TB
    USER["Mission Operator"] --> APP

    subgraph FRONTEND["PRESENTATION LAYER · React 19 + Vite"]
        APP["App.jsx<br/>Shared Mission State"]
        MAPS["2D + Topo + 3D Maps"]
        ROUTE["Route Design & Comparison"]
        OPS["Science & Mission Panels"]
        INTEL["Mars Intelligence"]
        NOTES["Field Notes & Exports"]
        APP --> MAPS & ROUTE & OPS & INTEL & NOTES
    end

    subgraph BACKEND["FASTAPI BACKEND · Port 8002"]
        API["Domain Routers"]
        ENGINES["Scientific Engines<br/>Terrain · Routing · Thermal · Hazards<br/>Environment · Simulation"]
        PROV["Provenance & Evidence Classification"]
        API --> ENGINES
        API --> PROV
    end

    subgraph DATA["DATA LAYER"]
        LOCAL["Local Scientific Data<br/>MOLA · THEMIS · GCM · Gazetteer"]
        EXT["External Services<br/>ArcGIS · MMGIS · JPL · NASA Feeds · Gemini"]
    end

    APP <-->|"REST / JSON"| API
    ENGINES --> LOCAL
    ENGINES --> EXT
    INTEL -.->|"Grounded interpretation only"| ENGINES
```

# Stack

# Frontend

* React 19
* Vite
* Leaflet / React-Leaflet
* ArcGIS Maps SDK for JavaScript, loaded on demand for 3D

# Backend

* Python
* FastAPI + Uvicorn
* NumPy / SciPy / Pandas / Polars / PyArrow
* Rasterio / GeoPandas / Shapely / PyProj
* PDS4 Tools
* VTK / PyVista / Trimesh
* Google GenAI SDK

# Acceleration / development

* AMD Instinct MI300X + ROCm for terrain and engineering acceleration work
* Large/generated datasets and assets are handled through manifests, Git LFS, submodules, or external services where appropriate.

# Gemini AI setup

AI is optional for the rest of NeuroNexus.

Create .env in the repository root:

GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.6-flash

A safe template is provided as .env.example.

Never commit a real Gemini API key. The backend reads GEMINI_API_KEY; it is never sent to the browser.

For the complete setup and model troubleshooting flow, see SETUP_INSTRUCTIONS.md.

# Quick start

Use the full SETUP_INSTRUCTIONS.md for installation, data acquisition, Gemini configuration and startup.

The intended branch is:

Master-Ai

Backend:
```
python -m uvicorn science.weather.api.environment:app --host 127.0.0.1 --port 8002
```
Frontend:
```
cd frontend
npm install
npm run dev
```

# Validation

The repository contains tests covering AI behaviour, routing, USGS integration, orbital tracking, Mars 3D services, exports, and other mission subsystems.

Run:
```
python -m pytest tests -q
cd frontend && node --test "tests/*.test.js"
npm run build
```

Runtime notes

* The ArcGIS 3D experience loads only when opened and requires internet access to Esri's public services.
* The NASA MOLA raw terrain dataset is large; follow the Git LFS/PDS instructions in SETUP_INSTRUCTIONS.md.
* The SWIM water-ice consensus raster is currently UNAVAILABLE in the application; related regions are presented only as documented exploration-study context.
* Some high-resolution orbital datasets listed in the scientific catalogue remain explicitly not-ingested rather than being fabricated.
* The 3D terrain service and local MOLA measurements may differ because they come from different terrain products/resolutions; NeuroNexus keeps that distinction explicit.

# Repository

NASA Space Apps 2026 submission branch:
https://github.com/kmmohaimenulhaque-code/martian-map/tree/Master-Ai

# Source ledger:
https://github.com/kmmohaimenulhaque-code/martian-map/blob/Master-Ai/data/manifests/updated_source_ledger.json

# Team

**Team NeuroNexus** · NASA International Space Apps Challenge 2026 · [Meet the Team](https://www.spaceappschallenge.org/2026/find-a-team/neuronexus1/)

© 2026 Team NeuroNexus. All rights reserved. Mars data courtesy of NASA, USGS and their partners. NASA does not endorse any non-U.S. Government entity and is not responsible for information contained on non-U.S. Government websites.
