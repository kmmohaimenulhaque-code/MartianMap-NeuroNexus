from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# MOLA MEGDR global 128 ppd tiles:
# 44 degrees latitude × 90 degrees longitude
# 128 pixels/degree
# 5632 × 11520 signed 16-bit samples
MEG128_ROWS = 5632
MEG128_COLS = 11520
MEG128_BYTES = MEG128_ROWS * MEG128_COLS * 2

# MOLA polar 512 ppd:
# 12288 × 12288 signed 16-bit samples
MEG512_SIZE = 12288
MEG512_BYTES = MEG512_SIZE * MEG512_SIZE * 2

checks = []


def check_file(path: Path, expected_size: int):
    exists = path.exists()
    size = path.stat().st_size if exists else 0
    ok = exists and size == expected_size

    checks.append(ok)

    print(f"{'🟢' if ok else '🔴'} {path}")
    print(f"   exists   : {exists}")
    print(f"   size     : {size:,}")
    print(f"   expected : {expected_size:,}")
    print(f"   valid    : {ok}")
    print()


# ============================================================
# GLOBAL MEG128
# ============================================================

topography_128 = ROOT / "data/raw/mola/meg128/topography"

for path in sorted(topography_128.glob("*.img")):
    check_file(path, MEG128_BYTES)


# ============================================================
# POLAR MEG512
# ============================================================

polar_files = [
    ROOT / "data/raw/mola/polar512/north/megt_n_512_1.img",
    ROOT / "data/raw/mola/polar512/south/megt_s_512_1.img",
]

for path in polar_files:
    check_file(path, MEG512_BYTES)


# ============================================================
# SUMMARY
# ============================================================

print("=" * 70)

total = len(checks)
passed = sum(checks)

print(f"Checks passed: {passed}/{total}")

if passed != total:
    raise SystemExit("❌ MOLA validation FAILED")

print("✅ ALL MOLA BINARY FILES VALID")
