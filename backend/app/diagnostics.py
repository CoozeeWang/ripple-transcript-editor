"""Bounded, content-free diagnostic records. Never export raw development logs."""
import json
import os
import re
import tempfile
import threading
import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter

from .runtime_paths import DATA_ROOT

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])
LOG_PATH = DATA_ROOT / ".logs" / "diagnostics.json"
MAX_RECORDS = 100
RETENTION_SECONDS = 7 * 86400
_lock = threading.RLock()
_cache = []
_storage_available = True
FAILURE_REASONS = {"permission", "rate_limit", "upstream_http", "output_limit", "connect_timeout", "read_timeout", "write_timeout", "pool_timeout", "timeout", "proxy", "connect", "connection_lost", "write", "network", "format"}
OPERATIONS = {"transcription", "editing", "engine", "open", "save", "service"}


def _clean(rows):
    if not isinstance(rows, list):
        return []
    result = []
    for row in rows[-MAX_RECORDS:]:
        if not isinstance(row, dict):
            continue
        try:
            stamp = datetime.fromisoformat(row["time"]).timestamp()
            identifier = str(uuid.UUID(row["id"]))
            if (row["operation"] not in OPERATIONS or type(row["status"]) is not int
                    or not 400 <= row["status"] <= 599
                    or not time.time() - RETENTION_SECONDS <= stamp <= time.time() + 60):
                continue
            result.append({"id": identifier, "time": datetime.fromtimestamp(stamp, UTC).isoformat(),
                           "operation": row["operation"], "status": row["status"],
                           **({"reason": row["reason"]} if row.get("reason") in FAILURE_REASONS else {}),
                           **({"code": row["code"]} if isinstance(row.get("code"), str) and re.fullmatch(r"[a-z0-9_]{1,80}", row["code"]) else {})})
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    return result


def _persist():
    global _storage_available
    temporary = None
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=LOG_PATH.parent,
                                         delete=False) as file:
            temporary = file.name
            json.dump(_cache, file, ensure_ascii=False)
        os.replace(temporary, LOG_PATH)
        _storage_available = True
    except OSError:
        _storage_available = False
    finally:
        if temporary and os.path.exists(temporary):
            try:
                os.unlink(temporary)
            except OSError:
                pass


def recent_problems():
    global _cache, _storage_available
    with _lock:
        if not _storage_available:
            return _clean(_cache)
        try:
            if LOG_PATH.exists():
                if LOG_PATH.stat().st_size > 65536:
                    raise ValueError("oversized diagnostic file")
                rows = json.loads(LOG_PATH.read_text(encoding="utf-8"))
                _cache = _clean(rows)
                if rows != _cache:
                    _persist()
        except (OSError, ValueError):
            _storage_available = False
        return _clean(_cache)


def record_failure(operation: str, status: int, reason: str | None = None, code: str | None = None):
    global _cache
    if operation not in OPERATIONS or not 400 <= status <= 599:
        return
    with _lock:
        _cache = (recent_problems() + [{"id": str(uuid.uuid4()), "time": datetime.now(UTC).isoformat(),
                                      "operation": operation, "status": status, **({"code": code} if isinstance(code, str) and re.fullmatch(r"[a-z0-9_]{1,80}", code) else {}), **({"reason": reason} if reason in FAILURE_REASONS else {})}])[-MAX_RECORDS:]
        _persist()


@router.get("")
def diagnostics():
    records = recent_problems()
    return {"version": "0.1.0", "records": records, "storageAvailable": _storage_available}


def request_operation(route: str):
    # Use the matched route template only, never request paths or query strings.
    if "transcribe" in route:
        return "transcription"
    if route.startswith("/api/ai/"):
        return "engine" if "/providers" in route or route.endswith("/config") else "editing"
    if "/credentials" in route or "/providers" in route:
        return "engine"
    return "service"
