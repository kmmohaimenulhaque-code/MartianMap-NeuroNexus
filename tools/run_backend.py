"""Start the FastAPI backend on port 8002, or explain why port 8002 is busy instead of "[Errno 98] address already in use".

  python tools/run_backend.py            # start (http://127.0.0.1:8002/docs)
  python tools/run_backend.py --stop     # stop a NeuroNexus backend already holding the port

Errno 98 means another process already listens on the port, usually an earlier backend left running in another
terminal. If that process is a healthy NeuroNexus backend (GET /health answers {"status": "ok"}), it is reused.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import urllib.request

HOST, PORT = "127.0.0.1", 8002


def port_busy(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex((host, port)) == 0


def health(host: str, port: int) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/health", timeout=3) as r:
            body = json.loads(r.read())
            return body if body.get("status") == "ok" else None
    except (OSError, ValueError):
        return None


def holder_pids(port: int) -> list[int]:
    for cmd in (["lsof", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"], ["fuser", f"{port}/tcp"]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout
        except (OSError, subprocess.TimeoutExpired):
            continue
        pids = [int(p) for p in out.split() if p.strip().isdigit()]
        if pids:
            return pids
    return []


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--stop", action="store_true", help="stop the NeuroNexus backend holding the port")
    args = parser.parse_args(argv)

    if port_busy(HOST, args.port):
        ok = health(HOST, args.port)
        if args.stop:
            if not ok:
                print(f"Port {args.port} is held by something that is not a NeuroNexus backend; not stopping it.")
                return 1
            os.kill(int(ok["pid"]), signal.SIGTERM)
            print(f"Stopped NeuroNexus backend pid {ok['pid']} on port {args.port}.")
            return 0
        if ok:
            print(f"A NeuroNexus backend is already running on port {args.port} (pid {ok['pid']}); the console will use it.")
            print("To restart it: python tools/run_backend.py --stop && python tools/run_backend.py")
            return 0
        pids = holder_pids(args.port)
        print(f"Port {args.port} is in use by another program{f' (pid {pids})' if pids else ''}, which is not a NeuroNexus backend.")
        print(f"Stop it (e.g. kill {pids[0] if pids else '<pid>'}) or start on another port: --port 8003 (then point the Vite proxy there).")
        return 1
    if args.stop:
        print(f"Nothing is running on port {args.port}.")
        return 0
    cmd = [sys.executable, "-m", "uvicorn", "science.weather.api.environment:app", "--host", HOST, "--port", str(args.port)]
    print("Starting:", " ".join(cmd))
    return subprocess.call(cmd)


if __name__ == "__main__":
    sys.exit(main())
