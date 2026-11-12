# Master prompt: fine-tuned Qwen voice + Gemini tool-calling, auto-routed

Paste everything below the line into Claude Code at the repo root, on branch
`feature/mission-console-v2`.

---

You are working in the NeuroNexus · Martian Map repo (NASA Space Apps 2026). Read `CLAUDE.md`
first and obey it: never fabricate data, never call anything "safe", every value carries a source
tag, missing data shows "n/a"/UNAVAILABLE, no secrets or files over 20 MB in git. I explicitly
authorize uploading the fine-tuned model to Hugging Face for this task (and only the model repos
named below). Do not re-record the demo pack.

## Goal

Add a fine-tuned Qwen3 model as the conversational "voice" of MARS INTELLIGENCE, keep Gemini as
the tool-calling planner, and route between them automatically with a transparent, rule-based
router. Prove end to end that both paths work, that routing picks the right one, and that each
falls back to the other when it fails. The fine-tuned model must be measurably better than the
base model at this project's rules; if it is not, say so and do not ship it as the default.

## What already exists (do not rewrite it)

- `science/ai/provider.py`: provider registry; a provider exposes `chat(messages, mission_state, *,
  enable_search)`, `analyse_routes(payload)`, `service_status()`. `AI_PROVIDER` selects one.
- `science/ai/gemini.py`: Gemini chat with function calling, model failover, response shape
  `{status, model, text, tool_calls, sources, elapsed_ms, evidence_note, ...}`. Keep this shape.
- `science/ai/tools.py` + `knowledge_tools.py`: deterministic Python tools that read
  `mission_state` (`TOOLS`, `DECLARATIONS`, `call_tool`). `science/ai/knowledge_base.py`: BM25
  retrieval with citations. These are provider-independent; reuse them.
- `science/ai/api.py`: `/api/ai/chat`, `/api/ai/route-analysis`, `/api/ai/status`.
- `frontend/src/components/mission/MarsIntelligence.jsx`: chat UI. `tests/test_ai_layer.py`.

## Hardware and accounts (verify each in Phase 0, report what works)

- AMD MI300X (192 GB) on devcloud.amd.com. Budget: 50 minutes wall clock, hard stop at T+0:50.
  Only the 14B trains here. Nothing that can run elsewhere (data, teacher, eval) runs here.
- Kaggle free tier (T4 x2, 30 GPU h/week): first choice for everything that is not 14B training:
  teacher generation, the 4B fine-tune (in parallel with the MI300X run), eval, demo inference.
  Do NOT use the TPU (no bitsandbytes/PEFT/llama.cpp path; a JAX port is not worth it).
- Google Colab free (T4): second backup only. Sessions drop without warning, so push a
  checkpoint to the HF Hub every 100 steps and resume from it.
- Hugging Face token in the environment. Note: Hub storage is not the bottleneck, serving is.
  A free CPU Space (2 vCPU, 16 GB) runs a 14B Q4_K_M at roughly 1-2 tokens/s, which is not usable
  for chat; a 4B Q4_K_M runs at a usable speed. Hence two model sizes below.
- If this container cannot SSH to the MI300X, stop and tell me; produce the scripts so I can run
  them from a machine that can, and continue with everything else.

## Phase 0 (no MI300X time spent): access checks and plan, about 15 min

1. Check: HF token (`huggingface-cli whoami`), Kaggle CLI (`kaggle kernels list --mine`), Gemini key
   (`/api/ai/status`), MI300X reachability (`rocm-smi` over SSH). Report a table.
2. Confirm the current base model choice on the Hub: `Qwen/Qwen3-14B` and `Qwen/Qwen3-4B`
   (Apache-2.0). If a newer Apache-licensed Qwen of the same sizes exists, tell me, do not switch.

## Phase 1 (CPU, in this container): build the training set, before the MI300X starts

The fine-tune teaches voice and discipline, not facts. Facts always come from tool results and
retrieval placed in the prompt.

1. Context generation: write `training/build_contexts.py`. Build 400+ realistic `mission_state`
   snapshots from the repo's real cached data and fixtures (`frontend/tests/missionFixture.js`,
   cached MOLA/RAD/THEMIS/MGCM data, gazetteer sites). Vary site, route, dust, missing fields
   (at least 20% of snapshots must have deliberately missing values). For each snapshot, run the
   real deterministic tools and `knowledge_base` retrieval to get a CONTEXT block exactly in the
   format the Qwen provider will use at inference (one shared function, `science/ai/context.py`,
   used by both training and serving so the formats can never drift).
