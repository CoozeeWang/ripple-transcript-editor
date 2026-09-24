"""Separate bundled application code from mutable local data."""

import os
from pathlib import Path

CODE_ROOT = Path(__file__).resolve().parents[2]
_configured_data_root = os.environ.get("RIPPLE_DATA_DIR")
if _configured_data_root:
    _requested = Path(_configured_data_root).expanduser()
    if not _requested.is_absolute():
        raise ValueError("RIPPLE_DATA_DIR must be an absolute path")
    DATA_ROOT = _requested.resolve()
else:
    DATA_ROOT = CODE_ROOT
