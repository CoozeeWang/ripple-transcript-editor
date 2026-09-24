"""自定义 OpenAI 兼容端点。

接入支持 Whisper verbose_json 和时间戳的 `/v1/audio/transcriptions` 服务。
仅有聊天接口的本地服务不适用，其他转录协议需要单独适配。

当前适配器不解析说话人分离，所以 diarization 声明为 False。
词级时间戳是支持的（verbose_json + timestamp_granularities），语言可选。
"""

import math
import mimetypes
from pathlib import Path
from typing import Any, ClassVar

import httpx

from ..models import AudioInfo, Segment, Speaker, Transcript, TranscriptionOptions, Word
from ..settings import get_credential
from .base import ISO639_3_TO_1, Capabilities, CredentialField, ProviderError, TranscriptionProvider


class OpenAICompatibleProvider(TranscriptionProvider):
    """用户自建 / 第三方 OpenAI 兼容转录端点。无说话人分离。"""

    id = "openai_compatible"
    name = "OpenAI Whisper / 兼容转录服务"
    capabilities = Capabilities(
        diarization=False,
        language_selection=True,
        speaker_count_hint=False,
        audio_events=False,
        word_timestamps=True,
    )
    models: ClassVar[list[str]] = ["whisper-1"]
    credential_fields: ClassVar[list[CredentialField]] = [
        CredentialField(
            key="base_url",
            label="Base URL",
            secret=False,
            required=True,
            placeholder="https://api.openai.com/v1 或本地服务地址",
            default_value="https://api.openai.com/v1",
        ),
        CredentialField(
            key="api_key",
            label="API Key（可选）",
            secret=True,
            required=False,
            placeholder="本地服务可不填",
        ),
        CredentialField(
            key="model",
            label="模型名",
            secret=False,
            required=True,
            placeholder="whisper-1",
            default_value="whisper-1",
            options=("whisper-1",),
        ),
    ]

    def is_configured(self) -> bool:
        return bool(get_credential(self.id, "base_url")) and bool(get_credential(self.id, "model"))

    def transcribe(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        existing_speakers: list[Speaker] | None = None,
    ) -> Transcript:
        base_url = get_credential(self.id, "base_url")
        model = get_credential(self.id, "model")
        api_key = get_credential(self.id, "api_key")
        if not base_url or not model:
            raise ProviderError(
                "请先在设置里填写自定义端点的 Base URL 和模型名",
                status_code=409,
                code="no_base_url",
            )

        response = transcribe_audio(audio_path, original_filename, options, base_url, model, api_key)
        return normalize_transcript(response, original_filename, existing_speakers=existing_speakers)


def describe_upstream_error(status_code: int, raw: str) -> tuple[str, str]:
    """把上游状态码 + 英文原文翻译成（code, 中文说明）。"""
    text = (raw or "").lower()
    if status_code in (401, 403):
        return "invalid_api_key", "端点拒绝了这次请求：API Key 无效或没有权限"
    if status_code == 429:
        return "rate_limited", "请求太频繁，端点对并发或频率有限制"
    if status_code == 413:
        return "file_too_large", "音频文件太大，端点收不下"
    if 400 <= status_code < 500:
        if "unsupported" in text or "format" in text or "codec" in text:
            return "unsupported_format", "端点不接受这个音频格式"
        if "timestamp" in text or "granularit" in text:
            return (
                "unsupported_option",
                "端点不支持词级时间戳参数，可在设置里改用其它模型，或换端点",
            )
        if "too long" in text or "duration" in text:
            return "too_long", "音频太长，超过了端点的单次时长上限"
        return "bad_request", "端点认为这次请求有问题"
    return "upstream_error", "端点服务暂时不可用"


def transcribe_audio(
    audio_path: Path,
    original_filename: str,
    options: TranscriptionOptions,
    base_url: str,
    model: str,
    api_key: str | None,
) -> dict[str, Any]:
    model = model.strip()
    if model.startswith(("gpt-4o-transcribe", "gpt-4o-mini-transcribe", "gpt-transcribe")):
        raise ProviderError(
            "Ripple 尚未适配这个模型的转录格式。请改用 whisper-1 或支持 Whisper 时间戳格式的模型；不会自动替换模型。",
            status_code=422, code="unsupported_model",
        )
    url = f"{base_url.strip().rstrip('/')}/audio/transcriptions"
    content_type = mimetypes.guess_type(original_filename)[0] or "application/octet-stream"

    data: dict[str, Any] = {
        "model": model,
        "response_format": "verbose_json",
    }
    # OpenAI 官方支持词级时间戳；兼容服务若不支持会在错误里说明，由前端转译。
    data["timestamp_granularities[]"] = ["word", "segment"]

    # 只在我们确有干净 ISO-639-1 映射时才传语言（粤语 yue 没有 1 位码，传了端点也不认）。
    if options.language_code:
        mapped = ISO639_3_TO_1.get(options.language_code)
        if mapped and mapped != options.language_code:
            data["language"] = mapped

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    try:
        with audio_path.open("rb") as audio_file, httpx.Client(
            timeout=httpx.Timeout(7200, connect=30)
        ) as client:
            response = client.post(
                url,
                headers=headers,
                data=data,
                files={"file": (original_filename, audio_file, content_type)},
            )
    except httpx.HTTPError as error:
        raise ProviderError(
            "连不上这个端点，请检查 Base URL 和网络（或代理）后重试",
            code="network",
            raw=str(error),
        ) from error

    if response.is_error:
        try:
            detail = response.json().get("error", {})
            detail_text = detail.get("message") if isinstance(detail, dict) else str(response.text)
        except (ValueError, AttributeError):
            detail_text = response.text
        code, message = describe_upstream_error(response.status_code, str(detail_text))
        raise ProviderError(message, response.status_code, code=code, raw=str(detail_text))

    try:
        result = response.json()
    except ValueError as error:
        raise ProviderError("端点返回了无法识别的数据格式", code="bad_response") from error
    if not isinstance(result, dict):
        raise ProviderError("端点返回了无法识别的数据格式", code="bad_response")
    return result


