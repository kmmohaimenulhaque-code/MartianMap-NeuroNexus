#!/usr/bin/env bash
# Every check in one go, from the repository root:  bash tools/check.sh
# Backend tests, frontend lint (0 errors), frontend tests and build. With a server on :7860, also the
# landing-page and device checks (Playwright + Chromium).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$1"; }

step "Backend tests (pytest)"
python -m pytest -q

step "Frontend lint, tests and build"
(cd frontend && npm run lint && npm test && npm run build)

if curl -fs -o /dev/null http://127.0.0.1:7860/api/health; then
  step "Landing page checks (server on :7860)"
  (cd frontend && BASE=http://127.0.0.1:7860 node e2e/landing.mjs)
  step "Device checks (server on :7860)"
  node frontend/e2e/devices.mjs
else
  step "Skipped landing and device checks: start the server on :7860 to include them"
fi

printf '\nAll checks passed.\n'
