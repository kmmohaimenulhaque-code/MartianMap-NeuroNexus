"""Invariants of the MARS INTELLIGENCE SFT dataset (training/data)."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))

from filters import check, ungrounded_numbers  # noqa: E402

DATA = ROOT / "training" / "data"


def rows(name):
    return [json.loads(line) for line in (DATA / f"{name}.jsonl").open()]


def evidence(r):
    return "\n".join(m["content"] for m in r["messages"] if m["role"] in ("system", "user"))


def test_size_and_split_by_group():
    train, evals = rows("train"), rows("eval")
    assert 2800 <= len(train) <= 3300 and len(evals) >= 250
    assert not {r["meta"]["group"] for r in train} & {r["meta"]["group"] for r in evals}


def test_every_answer_passes_the_guards():
    for r in rows("train") + rows("eval"):
        assert r["messages"][0]["role"] == "system"
        for m in r["messages"]:
            if m["role"] == "assistant":
                assert check(m["content"], evidence(r))["ok"], m["content"]


def test_guard_rejects_fabrication_and_safety_calls():
    ctx = "RAD median: 7.06 uGy/h [MSL_RAD_RDR]"
    assert ungrounded_numbers("About 31.5 uGy for 4 h.", ctx) == [31.5, 4.0]
    assert "banned_safety_term" in check("The route is safe.", ctx)["violations"]
    assert "missing_not_flagged" in check("Elevation is low.", ctx, expects_missing=True)["violations"]
    assert check("Median 7.06 uGy/h [MSL_RAD_RDR].", ctx)["ok"]
