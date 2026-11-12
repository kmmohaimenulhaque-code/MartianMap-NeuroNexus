from pathlib import Path
import hashlib
import json
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]

DATA_ROOTS = [
    ROOT / "data/raw/mola/meg128/topography",
    ROOT / "data/raw/mola/polar512/north",
    ROOT / "data/raw/mola/polar512/south",
]

OUTPUT = ROOT / "data/manifests/checksums.json"


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as f:
        while chunk := f.read(chunk_size):
            digest.update(chunk)

    return digest.hexdigest()


files = []

for root in DATA_ROOTS:
    if not root.exists():
        continue

    for path in sorted(root.rglob("*")):
        if path.is_file():
            relative = path.relative_to(ROOT)

            print(f"Hashing: {relative}")

            files.append({
                "path": str(relative),
                "size_bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            })


manifest = {
    "project": "NeuroNexus",
    "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    "algorithm": "SHA-256",
    "files": files,
}

with OUTPUT.open("w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)

print()
print("=" * 70)
print(f"Files hashed : {len(files)}")
print(f"Manifest     : {OUTPUT}")
print("✅ SHA-256 MANIFEST CREATED")
