"""Paths shared by local client exports and native packaging."""

import os
from pathlib import Path


def bundled_python(resources: Path, windows: bool | None = None) -> Path:
    if windows is None:
        windows = os.name == "nt"
    return resources / ("python/python.exe" if windows else "python/bin/python3.12")
