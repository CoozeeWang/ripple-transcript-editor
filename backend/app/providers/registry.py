"""引擎注册表。

新引擎在这里加一行即可接入；main.py 只通过 get_provider / list_providers
拿引擎，不 import 具体模块，避免每加一家就改一遍路由。
"""

from .base import ProviderError, ProviderInfo, TranscriptionProvider
from .elevenlabs import ElevenLabsProvider
from .funasr import FunASRProvider
from .iflytek_lfasr import IflytekLfasrProvider
from .iflytek_lfasr_llm import IflytekLlmProvider
from .openai_compatible import OpenAICompatibleProvider
from .tencent_cloud import TencentCloudProvider
from .tencent_cloud_url import TencentCloudUrlProvider
from .tencent_flash import TencentFlashProvider

DEFAULT_PROVIDER_ID = "elevenlabs"

_PROVIDERS: list[TranscriptionProvider] = [
    ElevenLabsProvider(),
    IflytekLfasrProvider(),
    IflytekLlmProvider(),
    OpenAICompatibleProvider(),
    FunASRProvider(),
    TencentCloudProvider(),
    TencentCloudUrlProvider(),
    TencentFlashProvider(),
]

PROVIDERS: dict[str, TranscriptionProvider] = {provider.id: provider for provider in _PROVIDERS}


def get_provider(provider_id: str | None) -> TranscriptionProvider:
    """按 id 取引擎；没传或传了未知 id 就用默认的那个。"""
    if provider_id and provider_id in PROVIDERS:
        return PROVIDERS[provider_id]
    return PROVIDERS[DEFAULT_PROVIDER_ID]


def list_providers() -> list[ProviderInfo]:
    return [provider.info() for provider in _PROVIDERS]


def configured_providers() -> list[TranscriptionProvider]:
    return [provider for provider in _PROVIDERS if provider.is_configured()]


class UnknownProviderError(ProviderError):
    def __init__(self, provider_id: str) -> None:
        super().__init__(
            f"没有这个转录引擎：{provider_id}",
            status_code=404,
            code="unknown_provider",
        )
