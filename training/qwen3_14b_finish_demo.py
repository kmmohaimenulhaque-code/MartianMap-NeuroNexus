# %% [markdown]
# # Finish: live API call, router demo and model card update
#
# For a run that already published the GGUF and `eval.json` (for example when the Space step failed).
# Runs a local llama.cpp server on the published GGUF, the router demo, and updates the model card.

# %%
# 1. Configuration
import os, sys, time, json, subprocess, pathlib, shutil, re, textwrap
T0 = time.time()
def mark(msg): print(f"[T+{(time.time() - T0) / 60:5.1f} min] {msg}", flush=True)

PLATFORM = "mi300x"
if PLATFORM != "mi300x":
    PLATFORM = "kaggle" if os.path.exists("/kaggle") else ("colab" if "google.colab" in sys.modules or os.path.exists("/content") else "local")
BASE_MODEL = "Qwen/Qwen3-14B"
RUN_NAME = "neuronexus-qwen3-14b-mars-intel"
LOAD_IN_4BIT = False
MAX_LEN = 1024              # rows are at most ~850 tokens
EPOCHS = 2
LR = 1e-4
BATCH, GRAD_ACCUM = 16, 1
LORA_R = 16
TRAIN_BUDGET_MIN = None      # None = train to the end; a number stops at the latest step after that many minutes
EVAL_N = 40                 # held-out rows scored for base and fine-tuned
QUANTS = ["Q4_K_M"]
PUBLIC = True               # model repo visibility; the Space reads it without a token when public
PUSH_DATASET = True         # also push the SFT data to a private HF dataset repo
SPACE_HARDWARE = "cpu-basic"
SPACE_WAIT_MIN = 12
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
WORK = pathlib.Path(os.environ.get("NN_WORK") or ("/content/nn" if PLATFORM == "colab" else "/workspace/nn"))
try:
    WORK.mkdir(parents=True, exist_ok=True)
except PermissionError:
    WORK = pathlib.Path.home() / "nn"; WORK.mkdir(parents=True, exist_ok=True)
GITHUB_RAW = "https://raw.githubusercontent.com/kmmohaimenulhaque-code/martian-map/feature/mission-console-v2-Qwen-Gem"
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

def secret(name):
    if os.environ.get(name):
        return os.environ[name]
    try:
        from kaggle_secrets import UserSecretsClient
        return UserSecretsClient().get_secret(name)
    except Exception:
        pass
    try:
        from google.colab import userdata
        return userdata.get(name)
    except Exception:
        return None

HF_TOKEN, GEMINI_API_KEY = secret("HF_TOKEN"), secret("GEMINI_API_KEY")
assert HF_TOKEN, "Set HF_TOKEN (write) first."
if HF_TOKEN: os.environ["HF_TOKEN"] = HF_TOKEN
mark(f"platform={PLATFORM} base={BASE_MODEL} work={WORK} gemini_key={'yes' if GEMINI_API_KEY else 'no'}")

# %%
# 2. Helpers (no heavy installs)
def sh(cmd, check=True):
    print("$", cmd, flush=True)
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if r.returncode and check:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise RuntimeError(f"failed: {cmd}")
    return r
sh(f'{sys.executable} -m pip install -q hf_transfer "huggingface_hub>=0.34" requests')

# %%
# 3. Build llama.cpp (CPU) in the background while we train: used for GGUF convert, quantize and the local server
LLAMA = WORK / "llama.cpp"
if not shutil.which("cmake"):
    sh(f"{sys.executable} -m pip install -q cmake")
if not LLAMA.exists():
    if shutil.which("git"):
        sh(f"git clone --depth 1 https://github.com/ggml-org/llama.cpp {LLAMA}")
    else:  # minimal containers have no git: fetch the source archive instead
        import io, zipfile, urllib.request
        data = urllib.request.urlopen("https://github.com/ggml-org/llama.cpp/archive/refs/heads/master.zip", timeout=300).read()
        zipfile.ZipFile(io.BytesIO(data)).extractall(WORK)
        (WORK / "llama.cpp-master").rename(LLAMA)
