"""引擎调用的诊断日志。

存在这个测试的原因：2026-09-14 的两次 `POST /api/transcribe` 502 事后完全无法回溯
—— 不知道是哪个引擎、哪个错误码、等了多久。所以「失败必须有日志、且日志里带够定性信息」
本身就是要守住的行为，不是实现细节。
"""

import json
import logging

import pytest

from app.providers.base import ProviderError
from app.providers.diagnostics import LOGGER_NAME, human_bytes, provider_call


def _messages(caplog: pytest.LogCaptureFixture) -> str:
    return "\n".join(record.getMessage() for record in caplog.records)


def test_failure_logs_code_elapsed_without_private_details(caplog) -> None:
    with (
        caplog.at_level(logging.INFO, logger=LOGGER_NAME),
        pytest.raises(ProviderError),
        provider_call("tencent_flash", "transcribe", "x.m4a 23.5MB"),
    ):
        raise ProviderError(
            "等腾讯云极速版返回结果超过 20 分钟。",
            code="response_timeout",
            raw="The read operation timed out",
        )

    text = _messages(caplog)
    record = json.loads(caplog.records[-1].getMessage())
    assert record["provider"] == "tencent_flash"
    assert record["traceback"]
    assert "x.m4a" not in text
    assert record["code"] == "response_timeout"
    assert "elapsed_ms" in record
    assert "The read operation timed out" not in text
    assert caplog.records[-1].levelno == logging.WARNING


def test_failure_omits_raw_key_when_absent(caplog) -> None:
    with (
        caplog.at_level(logging.INFO, logger=LOGGER_NAME),
        pytest.raises(ProviderError),
        provider_call("funasr", "transcribe"),
    ):
        raise ProviderError("音频文件是空的", code="empty_result")

    text = _messages(caplog)
    assert json.loads(caplog.records[-1].getMessage())["code"] == "empty_result"
    assert "raw=" not in text


def test_success_logs_elapsed_at_info(caplog) -> None:
    with (
        caplog.at_level(logging.INFO, logger=LOGGER_NAME),
        provider_call("tencent_cloud", "transcribe", "x.m4a 3.4MB"),
    ):
        pass

    assert caplog.records[-1].levelno == logging.INFO
    assert "provider_completed" in _messages(caplog)


def test_start_line_lands_before_the_call_finishes(caplog) -> None:
    """调用进行中也要在日志里看得见。

    只记结束那一行的话，一次卡了十几分钟的调用在日志里是彻底隐形的（2026-09-14 极速版
    那次就是这样），事后无法判断它到底跑了多久、卡在哪一段。
    """
    with (
        caplog.at_level(logging.INFO, logger=LOGGER_NAME),
        provider_call("tencent_flash", "transcribe", "x.m4a 23.5MB"),
    ):
        # 还没出 with，就应该已经有一行「开始」了
        assert "provider_started" in _messages(caplog)

    assert _messages(caplog).count("provider_started") == 1
    assert caplog.records[0].levelno == logging.INFO


def test_unexpected_exception_is_logged_then_reraised(caplog) -> None:
    """非 ProviderError 的异常同样要留痕再抛 —— 悄悄吞掉会让 500 变得不可解释。"""
    with (
        caplog.at_level(logging.INFO, logger=LOGGER_NAME),
        pytest.raises(ValueError),
        provider_call("iflytek", "transcribe"),
    ):
        raise ValueError("boom")

    text = _messages(caplog)
    assert "ValueError" in text
    assert "boom" not in text
    assert json.loads(caplog.records[-1].getMessage())["traceback"]


@pytest.mark.parametrize(
    ("size", "expected"),
    [(0, "0B"), (512, "512B"), (2048, "2KB"), (24_689_973, "23.5MB")],
)
def test_human_bytes(size: int, expected: str) -> None:
    assert human_bytes(size) == expected
