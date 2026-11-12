"""Load, validate and serve the canonical source ledger; resolve ids and aliases."""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEDGER_PATH = ROOT / "data" / "manifests" / "source_ledger.json"
SCHEMA_PATH = ROOT / "data" / "manifests" / "source_ledger.schema.json"
SCHEMA = "neuronexus.source-ledger.v3"


@lru_cache(maxsize=1)
def load() -> dict:
    return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))


def sha256() -> str:
    return hashlib.sha256(LEDGER_PATH.read_bytes()).hexdigest()


@lru_cache(maxsize=1)
def index() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for entry in load()["entries"]:
        for key in [entry["id"], *entry["aliases"]]:
            out[key] = entry
            out[key.upper()] = entry
    return out


def resolve(ledger_id: str) -> dict | None:
    return index().get(ledger_id) or index().get(str(ledger_id).upper())


def validate(ledger: dict | None = None) -> list[str]:
    """Schema validation plus cross-entry rules. Returns a list of problems (empty when valid)."""
    import jsonschema

    ledger = load() if ledger is None else ledger
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    problems = [f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message}"
                for e in jsonschema.Draft202012Validator(schema).iter_errors(ledger)]
    seen: dict[str, str] = {}
    for entry in ledger.get("entries", []):
        for key in [entry.get("id", ""), *entry.get("aliases", [])]:
            norm = key.upper()
            if norm in seen and seen[norm] != entry.get("id"):  # case variants of one entry's own id are fine
                problems.append(f"duplicate id or alias {key!r} ({seen[norm]} and {entry.get('id')})")
            seen[norm] = entry.get("id", "")
    return problems


def short_label(entry: dict) -> str:
    """Compact text for a source tag, e.g. 'MRO HiRISE' or 'NASA Ames MGCM'."""
    return entry.get("instrument") or entry["product_title"].split("(")[0].strip()[:40]


def source_ref(ledger_id: str, **basis) -> dict:
    """The {"ledger_id", ...} block every API value carries; raises if the id is unregistered."""
    entry = resolve(ledger_id)
    if entry is None:
        raise KeyError(f"unregistered source: {ledger_id}")
    return {"ledger_id": entry["id"], **{k: v for k, v in basis.items() if v is not None}}
