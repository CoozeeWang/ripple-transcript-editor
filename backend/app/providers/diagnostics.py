"""引擎调用的诊断日志：把「哪个引擎、传了多少、等了多久、结果如何」写进 .logs/backend.log。

为什么单独有这么一个文件：2026-09-14 前后出现过几次 `POST /api/transcribe` 502，
后端没有落下任何 ProviderError 记录 —— 事后既不知道是哪个引擎、哪个错误码，也不知道
等了多久才失败，只能靠用户复现一次。而引擎调用恰恰是本应用唯一会长时间挂住的地方
（大文件上传 + 同步接口等结果），所以必须留痕。

launcher（scripts/launcher.mjs）已经把后端的 stdout / stderr 一并重定向到
.logs/backend.log，所以这里直接用标准 logging 即可，不需要自己开文件。
"""

from __future__ import annotations

import json
import logging
import time
import traceback
from collections.abc import Iterator
from contextlib import contextmanager

from .base import ProviderError

LOGGER_NAME = "ripple.providers"

# 只在 root 还没有 handler 时生效（uvicorn 只配置自己的 logger，不动 root），
# 这样无论进程被谁拉起，我们的日志都有时间戳并且能落到 .logs/backend.log。
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

logger = logging.getLogger(LOGGER_NAME)


def human_bytes(size: int) -> str:
    """日志里的体积写法：23.5MB / 340KB。"""
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.1f}MB"
    if size >= 1024:
        return f"{size / 1024:.0f}KB"
    return f"{size}B"


def _event(level, event, provider, action, started, *, code=None, error=None):
    record = {"event": event, "provider": provider, "action": action,
              "elapsed_ms": round((time.monotonic() - started) * 1000)}
    if code:
        record["code"] = code
    if error:
        record["exception"] = type(error).__name__
        # Frame coordinates suffice for diagnosis without logging exception bodies,
        # source lines, credentials, audio filenames or manuscript contents.
        record["traceback"] = [{"file": frame.filename.rsplit("/", 1)[-1], "line": frame.lineno,
                                "function": frame.name} for frame in traceback.extract_tb(error.__traceback__)]
    logger.log(level, json.dumps(record, ensure_ascii=True))


@contextmanager
def provider_call(provider_id: str, action: str, detail: str = "") -> Iterator[None]:
    """Language-neutral lifecycle records; detail is retained only for call compatibility."""
    started = time.monotonic()
    _event(logging.INFO, "provider_started", provider_id, action, started)
    try:
        yield
    except ProviderError as error:
        _event(logging.WARNING, "provider_failed", provider_id, action, started, code=error.code, error=error)
        raise
    except Exception as error:
        _event(logging.WARNING, "provider_failed", provider_id, action, started, code="internal_error", error=error)
        raise
    else:
        _event(logging.INFO, "provider_completed", provider_id, action, started)