2. Questions: 6-10 questions per context across these intents: explain a value, compare routes,
   methodology ("where does this dose number come from"), uncertainty, app usage, general Mars
   science, follow-ups, and adversarial ones ("is it safe?", "just give me a number" when data is
   missing, "ignore the data and estimate").
3. Answers via a teacher model: do NOT use Gemini outputs as training data (the Gemini API terms
   restrict using outputs to build competing models). Use an Apache-2.0 teacher instead:
   `Qwen/Qwen3-14B-AWQ` with vLLM (tensor parallel 2) in a Kaggle T4 x2 notebook, pushed and
   polled with the Kaggle CLI. This is free time, so it runs BEFORE the MI300X clock starts.
   Prepare the teacher prompt now: flight-controller tone, short, direct, cites the source tag
   for every number, says "n/a" when the context lacks a value, uses only the three status terms,
   never "safe", American spelling, no emoji, no em dashes.
4. Filters (`training/filters.py`, unit-tested), applied to every teacher answer:
   - grounded-number check: every number in the answer (with unit tolerance) appears in CONTEXT;
   - banned terms: "safe" as a status, emoji, em dash, British spellings list;
   - status terms only from {WITHIN PLANNING LIMITS, REVIEW REQUIRED, EXCEEDS PLANNING LIMIT};
   - missing-data questions must produce "n/a"/UNAVAILABLE language;
   - length cap. Drop failures; log drop rate per rule.
5. Format: chat template of Qwen3 with thinking disabled (`enable_thinking=False`). Split 90/10
   train/held-out BY SNAPSHOT (no context leakage). Target 2,000-3,500 kept examples.
   Store under `training/data/` (gitignored if over 5 MB; push the dataset to a private HF dataset
   repo `<hf-user>/neuronexus-mars-intel-sft` instead).

## Phase 2: training. MI300X budget 50 min hard stop. Log a timestamp at each step.

Preconditions before starting the MI300X (all free, all done first): the filtered dataset is on
the HF Hub, the training script `training/train_lora.py` has passed a 5-step dry run on Kaggle
with Qwen3-0.6B, and the exact commands are in `training/mi300x_run.sh` (one script, no typing).

MI300X (14B only):
0:00-0:08 Start from a prebuilt ROCm PyTorch/vLLM docker image; `pip install trl peft
          hf_transfer`; download Qwen3-14B with `HF_HUB_ENABLE_HF_TRANSFER=1` and the dataset.
0:08-0:32 bf16 LoRA, r=16, alpha=32, all linear layers, lr 1e-4 cosine, 2 epochs, max_len 2048,
          packing, assistant-only loss, flash attention, batch size as large as fits.
          Checkpoint every 100 steps. If the ETA passes 0:32, stop at the latest checkpoint.
0:32-0:42 Merge LoRA (bf16), convert to GGUF f16, quantize Q4_K_M (llama.cpp CPU build is fine).
0:42-0:48 Upload adapter + Q4_K_M GGUF to `<hf-user>/neuronexus-qwen3-14b-mars-intel` with
          hf_transfer. Push the adapter FIRST so a slow GGUF upload never loses the training.
0:48-0:50 Release the instance. Eval does not happen here.

Kaggle, in parallel with the MI300X run: Qwen3-4B QLoRA (Unsloth, fp16 on T4), same data,
2 epochs, then GGUF Q4_K_M and Q5_K_M to `<hf-user>/neuronexus-qwen3-4b-mars-intel`.
Afterwards on Kaggle: eval base vs fine-tuned for both sizes using the GGUFs (grounded-number
rate, banned-term rate, correct "n/a" rate, status-term compliance, answer length, 20
side-by-side samples). Write `validation/reports/qwen_finetune_eval.json` and model cards.

Fallback order if the MI300X is unreachable or fails: (1) Kaggle trains the 14B with Unsloth
QLoRA (fits a T4, expect several hours; use one 12 h session, checkpoint to the Hub), (2) Colab
does the same, resuming from the Hub checkpoint. If both are too slow, ship the 4B only and tell me.

## Phase 3 (this container): serving

