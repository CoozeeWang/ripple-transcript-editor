"""Stable UI error codes; legacy detail remains compatible with older clients.

Only catalogued fixed templates are recognized. Dynamic values are separate params,
never translated. Diagnostic logs retain codes, not provider bodies or user text.
"""
import json
import re
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name("error_catalog.json").read_text(encoding="utf-8"))
_PATTERNS = []
for _key, _entry in CATALOG.items():
    _parts = re.split(r"(\{\{v\d+\}\})", _entry["source"])
    _pattern = "".join(f"(?P<{p[2:-2]}>.*?)" if re.fullmatch(r"\{\{v\d+\}\}", p) else re.escape(p) for p in _parts)
    _PATTERNS.append((_key, re.compile(_pattern, re.DOTALL)))


def identify_message(message):
    if not isinstance(message, str):
        return None, {}
    for key, pattern in _PATTERNS:
        match = pattern.fullmatch(message)
        if match:
            return f"ripple_{key}", match.groupdict()
    return None, {}


def error_fields(detail, status, category=None):
    message = detail.get("message") if isinstance(detail, dict) else detail
    message_code, params = identify_message(message)
    existing = detail.get("code") if isinstance(detail, dict) else None
    code = existing or category or message_code or ("validation_error" if status == 422 else f"http_{status}")
    return {"code": code, "message_code": message_code, "params": params}
