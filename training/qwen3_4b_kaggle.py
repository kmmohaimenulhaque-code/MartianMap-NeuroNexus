# %% [markdown]
# # Qwen3-4B fine-tune on Kaggle T4 (QLoRA with Unsloth); also runs on Colab
#
# NeuroNexus Martian Map, MARS INTELLIGENCE voice model. Run all cells top to bottom; nothing needs typing
# except the secrets below.
#
# **Secrets** (environment variables on the MI300X; Kaggle: Add-ons > Secrets; Colab: the key icon):
# - `HF_TOKEN` (write access) - required
# - `GEMINI_API_KEY` - optional, for the router demo's Gemini path
# - `HF_USER` - optional, read from the token if unset
#
# **Pipeline**: setup -> dataset (3,062 train / 333 held-out rows, from the repo's real NASA data) ->
# LoRA training, time-boxed to `TRAIN_BUDGET_MIN` -> adapter to the Hub -> eval base vs fine-tuned ->
# merge -> GGUF -> publish -> Hugging Face Space (llama.cpp server, OpenAI-compatible) -> live API calls ->
# smart router demo (fine-tuned Qwen for explanation, Gemini for tool calling, automatic fallbacks).
#
# The model learns voice and discipline, not facts: at inference every fact comes from the CONTEXT block.
# Statuses are planning statuses, not safety calls.

# %%
# 1. Configuration
import os, sys, time, json, subprocess, pathlib, shutil, re, textwrap
T0 = time.time()
def mark(msg): print(f"[T+{(time.time() - T0) / 60:5.1f} min] {msg}", flush=True)

PLATFORM = "kaggle"
if PLATFORM != "mi300x":
    PLATFORM = "kaggle" if os.path.exists("/kaggle") else ("colab" if "google.colab" in sys.modules or os.path.exists("/content") else "local")
BASE_MODEL = "Qwen/Qwen3-4B-Instruct-2507"
RUN_NAME = "neuronexus-qwen3-4b-mars-intel"
LOAD_IN_4BIT = True
MAX_LEN = 1024              # rows are at most ~850 tokens
EPOCHS = 2
LR = 2e-4
BATCH, GRAD_ACCUM = 4, 4
LORA_R = 16
TRAIN_BUDGET_MIN = 150      # training stops at the latest step after this many minutes
EVAL_N = 40                 # held-out rows scored for base and fine-tuned
QUANTS = ["Q4_K_M", "Q5_K_M"]
PUBLIC = True               # model repo visibility; the Space reads it without a token when public
PUSH_DATASET = True         # also push the SFT data to a private HF dataset repo
SPACE_HARDWARE = "cpu-basic"
SPACE_WAIT_MIN = 12
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
WORK = pathlib.Path(os.environ.get("NN_WORK") or ("/content/nn" if PLATFORM == "colab" else "/tmp/nn"))
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
# 2. Install (never replaces the platform's torch build)
def sh(cmd, check=True):
    print("$", cmd, flush=True)
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if r.returncode and check:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise RuntimeError(f"failed: {cmd}")
    return r

INSTALL = "kaggle"
if INSTALL == "mi300x":
    import torch
    assert torch.version.hip, "Expected a ROCm build of PyTorch (use a rocm/pytorch or rocm/vllm image)."
    sh(f'{sys.executable} -m pip install -q "transformers==4.56.2" "peft==0.17.1" "accelerate>=1.10" datasets hf_transfer '
       '"huggingface_hub>=0.34" sentencepiece protobuf requests')
    USE_UNSLOTH = False
    if sh(f"{sys.executable} -m pip install -q --no-deps unsloth unsloth_zoo", check=False).returncode == 0:
        try:
            import unsloth  # noqa: F401  (ROCm support varies by version; PEFT fallback below)
            USE_UNSLOTH = True
        except Exception as exc:
            print("Unsloth import failed on ROCm, using PEFT:", repr(exc)[:300])
    import torch
    assert torch.version.hip, "torch was replaced by a non-ROCm build; restart from a clean image."
else:
    sh(f'{sys.executable} -m pip install -q unsloth hf_transfer "huggingface_hub>=0.34" sentencepiece protobuf requests')
    USE_UNSLOTH = True
