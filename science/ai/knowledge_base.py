"""Local retrieval for Mars Intelligence.

A small, dependency-free BM25 index over:
  - curated reference notes in science/ai/knowledge/*.md (Mars science,
    missions, history, human exploration, the NeuroNexus project);
  - the project's own documentation (README, setup, deployment, sources,
    architecture docs);
  - the UI command catalogue shared with the frontend.

Documents are chunked by Markdown heading so each hit is a citable section.
To extend the assistant's knowledge, drop another Markdown file into
science/ai/knowledge/ (optional front matter: title, evidence_class, as_of,
sources) or list a repository document in PROJECT_DOCUMENTS; the index is
rebuilt automatically when any file changes.
"""

from __future__ import annotations

import json
import math
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"
UI_COMMANDS = ROOT / "frontend" / "src" / "features" / "commands.json"

PROJECT_DOCUMENTS = [
    "README.md",
    "SETUP_INSTRUCTIONS.md",
    "DEPLOYMENT.md",
    "SOURCES_MLA.md",
    "RESULTS.md",
    "docs/architecture/mission-console-v2.md",
]

MAX_CHUNK_CHARS = 2400
_TOKEN = re.compile(r"[a-z0-9]+(?:[.'][a-z0-9]+)*")
_STOP = frozenset(
    "a an and are as at be by for from has have how i in is it its of on or that the this to was were what when "
    "where which who why will with you your does do can about into than then there these those also".split()
)


@dataclass
class Chunk:
    id: str
    title: str
    section: str
    text: str
    path: str
    kind: str  # "reference" | "project" | "ui"
    evidence_class: str
    as_of: str | None = None
    sources: str | None = None
    tokens: list[str] = field(default_factory=list)


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1]


def _front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    meta = {}
    for line in text[3:end].strip().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()
    return meta, text[end + 4:]


def _split_sections(body: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, str]] = []
    heading = "Overview"
    lines: list[str] = []
    for line in body.splitlines():
        match = re.match(r"^#{1,3}\s+(.*)", line)
        if match:
            if "".join(lines).strip():
                sections.append((heading, "\n".join(lines).strip()))
            heading, lines = match.group(1).strip(), []
        else:
            lines.append(line)
    if "".join(lines).strip():
        sections.append((heading, "\n".join(lines).strip()))
    # Long sections are split on paragraph boundaries so each hit stays focused.
    out: list[tuple[str, str]] = []
    for title, text in sections:
        if len(text) <= MAX_CHUNK_CHARS:
            out.append((title, text))
            continue
        part, n = [], 1
        for paragraph in re.split(r"\n\s*\n", text):
            if sum(len(p) for p in part) + len(paragraph) > MAX_CHUNK_CHARS and part:
                out.append((f"{title} ({n})", "\n\n".join(part)))
                part, n = [], n + 1
            part.append(paragraph)
        if part:
            out.append((f"{title} ({n})" if n > 1 else title, "\n\n".join(part)))
    return out


def _markdown_chunks(path: Path, kind: str, default_class: str) -> list[Chunk]:
    meta, body = _front_matter(path.read_text(encoding="utf-8", errors="replace"))
    title = meta.get("title") or path.stem.replace("_", " ")
    rel = path.relative_to(ROOT).as_posix()
    chunks = []
    for index, (section, text) in enumerate(_split_sections(body)):
        chunks.append(Chunk(
            id=f"{rel}#{index}", title=title, section=section, text=text, path=rel, kind=kind,
            evidence_class=meta.get("evidence_class", default_class), as_of=meta.get("as_of"),
            sources=meta.get("sources"),
        ))
    return chunks


