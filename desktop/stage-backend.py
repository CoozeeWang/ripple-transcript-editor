"""Stage a clean backend using the current platform's managed Python."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def stage_backend(repo: Path, output: Path | None = None) -> Path:
    python = repo / (
        "backend/.venv/Scripts/python.exe"
        if os.name == "nt"
        else "backend/.venv/bin/python"
    )
    info = json.loads(
        subprocess.check_output(
            [
                str(python),
                "-c",
                "import json,sys,sysconfig; print(json.dumps({'base':sys.base_prefix,'packages':sysconfig.get_path('purelib'),'version':list(sys.version_info[:2])}))",
            ],
            text=True,
        )
    )
    if info["version"] != [3, 12]:
        raise ValueError("The bundled backend requires Python 3.12")
    stage = output or Path(tempfile.mkdtemp(prefix="ripple-backend-sidecar-"))
    if output:
        stage.mkdir(parents=True, exist_ok=False)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo")
    shutil.copytree(Path(info["base"]), stage / "python", ignore=ignore)
    shutil.copytree(Path(info["packages"]), stage / "site-packages", ignore=ignore)
    shutil.copytree(repo / "backend/app", stage / "backend/app", ignore=ignore)
    (stage / "mock-data").mkdir()
    for name in ("sample-transcript.json", "sample-metadata.json"):
        shutil.copy2(repo / "mock-data" / name, stage / "mock-data" / name)
    (stage / "data").mkdir()
    shutil.copy2(
        Path(__file__).with_name("verify-staged-backend.py"), stage / "verify.py"
    )
    return stage


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    print(stage_backend(Path(__file__).resolve().parents[1], args.output))
