"""Shared transcription-provider HTTP errors for current and compatibility routes."""
from fastapi import HTTPException

from .providers.base import ProviderError


def provider_http_error(error: ProviderError) -> HTTPException:
    """把引擎的失败包成结构化 4xx/5xx。

    detail 里带 code（前端据它选文案和动作）与 raw（服务商英文原文，供复制排查），
    不再把英文原话直接丢给用户。
    """
    status_code = error.status_code if 400 <= error.status_code < 500 else 502
    return HTTPException(
        status_code=status_code,
        detail={"message": str(error), "code": error.code, "raw": error.raw},
    )
