"""Synthetic runtime paths; no native user configuration."""

from pathlib import Path

from app.bundled_runtime import bundled_python


def test_platform_runtime_paths_preserve_unicode_and_spaces():
    root = Path("Synthetic App 空格/backend")
    assert bundled_python(root, windows=True) == root / "python/python.exe"
    assert bundled_python(root, windows=False) == root / "python/bin/python3.12"
