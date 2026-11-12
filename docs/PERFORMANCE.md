# Performance (measured 2026-10-20)

Headless Chromium with software WebGL in a cloud container, so absolute numbers are pessimistic; compare the two
columns. Commands: `node frontend/e2e/perf.mjs` (browser) and `curl -w %{time_total}` against a warm server.

## Browser: Browser Optimization OFF (default) vs ON (LOW-RAM)

| Measure | OFF · MAX FIDELITY | ON · LOW-RAM |
| --- | --- | --- |
| Time to SYSTEM ONLINE + THEMIS readout | 8.2 s | 8.6 s |
| Global console FPS (5 s) | 36.5 | 38.1 |
| Global console JS heap | 107.9 MB | 117.0 MB |
| MARSWALK FPS (5 s) | 60.1 | 59.9 |
| MARSWALK JS heap | 126.8 MB | 99.9 MB |

On this machine (8 GB, `deviceMemory` 8) the low-RAM mode mainly saves memory in MARSWALK (−21%); frame rate is
unchanged. Computed numbers are identical in both modes (worker parity tests).

## Backend (warm, single request)

| Endpoint | Time |
| --- | --- |
| `GET /api/places?limit=2052` | 1.26 s (serialization of 2,052 features) |
| `GET /api/environment/by-place?name=Gale&sol=100` | 1.11 s |
| `GET /api/rovers/msl/traverse?max_vertices=3000` | 0.015 s (was 15–20 s before caching + startup warm-up) |
| `GET /api/dust/map?sol=400` | 0.014 s |
| `GET /api/conditions?site=gale&sol=400` | 0.003 s |