def _ui_chunks() -> list[Chunk]:
    if not UI_COMMANDS.exists():
        return []
    catalogue = json.loads(UI_COMMANDS.read_text(encoding="utf-8"))
    rel = UI_COMMANDS.relative_to(ROOT).as_posix()
    chunks = []
    for category in catalogue.get("categories", []):
        commands = [c for c in catalogue.get("commands", []) if c.get("category") == category["id"]]
        for command in commands:
            text = (
                f"{command['label']} ({category['label']}). {command.get('description', '')} "
                f"How to use: {command.get('how', 'Open the ☰ Command Index and choose it.')} "
                + (f"Keyboard shortcut: {command['shortcut']}. " if command.get("shortcut") else "")
                + (f"Where in the UI: {command['where']}." if command.get("where") else "")
            )
            chunks.append(Chunk(id=f"ui:{command['id']}", title="NeuroNexus UI command", section=command["label"],
                                text=text, path=rel, kind="ui", evidence_class="PROJECT DOCS"))
    return chunks


class KnowledgeBase:
    k1 = 1.4
    b = 0.75

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._signature: tuple | None = None
        self.chunks: list[Chunk] = []
        self._df: dict[str, int] = {}
        self._avg = 1.0

    def _files(self) -> list[tuple[Path, str, str]]:
        files = [(p, "reference", "NASA REFERENCE") for p in sorted(KNOWLEDGE_DIR.glob("*.md"))]
        files += [(ROOT / rel, "project", "PROJECT DOCS") for rel in PROJECT_DOCUMENTS if (ROOT / rel).exists()]
        return files

    def _current_signature(self) -> tuple:
        paths = [p for p, _, _ in self._files()] + ([UI_COMMANDS] if UI_COMMANDS.exists() else [])
        return tuple((str(p), p.stat().st_mtime_ns) for p in paths)

    def ensure(self) -> None:
        signature = self._current_signature()
        with self._lock:
            if signature == self._signature:
                return
            chunks: list[Chunk] = []
            for path, kind, default_class in self._files():
                chunks.extend(_markdown_chunks(path, kind, default_class))
            chunks.extend(_ui_chunks())
            df: dict[str, int] = {}
            for chunk in chunks:
                chunk.tokens = tokenize(f"{chunk.title} {chunk.section} {chunk.section} {chunk.text}")
                for token in set(chunk.tokens):
                    df[token] = df.get(token, 0) + 1
            self.chunks, self._df = chunks, df
            self._avg = (sum(len(c.tokens) for c in chunks) / len(chunks)) if chunks else 1.0
            self._signature = signature

    def search(self, query: str, *, k: int = 5, kinds: tuple[str, ...] | None = None) -> list[dict[str, Any]]:
        self.ensure()
        terms = tokenize(query)
        if not terms:
            return []
        n = len(self.chunks)
        scored = []
        for chunk in self.chunks:
            if kinds and chunk.kind not in kinds:
                continue
            counts: dict[str, int] = {}
            for token in chunk.tokens:
                counts[token] = counts.get(token, 0) + 1
            score = 0.0
            for term in terms:
                tf = counts.get(term)
                if not tf:
                    continue
                idf = math.log(1 + (n - self._df.get(term, 0) + 0.5) / (self._df.get(term, 0) + 0.5))
                score += idf * tf * (self.k1 + 1) / (tf + self.k1 * (1 - self.b + self.b * len(chunk.tokens) / self._avg))
            if score > 0:
                scored.append((score, chunk))
        scored.sort(key=lambda item: -item[0])
        return [
            {"title": c.title, "section": c.section, "text": c.text, "path": c.path, "kind": c.kind,
             "evidence_class": c.evidence_class, "as_of": c.as_of, "sources": c.sources, "score": round(s, 3)}
            for s, c in scored[:k]
        ]

    def stats(self) -> dict[str, Any]:
        self.ensure()
        by_kind: dict[str, int] = {}
        for chunk in self.chunks:
            by_kind[chunk.kind] = by_kind.get(chunk.kind, 0) + 1
        return {"chunks": len(self.chunks), "by_kind": by_kind,
                "documents": sorted({c.path for c in self.chunks})}


KNOWLEDGE = KnowledgeBase()