import torch
mark(f"torch {torch.__version__} hip={torch.version.hip} cuda={torch.version.cuda} "
     f"device={torch.cuda.get_device_name(0)} unsloth={USE_UNSLOTH}")

# %%
# 3. Build llama.cpp (CPU) in the background while we train: used for GGUF convert, quantize and the local server
LLAMA = WORK / "llama.cpp"
if not shutil.which("cmake"):
    sh(f"{sys.executable} -m pip install -q cmake")
if not LLAMA.exists():
    sh(f"git clone --depth 1 https://github.com/ggml-org/llama.cpp {LLAMA}")
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
# 6. Load the base model and attach LoRA
TARGETS = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
if USE_UNSLOTH:
    from unsloth import FastLanguageModel
    model, tok = FastLanguageModel.from_pretrained(BASE_MODEL, max_seq_length=MAX_LEN, load_in_4bit=LOAD_IN_4BIT,
                                                   dtype=None, token=HF_TOKEN)
    model = FastLanguageModel.get_peft_model(model, r=LORA_R, lora_alpha=2 * LORA_R, lora_dropout=0,
                                             target_modules=TARGETS, use_gradient_checkpointing="unsloth",
                                             random_state=3407)
else:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import LoraConfig, get_peft_model
    tok = AutoTokenizer.from_pretrained(BASE_MODEL, token=HF_TOKEN)
    model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, torch_dtype=torch.bfloat16, device_map={"": 0},
                                                 attn_implementation="sdpa", token=HF_TOKEN)
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(r=LORA_R, lora_alpha=2 * LORA_R, lora_dropout=0.05,
                                             target_modules=TARGETS, task_type="CAUSAL_LM"))
model.print_trainable_parameters()
mark("model ready")

# %%
# 7. Tokenize: loss on the final assistant answer only (thinking disabled, matching inference)
from datasets import Dataset
END = "<|im_end|>"
def render_prompt(messages):
    return tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)

