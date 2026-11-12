# Deploying NeuroNexus

NeuroNexus has two parts:

| Part | What it is | Default port |
|------|-----------|--------------|
| **API** | Python FastAPI app `science.weather.api.environment:app`. It reads NASA MOLA, THEMIS and the Ames dust scenario from disk. | 8002 |
| **Console** | React + Vite static site. It calls the API at the relative path `/api/*`. | 5173 dev, 8080 Docker |

The browser never talks to Gemini directly. `GEMINI_API_KEY` lives only on the API server.

The console must reach the API at `/api`. Every deployment option below does this with a reverse proxy: Vite in development, nginx in Docker, and rewrites on static hosts.

---

## 0. Prerequisites (every option)

```bash
git clone https://github.com/kmmohaimenulhaque-code/martian-map.git
cd martian-map
git lfs install && git lfs pull        # real NASA MOLA terrain (~520 MB), not LFS pointers
cp .env.example .env                    # then paste your Gemini key into .env
```

- The **dust scenario** is read from `external/mars-gcm/data/DustScenario_MY34.nc` when the submodule is checked out (`git submodule update --init`). Otherwise the copy in the repository root is used. You can also set `NEURONEXUS_DUST_FILE` to point at a specific file.
- `GEMINI_API_KEY` is optional. Without it, everything works except Mars Intelligence, which then reports itself as unavailable.

---

## 1. Local development (two terminals)

```bash
# Terminal 1 — API
pip install -r requirements.txt          # or: pip install -r deploy/requirements-api.txt (API only)
python -m uvicorn science.weather.api.environment:app --host 127.0.0.1 --port 8002 --reload

# Terminal 2 — console
cd frontend
npm ci
npm run dev                              # http://localhost:5173
```

API docs: http://127.0.0.1:8002/docs

---

## 2. Docker Compose (recommended for a demo server or VM)

```bash
docker compose up --build -d
```

- Console: **http://localhost:8080**
- API and Swagger docs: http://localhost:8002/docs
- Logs: `docker compose logs -f backend`
- Update after a `git pull`: `docker compose up --build -d`
- Stop: `docker compose down`

How it is wired:

- `deploy/Dockerfile.backend` builds a slim Python 3.14 image with the API's runtime dependencies only (`deploy/requirements-api.txt`). It includes `science/`, `data/` and the dust scenario. It runs as a non-root user and has a health check.
- `deploy/Dockerfile.frontend` builds the Vite bundle and serves it from nginx.
- `deploy/nginx.conf` forwards `/api/*` to the API with the prefix removed (identical to the Vite dev proxy) and `/terrain/*` unchanged.
- `.env` is passed to the API container only.

### Putting it on the internet (any Linux VM)

1. Install Docker, then follow steps 0 and 2 on the VM.
2. Point a domain at the VM and terminate HTTPS in front of port 8080, for example with Caddy:
   ```
   neuronexus.example.org {
       reverse_proxy localhost:8080
   }
   ```
3. Open only ports 80 and 443 publicly. Keep 8002 private: delete the backend `ports:` mapping in `docker-compose.yml`, because nginx reaches the API over the internal Docker network.

---

## 3. Split hosting: static console + hosted API

Use this layout when the console goes on a static host and the API on a container host.

**API** (Render, Railway, Fly.io, Google Cloud Run, Azure Container Apps, …):
- Deploy `deploy/Dockerfile.backend` with the repository root as the build context.
- Set the environment variable `GEMINI_API_KEY`.
- Give the service at least **2 GB RAM**. The dust scenario (~58 MB) and the MOLA tiles are loaded into memory.
- The image must contain the real LFS files. Make sure the platform's build runs `git lfs pull`, or build the image locally and push it to a registry.

**Console** (Vercel, Netlify, GitHub Pages with a proxy, …): build with `cd frontend && npm ci && npm run build`, publish `frontend/dist`, and add a rewrite so that `/api/*` reaches the API:

