"""Paths shared by local client exports and native packaging."""

import os
import site
from pathlib import Path


def initialize_packages() -> None:
    # PYTHONPATH locates modules, but does not process .pth files. In a relocated
    # bundle pywin32 needs both its extra paths and its DLL bootstrap before MCP
    # imports Windows process/job support. Never scan caller-selected directories.
    packages = Path(__file__).resolve().parents[2] / "site-packages"
    if packages.is_dir():
        site.addsitedir(str(packages))


def bundled_python(resources: Path, windows: bool | None = None) -> Path:
    if windows is None:
        windows = os.name == "nt"
    return resources / ("python/python.exe" if windows else "python/bin/python3.12")