def encode(row):
    msgs = row["messages"]
    p_ids = tok(render_prompt(msgs[:-1]), add_special_tokens=False)["input_ids"]
    c_ids = tok(msgs[-1]["content"] + END + "\n", add_special_tokens=False)["input_ids"]
    ids = (p_ids + c_ids)[:MAX_LEN]
    labels = ([-100] * len(p_ids) + c_ids)[:MAX_LEN]
    return {"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels}

train_ds = Dataset.from_list([encode(r) for r in train_rows]).shuffle(seed=7)
lens = sorted(len(x) for x in train_ds["input_ids"])
mark(f"tokenized {len(train_ds)} rows, median {lens[len(lens) // 2]} tokens, max {lens[-1]}")

# %%
# 8. Train, time-boxed. Stops cleanly at TRAIN_BUDGET_MIN and keeps the latest weights.
from transformers import Trainer, TrainingArguments, TrainerCallback, DataCollatorForSeq2Seq
bf16 = torch.cuda.is_bf16_supported()
class Budget(TrainerCallback):
    def on_train_begin(self, args, state, control, **kw):
        self.t = time.time()
    def on_step_end(self, args, state, control, **kw):
        el = (time.time() - self.t) / 60
        if state.global_step == 10:
            eta = el / 10 * state.max_steps
            print(f"ETA {eta:.1f} min for {state.max_steps} steps (budget {TRAIN_BUDGET_MIN} min)", flush=True)
        if el > TRAIN_BUDGET_MIN:
            print(f"Budget reached at step {state.global_step}/{state.max_steps}; stopping.", flush=True)
            control.should_training_stop = True

args = TrainingArguments(
    output_dir=str(WORK / "ckpt"), num_train_epochs=EPOCHS, per_device_train_batch_size=BATCH,
    gradient_accumulation_steps=GRAD_ACCUM, learning_rate=LR, lr_scheduler_type="cosine", warmup_ratio=0.03,
    weight_decay=0.0, logging_steps=10, save_strategy="steps", save_steps=100, save_total_limit=2,
    bf16=bf16, fp16=not bf16, optim="adamw_8bit" if LOAD_IN_4BIT else "adamw_torch_fused",
    group_by_length=True, report_to="none", seed=3407, dataloader_num_workers=2,
    gradient_checkpointing=not USE_UNSLOTH, remove_unused_columns=False)
trainer = Trainer(model=model, args=args, train_dataset=train_ds, callbacks=[Budget()],
                  data_collator=DataCollatorForSeq2Seq(tok, padding=True, label_pad_token_id=-100, pad_to_multiple_of=8))
T_TRAIN = time.time()
result = trainer.train()
TRAIN_MIN = (time.time() - T_TRAIN) / 60
TRAIN_LOG = [h for h in trainer.state.log_history if "loss" in h]
mark(f"trained {trainer.state.global_step} steps in {TRAIN_MIN:.1f} min, last loss {TRAIN_LOG[-1]['loss'] if TRAIN_LOG else 'n/a'}")

# %%
# 9. Save the LoRA adapter and push it first, so a slow GGUF step can never lose the training
ADAPTER = WORK / "adapter"
model.save_pretrained(str(ADAPTER)); tok.save_pretrained(str(ADAPTER))
upload_folder(repo_id=MODEL_REPO, folder_path=str(ADAPTER), path_in_repo="adapter", token=HF_TOKEN,
              commit_message=f"LoRA adapter ({trainer.state.global_step} steps)")
mark(f"adapter pushed to https://huggingface.co/{MODEL_REPO}/tree/main/adapter")

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
# 11. Eval: base vs fine-tuned on held-out sites (greedy). Metrics come from the guards above.
import random
random.Random(0).shuffle(eval_rows)
sample = eval_rows[:EVAL_N]
if USE_UNSLOTH:
    FastLanguageModel.for_inference(model)
model.eval(); tok.padding_side = "left"
if tok.pad_token is None: tok.pad_token = tok.eos_token

def generate(rows, bs=10, max_new=220):
    outs = []
    for i in range(0, len(rows), bs):
        prompts = [render_prompt(r["messages"][:-1]) for r in rows[i:i + bs]]
        enc = tok(prompts, return_tensors="pt", padding=True, add_special_tokens=False).to(model.device)
        with torch.no_grad():
            g = model.generate(**enc, max_new_tokens=max_new, do_sample=False, temperature=None, top_p=None, top_k=None,
                               pad_token_id=tok.pad_token_id)
        outs += [tok.decode(x[enc["input_ids"].shape[1]:], skip_special_tokens=True).strip() for x in g]
    return [re.sub(r"<think>.*?</think>", "", o, flags=re.S).strip() for o in outs]

def evidence(r):
    return "\n".join(m["content"] for m in r["messages"][:-1] if m["role"] in ("system", "user"))

def score(answers):
    res = [check(a, evidence(r), expects_missing=r["meta"]["expects_missing"]) for a, r in zip(answers, sample)]
    n = len(res)
    flat = [v.split(":")[0] for x in res for v in x["violations"]]
    return {"pass_rate": round(sum(x["ok"] for x in res) / n, 3),
            "grounded_number_rate": round(1 - sum(any(v.startswith("ungrounded") for v in x["violations"]) for x in res) / n, 3),
            "banned_term_rate": round(sum("banned_safety_term" in [v.split(":")[0] for v in x["violations"]] for x in res) / n, 3),
            "missing_flagged_rate": round(1 - flat.count("missing_not_flagged") / max(1, sum(r["meta"]["expects_missing"] for r in sample)), 3),
            "mean_chars": round(sum(map(len, answers)) / n), "violations": {k: flat.count(k) for k in set(flat)}}

t = time.time()
with model.disable_adapter():
    base_ans = generate(sample)
ft_ans = generate(sample)
EVAL = {"n": len(sample), "base": score(base_ans), "fine_tuned": score(ft_ans), "base_model": BASE_MODEL,
        "train_steps": trainer.state.global_step, "train_minutes": round(TRAIN_MIN, 1),
        "samples": [{"question": r["messages"][-2]["content"].split("QUESTION: ")[-1], "base": b, "fine_tuned": f_,
                     "reference": r["messages"][-1]["content"]} for r, b, f_ in list(zip(sample, base_ans, ft_ans))[:8]]}
json.dump(EVAL, open(WORK / "eval.json", "w"), indent=2)
upload_file(path_or_fileobj=str(WORK / "eval.json"), path_in_repo="eval.json", repo_id=MODEL_REPO, token=HF_TOKEN)
mark(f"eval done in {(time.time() - t) / 60:.1f} min")
print(json.dumps({k: EVAL[k] for k in ("base", "fine_tuned")}, indent=2))
for s in EVAL["samples"][:3]:
    print("\nQ:", s["question"], "\n  base:", s["base"][:300], "\n  fine-tuned:", s["fine_tuned"][:300])

# %%
# 12. Merge LoRA into a 16-bit model, convert to GGUF, quantize
import gc
del trainer, model; gc.collect(); torch.cuda.empty_cache()
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel
MERGED = WORK / "merged"
dev = {"": 0} if PLATFORM == "mi300x" else {"": "cpu"}
base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, torch_dtype=torch.bfloat16 if PLATFORM == "mi300x" else torch.float16,
                                            device_map=dev, low_cpu_mem_usage=True, token=HF_TOKEN)
