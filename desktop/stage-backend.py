"""Stage a credential-free Python backend for a local packaging feasibility check."""

import shutil
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VENV_PYTHON = REPO / "backend/.venv/bin/python"
BASE = Path(subprocess.check_output(
    [VENV_PYTHON, "-c", "import sys; print(sys.base_prefix)"], text=True,
).strip())
STAGE = Path(tempfile.mkdtemp(prefix="ripple-backend-sidecar-"))

shutil.copytree(BASE, STAGE / "python")
shutil.copytree(REPO / "backend/.venv/lib/python3.12/site-packages", STAGE / "site-packages")
shutil.copytree(REPO / "backend/app", STAGE / "backend/app",
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
(STAGE / "mock-data").mkdir()
for name in ("sample-transcript.json", "sample-metadata.json"):
    shutil.copy2(REPO / "mock-data" / name, STAGE / "mock-data" / name)
(STAGE / "data").mkdir()
shutil.copy2(Path(__file__).with_name("verify-staged-backend.py"), STAGE / "verify.py")
print(STAGE)
