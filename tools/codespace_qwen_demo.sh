#!/usr/bin/env bash
# One-shot local demo of Mars Intelligence with the fine-tuned Qwen 4B + Gemini router.
# Made for a GitHub Codespace (4 cores, 16 GB RAM), works on any Ubuntu/Debian box.
#
#   export GEMINI_API_KEY=...            # optional; without it Qwen answers everything it can
#   bash tools/codespace_qwen_demo.sh          # install, build, start, smoke test
#   bash tools/codespace_qwen_demo.sh stop     # stop both servers
#
# Re-running is safe: finished steps are skipped. Logs: ~/nn-demo/*.log
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${NN_DEMO_DIR:-$HOME/nn-demo}"
GGUF_REPO="Mhaquehaque/neuronexus-qwen3-4b-mars-intel"
GGUF_FILE="neuronexus-qwen3-4b-mars-intel-Q4_K_M.gguf"
QWEN_PORT=8081
API_PORT=7860
THREADS="${QWEN_THREADS:-3}"     # leave one core for the API and the browser
mkdir -p "$WORK"
step() { printf '\n== %s\n' "$*"; }

stop_servers() {
  for f in "$WORK/llama.pid" "$WORK/api.pid"; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
    rm -f "$f"
  done
}
if [ "${1:-}" = "stop" ]; then stop_servers; echo "stopped"; exit 0; fi

step "1/7 system packages"
need=()
for p in cmake g++ git-lfs curl python3-venv; do
  case "$p" in
    g++|cmake|curl) command -v "$p" >/dev/null || need+=("$p") ;;
    git-lfs) git lfs version >/dev/null 2>&1 || need+=("git-lfs") ;;
    python3-venv) python3 -c "import venv, ensurepip" 2>/dev/null || need+=("python3-venv") ;;
  esac
done
if [ ${#need[@]} -gt 0 ]; then sudo apt-get update -qq && sudo apt-get install -y -qq "${need[@]}" build-essential; fi
echo "ok"

step "2/7 NASA MOLA terrain (Git LFS, about 520 MB, once)"
cd "$REPO"
git lfs install --local >/dev/null
if [ "$(stat -c %s data/raw/mola/meg128/topography/megt00n090hb.img 2>/dev/null || echo 0)" -lt 1000000 ]; then
  git lfs pull --include="data/raw/mola/**"
fi
echo "ok"

step "3/7 llama.cpp server (CPU build, about 5 to 8 min once)"
LLAMA="$WORK/llama.cpp"
if [ ! -x "$LLAMA/build/bin/llama-server" ]; then
  [ -d "$LLAMA" ] || git clone -q --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA"
  cmake -S "$LLAMA" -B "$LLAMA/build" -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DGGML_CUDA=OFF > "$WORK/build.log"
  cmake --build "$LLAMA/build" -j "$(nproc)" --target llama-server >> "$WORK/build.log"
fi
echo "ok"

step "4/7 fine-tuned model (2.5 GB, once)"
MODEL="$WORK/$GGUF_FILE"
if [ ! -s "$MODEL" ] || [ "$(stat -c %s "$MODEL")" -lt 2000000000 ]; then
  curl -L --fail --retry 3 -o "$MODEL" "https://huggingface.co/$GGUF_REPO/resolve/main/$GGUF_FILE"
fi
echo "ok: $(du -h "$MODEL" | cut -f1)"

step "5/7 Python and frontend"
VENV="$WORK/venv"
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$REPO/requirements.txt"
if [ ! -f "$REPO/frontend/dist/index.html" ] || [ -n "$(find "$REPO/frontend/src" -newer "$REPO/frontend/dist/index.html" -print -quit)" ]; then
  (cd "$REPO/frontend" && npm ci --no-audit --no-fund --loglevel=error && npm run build > "$WORK/frontend.log" 2>&1)
fi
echo "ok"

step "6/7 start servers"
stop_servers
nohup "$LLAMA/build/bin/llama-server" -m "$MODEL" --jinja -c 4096 -np 1 -t "$THREADS" \
  --host 127.0.0.1 --port "$QWEN_PORT" --alias neuronexus-qwen3-4b-mars-intel > "$WORK/llama.log" 2>&1 &
echo $! > "$WORK/llama.pid"
until curl -s "http://127.0.0.1:$QWEN_PORT/health" | grep -q ok; do sleep 2; done
echo "llama-server up on :$QWEN_PORT"
(cd "$REPO" && QWEN_BASE_URL="http://127.0.0.1:$QWEN_PORT" QWEN_TIMEOUT_S="${QWEN_TIMEOUT_S:-180}" \
  nohup "$VENV/bin/python" -m uvicorn science.serve:app --host 0.0.0.0 --port "$API_PORT" > "$WORK/api.log" 2>&1 &
  echo $! > "$WORK/api.pid")
until curl -s "http://127.0.0.1:$API_PORT/api/ai/status" > /dev/null; do sleep 2; done
echo "API + console up on :$API_PORT"

step "7/7 smoke test: one question per route"
"$VENV/bin/python" - "$API_PORT" <<'PY'
import json, sys, time, urllib.request
port = sys.argv[1]
def call(path, body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=400))
status = call("/api/ai/status")
qwen = status["router"]["providers"]["qwen"]
print(f"gemini: {status.get('model_check', {}).get('status')} ({status.get('model')})   qwen: healthy={qwen['healthy']}")
env = call("/api/environment/by-place?name=Gale&sol=100")
state = {"selection": {"latitude_deg": -5.3672, "longitude_deg": 137.811, "label": "Gale", "mode": "named_feature"},
         "environment": env}
for q in ["How steep is the terrain here?", "Is it safe to walk here?",
          "Compare the dust and thermal conditions and plan which hour to go out."]:
    t = time.time()
    r = call("/api/ai/chat", {"messages": [{"role": "user", "content": q}], "mission_state": state})
    print(f"\nQ: {q}\n-> {r.get('provider')} | {r.get('route_reason')} | fallback: {r.get('fallback_from')} | {time.time() - t:.0f}s")
    print("   " + (r.get("text") or r.get("reason") or "")[:400].replace("\n", " "))
PY

URL="http://localhost:$API_PORT"
[ -n "${CODESPACE_NAME:-}" ] && URL="https://${CODESPACE_NAME}-${API_PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
cat <<EOF

== ready
Console:  $URL   (Codespaces: Ports tab, port $API_PORT)
Open Mars Intelligence (top bar), pick a site, ask "How steep is the terrain here?".
Each answer says which model answered and why. Router log: $URL/api/ai/status
Stop:     bash tools/codespace_qwen_demo.sh stop
EOF
