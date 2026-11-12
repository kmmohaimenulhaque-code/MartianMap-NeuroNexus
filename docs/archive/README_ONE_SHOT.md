# NeuroNexus one-shot mission + topo upgrade Personal checklist

This bundle is designed for the current `harvesine-topo` architecture. It adds two things without replacing the existing global map, USGS search, THEMIS, Ames GCM, rover imagery, site science, or Haversine route geometry.

## Added in this bundle

### Mission / operations console
A tabbed simulation panel for:
- mission definition and timeline
- synthetic crew manifest (IDs only; no real people)
- spacecraft and surface assets
- EVA / suit / PLSS state
- radiation monitoring state
- ECLSS / life support state
- atmosphere, regolith, minerals, water, bioavailability, vegetation

All crew/vehicle/readiness numbers are explicitly simulated. The radiation reference is historical Curiosity RAD context, not live telemetry or a crew dose forecast.

### Real MOLA contour map
- transparent SVG contour tiles over the existing real MOLA PNG tiles
- marching-squares contours from the same MOLA elevation source
- zoom-adaptive contour intervals
- thicker index contours
- elevation labels on selected index contours
- improved terrain contrast in the underlying MOLA tint/hillshade
- MOLA fill values below -30000 m are masked
- no route-wide raster search, no A*, no corridor sampling

## Apply

Run from the repository root:

```bash
cd /workspaces/martian-map
python /path/to/apply_one_shot.py
```

The script expects these files to be adjacent to it inside the bundle:

```text
frontend/src/components/mission/MissionOpsPanel.jsx
frontend/src/components/mission/mission-ops.css
science/mission/__init__.py
science/mission/state.py
science/mission/api.py
science/terrain/contour_renderer.py
tools/apply_one_shot.py
```

## Install / validate

```bash
cd /workspaces/martian-map
python -m pip install -r requirements.txt
python -m compileall science
python -c "from science.weather.api.environment import app; print('FASTAPI IMPORT: GREEN')"
```

Start the backend from the repository root:

```bash
python -m uvicorn science.weather.api.environment:app --reload --port 8002
```

Then test a real contour tile:

```bash
curl -i "http://localhost:8002/api/terrain/contours/3/4/4.svg"
```

You want `200 OK` and `content-type: image/svg+xml`.

Also test an existing terrain tile:

```bash
curl -i "http://localhost:8002/api/terrain/tile/3/4/4.png"
```

## Frontend

From `frontend/`:

```bash
cd /workspaces/martian-map/frontend
npm install
npm run build
npm run dev
```

## Important

The application remains a research/simulation tool. NASA sources can provide evidence and reference measurements, but the NeuroNexus mission panel is not live flight software, not medical monitoring, and not NASA-certified mission-safety logic.