merged = PeftModel.from_pretrained(base, str(ADAPTER)).merge_and_unload()
merged.save_pretrained(str(MERGED), safe_serialization=True, max_shard_size="5GB")
AutoTokenizer.from_pretrained(str(ADAPTER)).save_pretrained(str(MERGED))
del base, merged; gc.collect(); torch.cuda.empty_cache()
mark("merged")

if LLAMA_BUILD.poll() is None:
    mark("waiting for llama.cpp build"); LLAMA_BUILD.wait()
assert LLAMA_BUILD.returncode == 0, open(WORK / "llama_build.log").read()[-3000:]
F16 = WORK / f"{RUN_NAME}-F16.gguf"
sh(f"{sys.executable} {LLAMA}/convert_hf_to_gguf.py {MERGED} --outtype f16 --outfile {F16}")
GGUFS = []
for q in QUANTS:
    out = WORK / f"{RUN_NAME}-{q}.gguf"
    sh(f"{LLAMA}/build/bin/llama-quantize {F16} {out} {q}")
    GGUFS.append(out)
F16.unlink(); shutil.rmtree(MERGED, ignore_errors=True)
mark("GGUF: " + ", ".join(f"{g.name} {g.stat().st_size / 1e9:.2f} GB" for g in GGUFS))

# %%
# 13. Publish GGUF files and the model card
b, ft = EVAL["base"], EVAL["fine_tuned"]
card = f"""---
license: apache-2.0
base_model: {BASE_MODEL}
tags: [mars, nasa-space-apps, neuronexus, gguf, lora]
language: [en]
---
# {RUN_NAME}

MARS INTELLIGENCE voice model for **NeuroNexus Martian Map** (NASA Space Apps 2026): a LoRA fine-tune of
`{BASE_MODEL}` that answers from a CONTEXT block like a flight controller, cites a source tag for every number,
says n/a for missing data and uses only planning statuses (WITHIN PLANNING LIMITS / REVIEW REQUIRED / EXCEEDS
PLANNING LIMIT). **Planning limits are not safety limits; this is a screening assistant, not a safety system.**

## Files
- `adapter/`: LoRA adapter (r={LORA_R})
- {", ".join(f"`{g.name}`" for g in GGUFS)}: llama.cpp GGUF

## Data
{len(train_rows)} train / {len(eval_rows)} held-out rows (held out by site), built by
`training/build_sft_dataset.py` from the repo's NASA/USGS data: MSL RAD RDR dose summaries, MOLA terrain,
USGS/IAU gazetteer, REMS/MEDA outreach weather, THEMIS, the source ledger and the UI command catalogue.
Route-status rows use planner-output scenarios (labeled in each row's meta). Answers are template-written from
the context, so every number is copied from it.

## Eval (held-out, n={EVAL["n"]}, greedy)
| metric | base | fine-tuned |
|---|---|---|
| all guards pass | {b["pass_rate"]} | {ft["pass_rate"]} |
| numbers grounded in context | {b["grounded_number_rate"]} | {ft["grounded_number_rate"]} |
| uses a banned safety term | {b["banned_term_rate"]} | {ft["banned_term_rate"]} |
| flags missing data | {b["missing_flagged_rate"]} | {ft["missing_flagged_rate"]} |
| mean answer length (chars) | {b["mean_chars"]} | {ft["mean_chars"]} |

Trained {EVAL["train_steps"]} steps in {EVAL["train_minutes"]} min on {PLATFORM}.

## Use
```bash
llama-server -hf {MODEL_REPO}:{QUANTS[0]} --jinja -c 4096
```
Send the system prompt from `system_prompt.txt` and put facts in the user turn as `CONTEXT:` then `QUESTION:`.
Pass `chat_template_kwargs: {{"enable_thinking": false}}`.

## Limitations
Learns style and rules, not Mars facts: without a CONTEXT block it can still be wrong. The router in the app
checks every answer with the same guards and falls back to Gemini tool calling when a check fails.
"""
(WORK / "README.md").write_text(card)
(WORK / "system_prompt.txt").write_text(SYSTEM + "\n")
for p in [WORK / "README.md", WORK / "system_prompt.txt", *GGUFS]:
    upload_file(path_or_fileobj=str(p), path_in_repo=p.name, repo_id=MODEL_REPO, token=HF_TOKEN)