def normalize_transcript(
    response: dict[str, Any],
    audio_filename: str,
    existing_speakers: list[Speaker] | None = None,
) -> Transcript:
    try:
        return _normalize_transcript(response, audio_filename, existing_speakers)
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise ProviderError("端点返回的文本或时间戳格式不正确。", code="bad_response") from error


def _timestamp(value: Any) -> float:
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError("invalid timestamp")
    return result


def _words(raw_words: Any, speaker_id: str) -> list[Word]:
    if not isinstance(raw_words, list):
        raise TypeError("invalid words")
    words = []
    for raw in raw_words:
        text = raw["word"]
        if not isinstance(text, str):
            raise TypeError("invalid word")
        if not text.strip():
            continue
        start, end = _timestamp(raw["start"]), _timestamp(raw["end"])
        if end < start:
            raise ValueError("reversed timestamp")
        words.append(Word(text=text.strip(), start=start, end=end, speaker_id=speaker_id))
    return words


def _normalize_transcript(
    response: dict[str, Any],
    audio_filename: str,
    existing_speakers: list[Speaker] | None,
) -> Transcript:
    """把 OpenAI verbose_json 归一化成内部 Transcript。

    当前适配器统一归到 speaker_0（沿用已有的同名说话人若有）。
    优先用 segments[]（带起止时间），兼容顶层 words[]；缺少时间戳则明确报错。
    """
    existing_names = {speaker.id: speaker.name for speaker in existing_speakers or []}
    speaker_id = "speaker_0"
    speaker_name = existing_names.get(speaker_id, "Speaker 1")
    speakers = [Speaker(id=speaker_id, name=speaker_name)]

    raw_segments = response.get("segments") or []
    segments: list[Segment] = []
    top_words = _words(response.get("words") or [], speaker_id)
    if not isinstance(raw_segments, list):
        raise TypeError("invalid segments")

    if raw_segments:
        for index, raw in enumerate(raw_segments):
            if not isinstance(raw, dict):
                raise TypeError("invalid segment")
            text = raw.get("text", "")
            if not isinstance(text, str):
                raise TypeError("invalid text")
            text = text.strip()
            if not text:
                continue
            start = _timestamp(raw["start"])
            end = _timestamp(raw["end"])
            if end < start:
                raise ValueError("reversed timestamp")
            words = _words(raw.get("words") or [], speaker_id) or None
            segments.append(
                Segment(
                    id=f"seg_{index + 1:06d}",
                    speaker_id=speaker_id,
                    start=start,
                    end=max(start, end),
                    text=text,
                    words=words,
                )
            )

    # 官方 Whisper 将词放在顶层，按词中点分配，边界上的词不会重复。
    if segments and top_words:
        assigned: list[list[Word]] = [[] for _ in segments]
        segment_index = 0
        for word in top_words:
            midpoint = (word.start + word.end) / 2
            while segment_index < len(segments) - 1 and midpoint >= segments[segment_index].end:
                segment_index += 1
            assigned[segment_index].append(word)
        for segment, words in zip(segments, assigned):
            if segment.words is None:
                segment.words = words or None

    if not segments:
        text = response.get("text", "")
        if not isinstance(text, str):
            raise TypeError("invalid text")
        text = text.strip()
        if text:
            if not top_words:
                raise ProviderError(
                    "端点仅返回文字，没有 Ripple 回放所需的时间戳。请使用支持 Whisper 时间戳格式的模型。",
                    code="missing_timestamps",
                )
            segments = [
                Segment(id="seg_000001", speaker_id=speaker_id,
                        start=min(word.start for word in top_words),
                        end=max(word.end for word in top_words), text=text, words=top_words)
            ]

    if not segments:
        raise ProviderError("端点没有返回任何可识别的文本", code="empty_result")

    duration = max((segment.end for segment in segments), default=0)
    if response.get("duration") is not None:
        duration = max(duration, _timestamp(response["duration"]))

    return Transcript(
        audio=AudioInfo(filename=audio_filename, duration=duration),
        speakers=list(speakers),
        segments=segments,
    )