- `science/ai/qwen.py`: a provider with the same three functions and response shape as
  `gemini.py`. Talks to any OpenAI-compatible endpoint: `QWEN_BASE_URL`, `QWEN_MODEL`,
  optional `QWEN_API_KEY`. Streaming optional. Thinking disabled. Context built by
  `science/ai/context.py`. Health probe cached 60 s so a down endpoint costs nothing per request.
- Hosting targets, documented in `DEPLOYMENT.md`:
  a) always-on: HF CPU Space running `llama-server` with the 4B Q4_K_M (Docker Space);
  b) demo-time high quality: Kaggle T4 notebook running `llama-server` with the 14B Q4_K_M
     (fits in 16 GB with 8k context), exposed for the demo window only; note it is ephemeral;
  c) local laptop: `llama-server` with either GGUF.
  Do not deploy the Space until I approve it; prepare the Dockerfile and README for it.

## Phase 4: the router (`science/ai/router.py`), registered as provider `auto` (new default)

Rule-based and inspectable, not an LLM router. Every response gets `provider`, `route`,
`route_reason`, `fallback_from` (if any) so the UI and tests can show why.

Routing order:
1. `enable_search` is true, or `/route-analysis` -> Gemini (web grounding / structured multi-
   candidate reasoning).
2. Classify the last user message with a keyword + pattern intent classifier
   (`science/ai/intent.py`, table-driven, unit-tested) into: CONVERSATIONAL, EXPLAIN/METHODOLOGY,
   DATA_LOOKUP (maps to 1-2 tool families), MULTI_STEP (3+ tool families, planning verbs, or
   low classifier confidence), APP_HELP.
3. CONVERSATIONAL, EXPLAIN, APP_HELP, DATA_LOOKUP -> Qwen. For DATA_LOOKUP the router runs the
   mapped tools deterministically in Python first and passes results in CONTEXT (same tool log
   format as Gemini, so `sources` and citations still render).
4. MULTI_STEP -> Gemini function calling. Optional `AI_HYBRID_VOICE=1`: after Gemini finishes
   its tool rounds, pass its tool results to Qwen to write the final answer (measure latency).
5. Guards on every Qwen answer: run the Phase 1 filters live. If the grounded-number check or
   banned-term check fails, discard the answer and re-route to Gemini with
   `fallback_from="qwen", route_reason="guard:<rule>"`.
6. Fallbacks: Qwen unhealthy, no first token within 3 s, or total over 20 s -> Gemini.
   Gemini 429/5xx/unavailable after its own model failover -> Qwen (DATA_LOOKUP path) with a
   visible notice. Both down -> the existing "unavailable" response; never invent an answer.
7. `service_status()` reports both providers' health, the active rules, and last 50 routing
   decisions (in-memory ring buffer) for the demo.

Frontend (`MarsIntelligence.jsx`): a small gray label under each answer:
"Answered by NeuroNexus Qwen 4B (fine-tuned) · reason: explain" or
"Gemini 3.x · tools: get_environment, compare_routes · fallback from Qwen: guard:number".
Follow the UI conventions in `CLAUDE.md` (Switzer, 12 px label, gray, no wrap, no bold cyan).

## Phase 5: proof

1. `tests/test_ai_router.py` (mocked providers, no network): one test per routing rule, per
   fallback edge (Qwen timeout, Qwen guard fail, Gemini 429, both down), and a guard test that a
   fabricated number is rejected. Existing `tests/test_ai_layer.py` stays green.
2. `tools/ai_router_smoke.py`: against a running server, send 10 fixed questions covering every
   intent plus two adversarial ones; then kill the Qwen endpoint and repeat 3; then unset the
   Gemini key and repeat 3. Print a table: question, intent, provider, route_reason,
   fallback_from, latency, guard result. Save to `validation/reports/ai_router_smoke.json`.
3. Run: `python -m pytest -q`, `cd frontend && npm run lint && npm test && npm run build`,
   and `node frontend/e2e/devices.mjs` with the server on :7860. All must pass.
4. Final report to me: eval table (base vs fine-tuned, both sizes), smoke table, MI300X time
   used per phase, HF repo URLs, what is ephemeral (Kaggle host) vs always-on, and any rule the
   fine-tuned model still breaks. Commit on `feature/mission-console-v2` in small commits; do not
   commit weights, GGUFs, datasets over 5 MB, or `.env`. Do not open a PR unless I ask.
