# MARS INTELLIGENCE fine-tune (Qwen3 voice + Gemini tools)

| File | What |
|---|---|
| `data/train.jsonl`, `data/eval.jsonl` | 3,062 train / 333 held-out chat rows (held out by site). `stats.json` has the mix. |
| `build_sft_dataset.py` | Rebuilds the data from the repo's NASA/USGS files. Deterministic (seed 2026). |
| `filters.py` | Answer guards: grounded numbers, no "safe", status terms, n/a on missing data, American spelling. |
| `qwen3_14b_mi300x.ipynb` / `.py` | Qwen3-14B, bf16 LoRA on AMD MI300X, about 50 to 70 minutes end to end (estimate). |
| `qwen3_4b_kaggle.ipynb` / `.py` | Qwen3-4B-Instruct-2507, QLoRA with Unsloth on a Kaggle T4. Also runs on Colab. |
| `make_notebooks.py` | Generates both notebooks from one cell list. Edit this, not the notebooks. |

## Run
1. Secrets: `HF_TOKEN` (write), optional `GEMINI_API_KEY`, optional `HF_USER`.
   MI300X: environment variables. Kaggle: Add-ons > Secrets. Colab: the key icon.
2. MI300X: use a ROCm PyTorch image, then `python training/qwen3_14b_mi300x.py` (or open the notebook).
   Training runs to the end (set `TRAIN_BUDGET_MIN` to a number of minutes to cap it).
3. Kaggle: upload `qwen3_4b_kaggle.ipynb`, Accelerator GPU T4, Internet on, then Save Version > Run All.
4. Each run publishes `<user>/<run>` (adapter, GGUF, eval, card) and a Docker Space `<user>/<run>-api`
   serving llama.cpp's OpenAI-compatible `/v1/chat/completions`, then calls it live and runs the router demo.

## Data
Every fact in a CONTEXT block comes from repo data; answers are template-written from it, so every number in an
answer appears in its context with a ledger tag. Route-status rows use planner-output scenarios (meta.scenario
= "planner_output"). No Gemini outputs are used as training data.
