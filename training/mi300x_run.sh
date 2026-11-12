#!/usr/bin/env bash
# One-shot Qwen3-14B fine-tune on an AMD MI300X (devcloud). Paste your three values, then:
#   bash mi300x_run.sh
# Runs detached, so an SSH drop does not stop it. Watch with: tail -f ~/nn/run.log
set -euo pipefail

export HF_TOKEN="PASTE_HF_WRITE_TOKEN_HERE"
export HF_USER="PASTE_HF_USERNAME_HERE"
export GEMINI_API_KEY="PASTE_GEMINI_API_KEY_HERE"   # optional: leave as is to skip the Gemini demo

export NN_WORK="$HOME/nn"
BRANCH="feature/mission-console-v2-Qwen-Gem"
REPO="https://github.com/kmmohaimenulhaque-code/martian-map.git"
mkdir -p "$NN_WORK"
case "$GEMINI_API_KEY" in PASTE_*) unset GEMINI_API_KEY ;; esac
case "$HF_TOKEN" in PASTE_*) echo "Set HF_TOKEN first."; exit 1 ;; esac

echo "== GPU and disk"
rocm-smi --showproductname 2>/dev/null || echo "rocm-smi not found (fine inside some images)"
FREE_GB=$(df -BG --output=avail "$NN_WORK" | tail -1 | tr -dc 0-9)
echo "free disk: ${FREE_GB} GB (need about 100)"
[ "$FREE_GB" -ge 100 ] || echo "WARNING: low disk; set NN_WORK to a bigger volume"

echo "== code"
if [ -d "$NN_WORK/martian-map/.git" ]; then git -C "$NN_WORK/martian-map" pull -q; else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$NN_WORK/martian-map"; fi
SCRIPT="$NN_WORK/martian-map/training/qwen3_14b_mi300x.py"

if python3 -c "import torch,sys; sys.exit(0 if torch.version.hip and torch.cuda.is_available() else 1)" 2>/dev/null; then
  echo "== host has ROCm PyTorch: using a venv that inherits it"
  [ -d "$NN_WORK/venv" ] || python3 -m venv --system-site-packages "$NN_WORK/venv"
  # shellcheck disable=SC1091
  source "$NN_WORK/venv/bin/activate"
  python -m pip install -q -U pip
  nohup setsid python -u "$SCRIPT" > "$NN_WORK/run.log" 2>&1 &
else
  echo "== no ROCm PyTorch on host: running in the rocm/pytorch container"
  docker run -d --name nn-qwen14b --rm --device=/dev/kfd --device=/dev/dri --group-add video \
    --ipc=host --shm-size 64G --security-opt seccomp=unconfined \
    -e HF_TOKEN -e HF_USER -e GEMINI_API_KEY -e NN_WORK=/workspace/nn \
    -v "$NN_WORK":/workspace/nn rocm/pytorch:latest \
    bash -c "python -u /workspace/nn/martian-map/training/qwen3_14b_mi300x.py > /workspace/nn/run.log 2>&1"
fi

sleep 5
echo "== started. Follow progress:  tail -f $NN_WORK/run.log"
echo "   Training ETA prints at step 10. Release the instance when the log says Done."