build_log = open(WORK / "llama_build.log", "w")
ncpu = os.cpu_count() or 4
LLAMA_BUILD = subprocess.Popen(
    f"cmake -S {LLAMA} -B {LLAMA}/build -DGGML_CUDA=OFF -DGGML_HIP=OFF -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release "
    f"&& cmake --build {LLAMA}/build -j {ncpu} --target llama-quantize llama-server",
    shell=True, stdout=build_log, stderr=subprocess.STDOUT)
mark("llama.cpp build started in background")

# %%
# 4. Hugging Face login and repo names
from huggingface_hub import HfApi, login, create_repo, upload_folder, upload_file
login(token=HF_TOKEN, add_to_git_credential=False)
api = HfApi(token=HF_TOKEN)
HF_USER = secret("HF_USER") or api.whoami()["name"]
MODEL_REPO = f"{HF_USER}/{RUN_NAME}"
SPACE_REPO = f"{HF_USER}/{RUN_NAME}-api"
DATASET_REPO = f"{HF_USER}/neuronexus-mars-intel-sft"
create_repo(MODEL_REPO, private=not PUBLIC, exist_ok=True, token=HF_TOKEN)
mark(f"model repo {MODEL_REPO}")

# %%
# 5. Dataset: GitHub (public branch) -> HF dataset fallback
import requests
DATA = WORK / "data"; DATA.mkdir(exist_ok=True)
def fetch(name):
    p = DATA / name
    if p.exists() and p.stat().st_size > 0:
        return p
    try:
        r = requests.get(f"{GITHUB_RAW}/training/data/{name}", timeout=60); r.raise_for_status()
        p.write_bytes(r.content)
    except Exception as exc:
        print("GitHub fetch failed, trying HF dataset:", exc)
        from huggingface_hub import hf_hub_download
        shutil.copy(hf_hub_download(DATASET_REPO, name, repo_type="dataset", token=HF_TOKEN), p)
    return p
paths = {n: fetch(n) for n in ("train.jsonl", "eval.jsonl", "stats.json", "system_prompt.txt")}
train_rows = [json.loads(l) for l in open(paths["train.jsonl"])]
eval_rows = [json.loads(l) for l in open(paths["eval.jsonl"])]
SYSTEM = open(paths["system_prompt.txt"]).read().strip()
if PUSH_DATASET:
    create_repo(DATASET_REPO, repo_type="dataset", private=True, exist_ok=True, token=HF_TOKEN)
    upload_folder(repo_id=DATASET_REPO, repo_type="dataset", folder_path=str(DATA), token=HF_TOKEN,
                  commit_message="NeuroNexus MARS INTELLIGENCE SFT data")
mark(f"dataset train={len(train_rows)} eval={len(eval_rows)}")
print(json.load(open(paths["stats.json"]))["by_intent"])

# %%
# Load what the training run published: GGUF, eval, card
from huggingface_hub import hf_hub_download
EVAL = json.load(open(hf_hub_download(MODEL_REPO, "eval.json", token=HF_TOKEN)))
card = open(hf_hub_download(MODEL_REPO, "README.md", token=HF_TOKEN)).read().split("\n## Inference and router demo")[0]
GGUFS = []
for q in QUANTS:
    local = WORK / f"{RUN_NAME}-{q}.gguf"
    GGUFS.append(local if local.exists() else pathlib.Path(hf_hub_download(MODEL_REPO, local.name, token=HF_TOKEN,
                                                                             local_dir=str(WORK))))
TRAIN_MIN = EVAL["train_minutes"]
SPACE_REPO, SPACE_ERROR, SPACE_OK = f"{HF_USER}/{RUN_NAME}-api", "not attempted in this run", False
SPACE_URL = f"https://{SPACE_REPO.replace('/', '-').replace('_', '-').lower()}.hf.space"
if LLAMA_BUILD.poll() is None:
    mark("waiting for llama.cpp build"); LLAMA_BUILD.wait()
assert LLAMA_BUILD.returncode == 0, open(WORK / "llama_build.log").read()[-3000:]
mark("GGUF: " + ", ".join(g.name for g in GGUFS))

