"""Run every isolated SQLite regression from a consistent repository directory."""
from pathlib import Path
import subprocess
import sys

TEST_DIR = Path(__file__).resolve().parent
REPO_ROOT = TEST_DIR.parent.parent
checks = sorted({*TEST_DIR.glob("*.test.py"), *TEST_DIR.glob("*-check.py")})
if not checks:
    raise SystemExit("No SQLite checks found")
failed = []
for check in checks:
    print(f"SQL check: {check.name}", flush=True)
    result = subprocess.run([sys.executable, str(check)], cwd=REPO_ROOT)
    if result.returncode:
        failed.append(check.name)
print(f"SQLite checks: {len(checks) - len(failed)}/{len(checks)} passed", flush=True)
if failed:
    raise SystemExit("Failed SQLite checks: " + ", ".join(failed))
