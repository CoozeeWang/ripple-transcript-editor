"""转录服务抽象层。

加一个新引擎时只需三件事：实现 TranscriptionProvider、在 registry 里注册、
（如需）在前端描述它的凭据字段。main.py 与前端只认这个接口，不认具体厂商。

设计上刻意不做「所有引擎都能用的统一参数」：各家能力差别太大，硬凑一个
交集只会把最强的那家拉低。所以这里用 Capabilities 声明能力，由前端决定
哪些选项可见，引擎自己决定怎么解释它支持的参数。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from ..models import Speaker, Transcript, TranscriptionOptions


@dataclass(frozen=True)
class Capabilities:
    """这个引擎能做什么。前端据此决定哪些选项可见，不给用户看用不了的开关。"""

    diarization: bool = False  # 说话人分离
    language_selection: bool = False  # 可指定语言
    speaker_count_hint: bool = False  # 可提示说话人人数
    audio_events: bool = False  # 笑声 / 掌声等声音事件标注
    word_timestamps: bool = False  # 词级时间戳（否则只有段落级）
    max_duration_seconds: int | None = None
    max_file_bytes: int | None = None


@dataclass(frozen=True)
class CredentialField:
    """设置面板里的一个输入框。secret=True 的字段前端用密码框。"""

    key: str
    label: str
    secret: bool = True
    placeholder: str = ""
    required: bool = True
    default_value: str = ""
    description: str = ""
    options: tuple[str, ...] = ()


@dataclass(frozen=True)
class ProviderInfo:
    """给前端渲染用的引擎描述（不含任何密钥）。"""

    id: str
    name: str
    configured: bool
    capabilities: Capabilities
    models: list[str]
    credential_fields: list[CredentialField] = field(default_factory=list)
    experimental: bool = False  # 已接入代码、但未做真机验收，前端据此打标提示


class ProviderError(Exception):
    """引擎调用失败。

    code 是稳定标识，前端据此选文案和给操作建议；raw 保留服务商返回的
    英文原文，供「复制错误信息」排查，不直接展示给用户。
    """

    def __init__(
        self,
        message: str,
        status_code: int = 502,
        code: str = "upstream_error",
        raw: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.raw = raw


class TranscriptionProvider(ABC):
    """一个转录引擎。子类用类属性声明元信息，实现 is_configured 与 transcribe。"""

    id: str
    name: str
    capabilities: Capabilities
    models: list[str]
    credential_fields: list[CredentialField]
    experimental: bool = False  # 子类置 True 表示已接入但未做真机验收

    @abstractmethod
    def is_configured(self) -> bool:
        """凭据是否齐备。没配置就不该出现在可选项里。"""

    @abstractmethod
    def transcribe(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        existing_speakers: list[Speaker] | None = None,
    ) -> Transcript:
        """把音频转成内部的 Transcript。抛 ProviderError 表示失败。"""

    def info(self) -> ProviderInfo:
        return ProviderInfo(
            id=self.id,
            name=self.name,
            configured=self.is_configured(),
            capabilities=self.capabilities,
            models=list(self.models),
            credential_fields=list(self.credential_fields),
            experimental=self.experimental,
        )


# 我们内部沿用 ISO-639-3（zho / yue / eng），但多数云端服务要 ISO-639-1。
# 各家自己的方言编码（如讯飞的 zh_cn）在各自模块里再映射一层。
ISO639_3_TO_1 = {
    "zho": "zh",
    "eng": "en",
    "jpn": "ja",
    "kor": "ko",
    "yue": "yue",  # 粤语没有 ISO-639-1，原样透传
}