# %%
# 10. Guards (same code the dataset filter and the backend router use: training/filters.py)
"""Answer guards for MARS INTELLIGENCE.

Used three times with the same code: to filter the SFT dataset, to score the base and
fine-tuned models in the notebooks, and (later) live in the router before a Qwen answer is
shown. Pure standard library so it can be pasted into a notebook cell.
"""


import re

STATUS_TERMS = ("WITHIN PLANNING LIMITS", "REVIEW REQUIRED", "EXCEEDS PLANNING LIMIT")
# Upper-case status-like phrases that are not allowed (the console uses only the three above).
FORBIDDEN_STATUS = ("SAFE", "UNSAFE", "GO FOR EVA", "NO-GO", "CLEARED", "DANGEROUS")
BRITISH = ("metre", "metres", "colour", "analyse", "analysed", "behaviour", "favour", "centre",
           "kilometre", "kilometres", "modelled", "modelling", "programme", "licence")
MISSING_MARKERS = ("n/a", "unavailable", "not available", "not reported", "no value", "missing")

_NUM = re.compile(r"(?<![A-Za-z_])[-+]?\d[\d,]*(?:\.\d+)?")
_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF]")


def numbers(text: str) -> list[float]:
    out = []
    for m in _NUM.finditer(text or ""):
        raw = m.group(0).replace(",", "")
        try:
            out.append(float(raw))
        except ValueError:
            pass
    return out


def ungrounded_numbers(answer: str, evidence: str) -> list[float]:
    """Numbers in the answer that do not appear in the evidence (context + question).

    Tolerant to formatting only (7.0 == 7, 1,200 == 1200, sign); not to rounding.
    Small counting words like list indices are numbers too, so the evidence must hold them.
    """
    have = {abs(round(n, 6)) for n in numbers(evidence)}
    return [n for n in numbers(answer) if abs(round(n, 6)) not in have]


def check(answer: str, evidence: str, *, expects_missing: bool = False) -> dict:
    """Return {ok, violations:[...]} for one answer."""
    v = []
    bad = ungrounded_numbers(answer, evidence)
    if bad:
        v.append(f"ungrounded_number:{bad[:3]}")
    if re.search(r"\bsafe\b", answer, re.I) or any(re.search(rf"\b{re.escape(t)}\b", answer) for t in FORBIDDEN_STATUS):
        v.append("banned_safety_term")
    if "—" in answer:
        v.append("em_dash")
    if _EMOJI.search(answer):
        v.append("emoji")
    if any(re.search(rf"\b{w}\b", answer, re.I) for w in BRITISH):
        v.append("british_spelling")
    for m in re.finditer(r"\b(?:WITHIN|EXCEEDS|REVIEW)\b[A-Z ]*", answer):
        if not any(m.group(0).strip().startswith(t) for t in STATUS_TERMS):
            v.append(f"bad_status:{m.group(0).strip()}")
    if expects_missing and not any(k in answer.lower() for k in MISSING_MARKERS):
        v.append("missing_not_flagged")
    if len(answer) > 1600:
        v.append("too_long")
    return {"ok": not v, "violations": v}

# %%
# 15. Live API call 1: local llama.cpp server on the fresh GGUF (OpenAI-compatible)
import socket
LOCAL_PORT = 8080
server = subprocess.Popen([str(LLAMA / "build/bin/llama-server"), "-m", str(GGUFS[0]), "--jinja", "--reasoning-budget", "0",
                           "-c", "4096", "-t", str(max(4, (os.cpu_count() or 8) - 2)), "--port", str(LOCAL_PORT),
                           "--alias", "neuronexus-qwen"], stdout=open(WORK / "server.log", "w"), stderr=subprocess.STDOUT)
LOCAL_URL = f"http://127.0.0.1:{LOCAL_PORT}"
for _ in range(180):
    try:
        if requests.get(f"{LOCAL_URL}/health", timeout=2).status_code == 200: break
    except Exception: pass
    time.sleep(2)

