import mimetypes
from pathlib import Path
from typing import Any, ClassVar

import httpx

from ..models import AudioInfo, Segment, Speaker, Transcript, TranscriptionOptions, Word
from ..settings import get_credential
from .base import Capabilities, CredentialField, ProviderError, TranscriptionProvider

ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
ASIAN_LANGUAGE_CODES = {"zho", "yue", "jpn", "kor"}


class ElevenLabsError(ProviderError):
    """ElevenLabs 调用失败。沿用统一错误结构，便于前端统一处理。"""


def describe_upstream_error(status_code: int, raw: str) -> tuple[str, str]:
    """把 ElevenLabs 的状态码 + 英文原文翻译成（code, 中文说明）。"""
    text = (raw or "").lower()
    if status_code in (401, 403):
        return "invalid_api_key", "ElevenLabs 拒绝了这次请求：API Key 无效或没有权限"
    if status_code == 402:
        return "quota_exceeded", "ElevenLabs 额度已经用完，需要充值或换一个 Key"
    if status_code == 429:
        return "rate_limited", "请求太频繁，ElevenLabs 对并发和频率都有限制"
    if status_code == 413:
        return "file_too_large", "音频文件太大，ElevenLabs 收不下"
    if 400 <= status_code < 500:
        if "unsupported" in text or "format" in text or "codec" in text:
            return "unsupported_format", "ElevenLabs 不接受这个音频格式"
        if "too long" in text or "duration" in text:
            return "too_long", "音频太长，超过了 ElevenLabs 的单次时长上限"
        return "bad_request", "ElevenLabs 认为这次请求有问题"
    return "upstream_error", "ElevenLabs 服务暂时不可用"


def transcribe_audio(
    audio_path: Path,
    original_filename: str,
    options: TranscriptionOptions,
    api_key: str,
) -> dict[str, Any]:
    content_type = mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
    form_data: dict[str, str] = {
        "model_id": "scribe_v2",
        "diarize": str(options.diarize).lower(),
        "tag_audio_events": str(options.tag_audio_events).lower(),
        "timestamps_granularity": options.timestamps_granularity,
    }
    if options.language_code:
        form_data["language_code"] = options.language_code
    if options.num_speakers is not None:
        form_data["num_speakers"] = str(options.num_speakers)

    try:
        with audio_path.open("rb") as audio_file, httpx.Client(
            timeout=httpx.Timeout(7200, connect=30)
        ) as client:
            response = client.post(
                ELEVENLABS_STT_URL,
                headers={"xi-api-key": api_key},
                data=form_data,
                files={"file": (original_filename, audio_file, content_type)},
            )
    except httpx.HTTPError as error:
        raise ElevenLabsError(
            "连不上 ElevenLabs，请检查网络（或代理）后重试",
            code="network",
            raw=str(error),
        ) from error

    if response.is_error:
        try:
            detail = response.json().get("detail", response.text)
        except ValueError:
            detail = response.text
        code, message = describe_upstream_error(response.status_code, str(detail))
        raise ElevenLabsError(message, response.status_code, code=code, raw=str(detail))

    result = response.json()
    if not isinstance(result, dict):
        raise ElevenLabsError("ElevenLabs 返回了无法识别的数据格式", code="bad_response")
    return result


def normalize_transcript(
    response: dict[str, Any],
    audio_filename: str,
    existing_speakers: list[Speaker] | None = None,
) -> Transcript:
    raw_words = response.get("words") or []
    language_code = str(response.get("language_code") or "")
    asian_language = language_code in ASIAN_LANGUAGE_CODES
    existing_names = {speaker.id: speaker.name for speaker in existing_speakers or []}
    speaker_ids: list[str] = []
    segments: list[Segment] = []
    current_speaker: str | None = None
    current_start = 0.0
    current_end = 0.0
    current_text = ""
    current_words: list[Word] = []

    def finish_segment() -> None:
        nonlocal current_speaker, current_start, current_end, current_text, current_words
        text = current_text.strip()
        if current_speaker and text:
            segments.append(
                Segment(
                    id=f"seg_{len(segments) + 1:06d}",
                    speaker_id=current_speaker,
                    start=current_start,
                    end=max(current_start, current_end),
                    text=text,
                    words=current_words or None,
                )
            )
        current_speaker = None
        current_start = 0.0
        current_end = 0.0
        current_text = ""
        current_words = []

    for item in raw_words:
        if not isinstance(item, dict) or not item.get("text"):
            continue
        text = str(item["text"])
        start = float(item.get("start") or current_end)
        end = float(item.get("end") or start)
        speaker_id = str(item.get("speaker_id") or current_speaker or "speaker_0")

        if current_speaker and speaker_id != current_speaker:
            finish_segment()
        if current_speaker is None:
            current_speaker = speaker_id
            current_start = start
            if speaker_id not in speaker_ids:
                speaker_ids.append(speaker_id)

        needs_space = (
            not asian_language
            and current_text
            and current_text[-1:].isalnum()
            and text[:1].isalnum()
            and item.get("type") != "spacing"
        )
        current_text += (" " if needs_space else "") + text
        current_end = end
        if item.get("type") == "word":
            current_words.append(
                Word(text=text, start=start, end=end, speaker_id=speaker_id)
            )

        if current_end - current_start >= 18 and current_text.rstrip().endswith(
            ("。", "！", "？", ".", "!", "?")
        ):
            finish_segment()

    finish_segment()

    if not segments and response.get("text"):
        speaker_ids = ["speaker_0"]
        segments = [
            Segment(
                id="seg_000001",
                speaker_id="speaker_0",
                start=0,
                end=0,
                text=str(response["text"]).strip(),
            )
        ]

    speakers = [
        Speaker(id=speaker_id, name=existing_names.get(speaker_id, f"Speaker {index + 1}"))
        for index, speaker_id in enumerate(speaker_ids)
    ]
    duration = max((segment.end for segment in segments), default=0)
    return Transcript(
        audio=AudioInfo(filename=audio_filename, duration=duration),
        speakers=speakers,
        segments=segments,
    )


class ElevenLabsProvider(TranscriptionProvider):
    """ElevenLabs Scribe v2：说话人分离和词级时间戳是它的强项。"""

    id = "elevenlabs"
    name = "ElevenLabs Scribe v2"
    capabilities = Capabilities(
        diarization=True,
        language_selection=True,
        speaker_count_hint=True,
        audio_events=True,
        word_timestamps=True,
    )
    models: ClassVar[list[str]] = ["scribe_v2"]
    credential_fields: ClassVar[list[CredentialField]] = [
        CredentialField(
            key="api_key",
            label="API Key",
            placeholder="粘贴 ElevenLabs API Key",
        )
    ]

    def is_configured(self) -> bool:
        return bool(get_credential(self.id, "api_key"))

    def transcribe(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        existing_speakers: list[Speaker] | None = None,
    ) -> Transcript:
        api_key = get_credential(self.id, "api_key")
        if not api_key:
            raise ProviderError("请先在设置里填写 ElevenLabs API Key", status_code=409, code="no_api_key")
        response = transcribe_audio(audio_path, original_filename, options, api_key)
        return normalize_transcript(
            response, original_filename, existing_speakers=existing_speakers
        )
