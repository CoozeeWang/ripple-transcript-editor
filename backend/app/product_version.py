"""Product identity from immutable code resources, never user data or package versions."""

import json
import re
from pathlib import Path

from .runtime_paths import CODE_ROOT


def product_version(code_root: Path = CODE_ROOT) -> str:
    for path in (
        code_root / "product-version.json",
        code_root / "desktop/src-tauri/tauri.conf.json",
    ):
        try:
            if path.stat().st_size > 65536:
                continue
            version = json.loads(path.read_text(encoding="utf-8")).get("version")
            if isinstance(version, str) and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", version):
                return version
        except (OSError, ValueError, AttributeError):
            continue
    return "unknown"


PRODUCT_VERSION = product_version()