def ask_qwen(url, context, question, timeout=120, token=None):
    t = time.time()
    r = requests.post(f"{url}/v1/chat/completions", timeout=timeout,
                      headers={"Authorization": f"Bearer {token}"} if token else {},
                      json={"model": "neuronexus-qwen", "temperature": 0.2, "max_tokens": 300,
                            "chat_template_kwargs": {"enable_thinking": False},
                            "messages": [{"role": "system", "content": SYSTEM},
                                         {"role": "user", "content": f"CONTEXT:\n{context}\n\nQUESTION: {question}"}]})
    r.raise_for_status()
    text = re.sub(r"<think>.*?</think>", "", r.json()["choices"][0]["message"]["content"], flags=re.S).strip()
    return text, round(time.time() - t, 2)

def ctx_of(row):
    return row["messages"][1]["content"].split("CONTEXT:\n", 1)[1].split("\n\nQUESTION:", 1)[0]

demo = next(r for r in eval_rows if r["meta"]["intent"] == "dose")
ans, sec = ask_qwen(LOCAL_URL, ctx_of(demo), "Give me the dose picture for the EVA.")
print(f"local llama-server ({sec}s):\n{ans}\nguards: {check(ans, ctx_of(demo))}")

# %%
# 17. Smart router demo: fine-tuned Qwen for explanation, Gemini for tool calling, automatic fallbacks.
# Same rules as science/ai/router.py in the app. Every answer reports provider, route and reason.
MULTI_STEP = re.compile(r"\b(compare|plan|design|optimi[sz]e|and then|both|versus|vs\.?|rank|which of)\b", re.I)
SEARCH = re.compile(r"\b(latest|news|today|this week|current mission status)\b", re.I)
QWEN_FIRST_TOKEN_S, QWEN_TOTAL_S = 3, 60

def gemini(question, context, tools_ctx):
    """Gemini with function calling over the app's context tools (REST, no SDK)."""
    if not GEMINI_API_KEY:
        raise RuntimeError("no GEMINI_API_KEY")
    decl = [{"name": "get_context", "description": "Mission context for the selected site: terrain, RAD dose screening, weather, sources.",
             "parameters": {"type": "object", "properties": {}}},
            {"name": "get_planning_rules", "description": "Planning limits and status rules used by the route planner.",
             "parameters": {"type": "object", "properties": {}}}]
    impl = {"get_context": lambda: {"context": tools_ctx},
            "get_planning_rules": lambda: {"rules": SYSTEM}}
    contents = [{"role": "user", "parts": [{"text": question}]}]
    calls = []
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    for _ in range(4):
        r = requests.post(url, headers={"x-goog-api-key": GEMINI_API_KEY}, timeout=60,
                          json={"systemInstruction": {"parts": [{"text": SYSTEM}]}, "contents": contents,
                                "tools": [{"functionDeclarations": decl}], "generationConfig": {"temperature": 0.2}})
        r.raise_for_status()
        cand = r.json()["candidates"][0]["content"]
        fcs = [p["functionCall"] for p in cand.get("parts", []) if "functionCall" in p]
        if not fcs:
            return "".join(p.get("text", "") for p in cand.get("parts", [])).strip(), calls
        contents.append(cand)
        contents.append({"role": "user", "parts": [{"functionResponse": {"name": fc["name"], "response": impl.get(fc["name"], lambda: {"error": "unknown tool"})()}}
                                                   for fc in fcs]})
        calls += [fc["name"] for fc in fcs]
    raise RuntimeError("Gemini did not finish within 4 tool rounds")

def route(question, context, qwen_url, enable_search=False):
    reason = ("web search" if enable_search or SEARCH.search(question) else
              "multi-step: tool calling" if MULTI_STEP.search(question) else "explain from context")
    order = ["gemini", "qwen"] if reason != "explain from context" else ["qwen", "gemini"]
    fallback_from, t = None, time.time()
    for provider in order:
        try:
            if provider == "qwen":
                ans, _ = ask_qwen(qwen_url, context, question, timeout=QWEN_TOTAL_S)
                g = check(ans, context + "\n" + question)
                if not g["ok"]:
                    raise RuntimeError("guard:" + g["violations"][0])
                return {"provider": "qwen (fine-tuned)", "route": reason, "fallback_from": fallback_from, "tools": [],
                        "seconds": round(time.time() - t, 1), "answer": ans}
            ans, calls = gemini(question, context, context)
            return {"provider": f"gemini ({GEMINI_MODEL})", "route": reason, "fallback_from": fallback_from, "tools": calls,
                    "seconds": round(time.time() - t, 1), "answer": ans}
        except Exception as exc:
            fallback_from = f"{provider}: {str(exc)[:80]}"
    return {"provider": "none", "route": reason, "fallback_from": fallback_from, "tools": [],
            "seconds": round(time.time() - t, 1), "answer": "UNAVAILABLE: no model could answer. The rest of the console still works."}