mark(f"published https://huggingface.co/{MODEL_REPO}")

# %%
# 14. Inference on Hugging Face: a Docker Space running llama.cpp's OpenAI-compatible server
# A 4B Q4_K_M on free cpu-basic is usable for chat (a few tokens/s). This is the always-on model.
SPACE = WORK / "space"; SPACE.mkdir(exist_ok=True)
(SPACE / "Dockerfile").write_text(f"""FROM ghcr.io/ggml-org/llama.cpp:server
ENV HOME=/tmp LLAMA_CACHE=/tmp/llama-cache
CMD ["-hf", "{MODEL_REPO}:{QUANTS[0]}", "--jinja", "--reasoning-budget", "0", "-c", "4096", "--host", "0.0.0.0", "--port", "7860", "--alias", "neuronexus-qwen"]
""")
(SPACE / "README.md").write_text(f"""---
title: {RUN_NAME} API
sdk: docker
app_port: 7860
pinned: false
---
OpenAI-compatible endpoint for [{MODEL_REPO}](https://huggingface.co/{MODEL_REPO}): `POST /v1/chat/completions`.
""")
create_repo(SPACE_REPO, repo_type="space", space_sdk="docker", private=False, exist_ok=True, token=HF_TOKEN,
            space_hardware=SPACE_HARDWARE)
if not PUBLIC:
    api.add_space_secret(SPACE_REPO, "HF_TOKEN", HF_TOKEN)
upload_folder(repo_id=SPACE_REPO, repo_type="space", folder_path=str(SPACE), token=HF_TOKEN, commit_message="llama.cpp server")
SPACE_URL = f"https://{SPACE_REPO.replace('/', '-').replace('_', '-').lower()}.hf.space"
mark(f"Space building: https://huggingface.co/spaces/{SPACE_REPO}  endpoint: {SPACE_URL}/v1/chat/completions")

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
# 16. Live API call 2: the Hugging Face Space endpoint (waits for the build)
from huggingface_hub import get_space_runtime
deadline = time.time() + SPACE_WAIT_MIN * 60
stage = None
while time.time() < deadline:
    stage = get_space_runtime(SPACE_REPO, token=HF_TOKEN).stage
    if stage in ("RUNNING", "BUILD_ERROR", "RUNTIME_ERROR"): break
    time.sleep(20)
print("Space stage:", stage)
SPACE_OK = False
if stage == "RUNNING":
    try:
        ans, sec = ask_qwen(SPACE_URL, ctx_of(demo), "Give me the dose picture for the EVA.", timeout=600,
                            token=None if PUBLIC else HF_TOKEN)
        SPACE_OK = True
        print(f"HF Space ({sec}s):\n{ans}")
    except Exception as exc:
        print("Space call failed (it may still be loading the model):", exc)
else:
    print("Space not running yet; rerun this cell later. Logs: https://huggingface.co/spaces/" + SPACE_REPO)

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
lines = ["", "## Inference and router demo", f"- Space: https://huggingface.co/spaces/{SPACE_REPO} "
         f"({'RUNNING' if SPACE_OK else 'not confirmed running at publish time'})",
         f"- Endpoint: `{SPACE_URL}/v1/chat/completions`", "",
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
