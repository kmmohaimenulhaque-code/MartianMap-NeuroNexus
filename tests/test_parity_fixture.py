"""The worker parity fixture matches the backend formulas as they are now."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_parity_fixture_is_current():
    result = subprocess.run([sys.executable, str(ROOT / "tools/gen_parity_fixture.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