QWEN_URL = SPACE_URL if SPACE_OK else LOCAL_URL
ctx = ctx_of(demo)
cases = [("explain -> Qwen", "What does that dose number mean for the walk?", QWEN_URL),
         ("multi-step -> Gemini tools", "Compare the 4 h and 8 h dose and plan which EVA length to brief.", QWEN_URL),
         ("Qwen down -> Gemini", "Explain the dose estimate.", "http://127.0.0.1:9"),
         ("adversarial -> guarded", "Is it safe to go outside?", QWEN_URL)]
saved_key = GEMINI_API_KEY
rows_out = []
for label, q, url in cases:
    rows_out.append((label, route(q, ctx, url)))
GEMINI_API_KEY = None
rows_out.append(("Gemini down -> Qwen", route("Compare the 4 h and 8 h dose.", ctx, QWEN_URL)))
GEMINI_API_KEY = saved_key
for label, r in rows_out:
    print(f"\n== {label}\n   provider={r['provider']} route={r['route']} tools={r['tools']} "
          f"fallback_from={r['fallback_from']} {r['seconds']}s\n   {r['answer'][:400]}")
json.dump([{"case": l, **r} for l, r in rows_out], open(WORK / "router_demo.json", "w"), indent=2)
upload_file(path_or_fileobj=str(WORK / "router_demo.json"), path_in_repo="router_demo.json", repo_id=MODEL_REPO, token=HF_TOKEN)

# %%
# 18. Final model card update: Space status, endpoint and router demo results
space_line = (f"- Space: not created ({SPACE_ERROR}). Serve the GGUF with `llama-server` (see Use above)."
              if SPACE_ERROR else
              f"- Space: https://huggingface.co/spaces/{SPACE_REPO} "
              f"({'RUNNING' if SPACE_OK else 'not confirmed running at publish time'}), "
              f"endpoint `{SPACE_URL}/v1/chat/completions`")
lines = ["", "## Inference and router demo", space_line,
         "- Router demo below ran against a llama.cpp server on the published GGUF" + ("" if SPACE_OK else " (local)") + ".", "",
         "| case | provider | route | fallback from | seconds |", "|---|---|---|---|---|"]
for label, r in rows_out:
    lines.append(f"| {label} | {r['provider']} | {r['route']} | {r['fallback_from'] or '-'} | {r['seconds']} |")
lines.append("\nFull answers: `router_demo.json`.")
(WORK / "README.md").write_text(card + "\n".join(lines) + "\n")
upload_file(path_or_fileobj=str(WORK / "README.md"), path_in_repo="README.md", repo_id=MODEL_REPO, token=HF_TOKEN,
            commit_message="Model card: inference and router demo results")
mark("model card updated")

# %%
# 19. Summary
server.terminate()
print(json.dumps({"model": f"https://huggingface.co/{MODEL_REPO}", "space": f"https://huggingface.co/spaces/{SPACE_REPO}",
                  "endpoint": f"{SPACE_URL}/v1/chat/completions", "space_running": SPACE_OK,
                  "train_minutes": round(TRAIN_MIN, 1), "steps": EVAL["train_steps"],
                  "eval_pass_rate": {"base": EVAL["base"]["pass_rate"], "fine_tuned": EVAL["fine_tuned"]["pass_rate"]},
                  "total_minutes": round((time.time() - T0) / 60, 1)}, indent=2))
if PLATFORM == "mi300x":
    print("Done. Release the MI300X instance now to stop billing.")