- **Vercel**, `frontend/vercel.json`:
  ```json
  { "rewrites": [
      { "source": "/api/:path*", "destination": "https://YOUR-API-HOST/:path*" },
      { "source": "/terrain/:path*", "destination": "https://YOUR-API-HOST/terrain/:path*" },
      { "source": "/(.*)", "destination": "/index.html" } ] }
  ```
- **Netlify**, `frontend/public/_redirects`:
  ```
  /api/*      https://YOUR-API-HOST/:splat          200
  /terrain/*  https://YOUR-API-HOST/terrain/:splat  200
  /*          /index.html                           200
  ```

The API sends permissive CORS headers. With these rewrites the browser only ever sees one origin.

---

## 3b. Split API for 512 MB instances (branch `feature/mission-console-v3`)

The full API idles at about 400 MB, and one MARSWALK terrain frame (3 km at 2 m) adds several hundred MB,
so a 512 MB instance (Render free) is killed on the first MARSWALK request. `science/serve_part.py` serves
one slice per instance, imports only that slice (about 130 MB idle) and runs one heavy request at a time:

| Service | Start command | Paths |
|---|---|---|
| core | `uvicorn science.serve:app` | everything else |
| terrain window | `NN_PART=terrain-window uvicorn science.serve_part:app` | `/api/terrain/hires/window`, `/api/terrain/sources` |
| terrain image | `NN_PART=terrain-image uvicorn science.serve_part:app` | `/api/terrain/hires/image` |
| marswalk | `NN_PART=marswalk uvicorn science.serve_part:app` | `/api/marswalk/*` |

Part build command: `pip install -r deploy/requirements-api.txt && python tools/fetch_mola.py --sites gale jezero`
(MOLA straight from NASA PDS, no Git LFS). Set `MALLOC_ARENA_MAX=2`. `frontend/vercel.json` routes each path.
Measured peaks with Curiosity's latest position (100% HiRISE): window 373 MB, image 380 MB, marswalk 317 MB.

---

## 4. Production build without Docker

```bash
cd frontend && npm ci && npm run build && npm run preview   # http://localhost:4173, proxies /api to :8002
```

`vite preview` is fine for demos. For real traffic, serve `frontend/dist` with nginx using `deploy/nginx.conf`, changing `backend:8002` to `127.0.0.1:8002`. Run the API under a process manager, for example a systemd unit:

```ini
[Unit]
Description=NeuroNexus API
After=network.target

[Service]
WorkingDirectory=/opt/martian-map
EnvironmentFile=/opt/martian-map/.env
ExecStart=/opt/martian-map/.venv/bin/uvicorn science.weather.api.environment:app --host 127.0.0.1 --port 8002 --workers 2
Restart=always
User=neuronexus

[Install]
WantedBy=multi-user.target
```

---

## 5. Verify a deployment

```bash
curl -s https://YOUR-HOST/api/dust/meta | head -c 200            # dust scenario loaded
curl -s "https://YOUR-HOST/api/terrain/window?latitude=-5.4&longitude=137.8" | head -c 200   # MOLA present
curl -s https://YOUR-HOST/api/ai/status | head -c 300            # Gemini configured + knowledge sections
```

In the console, check the following:

1. The top bar shows **SYSTEM ONLINE**.
2. The Dust scenario panel draws the τ curve.
3. Site morphology shows MIN/MEAN/MAX.
4. ☰ opens the Command Index.

## 6. Tests

```bash
python -m pytest -q tests/          # API, routing, dust, knowledge base
cd frontend && npm test             # vitest (saved routes, command registry) + node:test suites
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `NASA MOLA MEGDR tiles unavailable` / terrain 400s | The LFS files are pointers. Run `git lfs pull` and rebuild. |
| Dust panel: "DUST TIME SERIES UNAVAILABLE" | `DustScenario_MY34.nc` is missing from the image or path. Check `NEURONEXUS_DUST_FILE`. |
| Mars Intelligence "GEMINI_API_KEY is not configured" | Set the key in `.env` (Docker) or the host's environment variables, then restart the API. |
| Mars Intelligence model errors | `/api/ai/status` lists the models your key can use. Set `GEMINI_MODEL` to one of them. |
| Console loads but every panel errors | The `/api` rewrite or proxy is missing or points at the wrong host. |
