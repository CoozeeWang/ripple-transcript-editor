"""The bundled backend must keep mutable data outside its code directory."""

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_data_root_override_writes_credentials_outside_code(tmp_path):
    env = {**os.environ, "RIPPLE_DATA_DIR": str(tmp_path)}
    code = "from app.settings import save_credentials; save_credentials('probe', {'api_key': 'fixture-only'})"
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND, env=env, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert (tmp_path / ".env").read_text(encoding="utf-8") == "PROBE_API_KEY=fixture-only\n"


def test_data_root_override_requires_absolute_path():
    env = {**os.environ, "RIPPLE_DATA_DIR": "relative-data"}
    result = subprocess.run(
        [sys.executable, "-c", "import app.runtime_paths"],
        cwd=BACKEND, env=env, capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0
    assert "RIPPLE_DATA_DIR must be an absolute path" in result.stderr
