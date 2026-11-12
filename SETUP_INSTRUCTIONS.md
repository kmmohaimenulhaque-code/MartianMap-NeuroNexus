# NeuroNexus - Martian Map · Setup Instructions

NASA Space Apps Challenge 2026 · branch `Master-Ai`

The app has two parts that run at the same time:

| Part | Tech | Port | URL |
|---|---|---|---|
| Backend API | Python · FastAPI (uvicorn) | **8002** | http://127.0.0.1:8002/docs |
| Frontend | React · Vite | **5173** (dev) / **4173** (build preview) | http://localhost:5173 |

The frontend forwards `/api/*` to the backend on port 8002, so **start the backend first**.

---

## 1. Requirements

- **Git** and **Git LFS** — https://git-lfs.com
- **Python 3.11 or 3.12**
- **Node.js 20.19+ or 22.12+** (with npm)
- About **4 GB** free disk space (NASA MOLA terrain is ~2.7 GB)

## 2. Get the code and the NASA data

```bash
git clone --branch Master-Ai https://github.com/kmmohaimenulhaque-code/martian-map.git
cd martian-map

git lfs install
git lfs pull                               # NASA MOLA terrain tiles (~2.7 GB)
git submodule update --init --recursive    # NASA Ames Mars GCM dust dataset
```

Check that the terrain downloaded: files in `data/raw/mola/meg128/topography/` should be
about **130 MB each**, not 134 bytes.

<details>
<summary>If <code>git lfs pull</code> fails (e.g. "bandwidth quota exceeded"), download the same tiles from NASA PDS instead</summary>

macOS / Linux:

```bash
BASE=https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128
for t in 00n000 00n090 00n180 00n270 44n000 44n090 44n180 44n270 \
         44s000 44s090 44s180 44s270 88n000 88n090 88n180 88n270; do
  curl -L -o data/raw/mola/meg128/topography/megt${t}hb.img $BASE/megt${t}hb.img
  curl -L -o data/raw/mola/meg128/labels/megt${t}hb.lbl     $BASE/megt${t}hb.lbl
done
```

Windows (PowerShell):

```powershell
$BASE = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128"
$tiles = "00n000","00n090","00n180","00n270","44n000","44n090","44n180","44n270",
         "44s000","44s090","44s180","44s270","88n000","88n090","88n180","88n270"
foreach ($t in $tiles) {
  curl.exe -L -o "data/raw/mola/meg128/topography/megt${t}hb.img" "$BASE/megt${t}hb.img"
  curl.exe -L -o "data/raw/mola/meg128/labels/megt${t}hb.lbl"     "$BASE/megt${t}hb.lbl"
}
```
</details>

## 3. Add the `.env` file (Gemini AI key)

Create a file named **`.env`** in the **repository root** (the same folder as `requirements.txt`):

write this (If you are working from terminal/CLI/codespaces)
```
nano .env
```
And paste inside .env file
```
GEMINI_API_KEY=PASTE_YOUR_API_KEY #real API key obtained from Google AI Studio
```
You can obtain a Gemini API key from Google AI Studio.
#NB: Gemini-powered functionality can be tested by providing a valid Gemini API key in the backend .env file. No API key is required to explore the core terrain, mapping, USGS, 3D, environmental, routing, and visualization features.

Or copy the template: `cp .env.example .env` (Windows: `copy .env.example .env`) and edit it.

- The key is read only by the Python backend and is never sent to the browser.
- `.env` is git-ignored; never commit it.
- No key? Everything still works except **Mars Intelligence** and **AI trade-off analysis**, which
  will say the key is not configured. A free key is available at https://aistudio.google.com/apikey.

## 4. Start the backend (terminal 1)

From the repository root:

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python -m uvicorn science.weather.api.environment:app --host 127.0.0.1 --port 8002
```

Check it: open http://127.0.0.1:8002/docs (API list) and
http://127.0.0.1:8002/ai/status (`"configured": true` once the key is set).

## 5. Start the frontend (terminal 2)

```bash
cd martian-map
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

**Production build** (optional, instead of `npm run dev`):

```bash
npm run build      # creates frontend/dist
npm run preview    # serves the build at http://localhost:4173 (still uses the backend on 8002)
```

## 6. Quick demo path

1. Click anywhere on the left Mars map → site data loads, and the USGS map on the right moves to the same place.
2. **AI ROUTE DESIGN** (on the left map or the top bar) → *Use selected site* for start, pick another
   site → *Use selected site* for destination → **Generate routes** → **Apply route**.
   Routes longer than 120 km are planned automatically in local terrain segments.
3. **USGS SNAPSHOT** → the route drawn on the USGS geologic map.
4. **ORBITAL TRACKING** → live NASA/JPL near-Mars close approaches.
5. **MARS INTELLIGENCE** → ask a question about the site or the routes (needs the API key).
6. Menu (☰) → **Export JSON / Complete CSV / Route CSV**.

## 7. Run the tests (optional)

```bash
python -m pytest tests -q                      # repository root
cd frontend && node --test "tests/*.test.js"    # keep the quotes
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `Invalid MOLA tile size` or terrain errors | Terrain not downloaded — run `git lfs pull` (or the PDS download above). |
| Dust/atmosphere error, missing `DustScenario_MY34.nc` | Run `git submodule update --init --recursive`. |
| Frontend shows request errors / "backend offline" | Start the backend first, on port **8002**. |
| `Port 8002 is already in use` | Stop the other process, or free the port. The frontend expects 8002. |
| Mars Intelligence: "GEMINI_API_KEY is not configured" | Create `.env` in the repo root (step 3), then restart the backend. |
| Mars Intelligence: "No Gemini model answered" | Google is temporarily overloaded — wait a minute and retry. |
| `npm install` fails | Update Node.js to 20.19+ or 22.12+. |
