"""腾讯云录音文件识别（标准版，异步）。

接口形态：
  - 鉴权：TC3-HMAC-SHA256 签名（SecretId / SecretKey）
  - 流程：CreateRecTask 提交任务（返回 TaskId）-> DescribeTaskStatus 轮询直到成功/失败
  - 音频：用 Data 字段直接传 base64（≤5MB）；超过则先用 ffmpeg 压成 16k 单声道 opus 再传
  - 返回：ResultDetail[]，每项 FinalSentence / StartMs / EndMs / SpeakerId，
         词级时间戳 Words[].OffsetStartMs / OffsetEndMs（句子内偏移，需加回句子起点）

能力：中文 / 粤语 / 英语，说话人分离，词级时间戳。
已真机验收（2026-08，用户用真实密钥在腾讯云控制台子账号 + QcloudASRFullAccess 下转录成功）：
experimental 已翻 False。子产品锁定为「标准版录音文件识别」，按 5MB base64 上限直接传 Data，
超过则代码自动用 ffmpeg 压成 16k 单声道 opus 再传，无需用户在控制台切换子产品。
"""

import base64
import datetime
import hashlib
import hmac
import json
import os
import re
import subprocess
from pathlib import Path
from typing import ClassVar

import httpx

from ..models import AudioInfo, Segment, Speaker, Transcript, TranscriptionOptions, Word
from ..settings import get_credential
from .base import Capabilities, CredentialField, ProviderError, TranscriptionProvider

TENCENT_ASR_HOST = "asr.tencentcloudapi.com"
TENCENT_ASR_SERVICE = "asr"
TENCENT_ASR_VERSION = "2019-06-14"
TENCENT_ASR_REGION = "ap-beijing"

# 腾讯云录音文件识别的 Data 字段上限（base64 前的原始音频字节）。
MAX_DATA_BYTES = 5 * 1024 * 1024

# 内部语言码（ISO-639-3）-> 腾讯云 EngineModelType。
ENGINE_MODEL_BY_LANG = {
    "zho": "16k_zh",
    "yue": "16k_yue",
    "eng": "16k_en",
}
DEFAULT_ENGINE_MODEL = "16k_zh"

# 轮询参数
POLL_INTERVAL_SECONDS = 3
POLL_TIMEOUT_SECONDS = 1800  # 长音频最多等 30 分钟

# 单次 API 调用的超时。标准版是异步的：提交后立刻返回 TaskId，再由本地轮询，所以不存在
# 「一个请求挂几十分钟等结果」的情况；但提交任务时的 body 最多是 5MB 音频的 base64
# （约 6.7MB），慢上行仍可能超过一分钟，因此传输与读取分开给时间，也便于区分是哪一段失败。
TENCENT_CALL_CONNECT_TIMEOUT_SECONDS = 15
TENCENT_CALL_WRITE_TIMEOUT_SECONDS = 300
TENCENT_CALL_READ_TIMEOUT_SECONDS = 180
TENCENT_CALL_POOL_TIMEOUT_SECONDS = 30

# 默认不走环境里的 HTTP/HTTPS 代理直连腾讯云（本地开发机的代理常不稳定，
# 反而会让请求失败）。若你确实处于必须用代理才能上网的环境，设
# TRANSCRIPTION_TRUST_PROXY=1 即可恢复代理。
_TRUST_PROXY = os.environ.get("TRANSCRIPTION_TRUST_PROXY") == "1"


def _hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _tc3_sign(secret_id: str, secret_key: str, action: str, payload: str) -> dict[str, str]:
    """生成腾讯云 TC3-HMAC-SHA256 签名所需的请求头。"""
    algorithm = "TC3-HMAC-SHA256"
    timestamp = int(datetime.datetime.now(tz=datetime.UTC).timestamp())
    date = datetime.datetime.fromtimestamp(timestamp, tz=datetime.UTC).strftime("%Y-%m-%d")

    canonical_headers = (
        "content-type:application/json; charset=utf-8\n"
        f"host:{TENCENT_ASR_HOST}\n"
    )
    signed_headers = "content-type;host"
    hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    canonical_request = "\n".join(  # noqa: FLY002 -- Keep protocol signing fields visibly separated.
        [
            "POST",
            "/",
            "",
            canonical_headers,
            signed_headers,
            hashed_payload,
        ]
    )

    credential_scope = f"{date}/{TENCENT_ASR_SERVICE}/tc3_request"
    string_to_sign = "\n".join(
        [
            algorithm,
            str(timestamp),
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )

    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, TENCENT_ASR_SERVICE)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization = (
        f"{algorithm} "
        f"Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    return {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "X-TC-Action": action,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": TENCENT_ASR_VERSION,
        "X-TC-Region": TENCENT_ASR_REGION,
    }


def _describe_tencent_error(raw: dict) -> tuple[str, str] | None:
    """从腾讯云响应里提取业务错误，翻译成（code, 中文说明）。无错误返回 None。"""
    error = raw.get("Response", {}).get("Error") if isinstance(raw, dict) else None
    if not error:
        return None
    code = str(error.get("Code", ""))
    message = str(error.get("Message", ""))
    if "Signature" in code or "SecretId" in code or "Auth" in code:
        return "invalid_api_key", "腾讯云拒绝了这次请求：SecretId / SecretKey 无效或没有权限"
    if "LimitExceeded" in code or "Quota" in code:
        return "quota_exceeded", "腾讯云额度或并发已用尽，请稍后或检查账户配额"
    if "UnsupportedOperation" in code or "InvalidParameter" in code:
        return "bad_request", f"腾讯云认为请求参数有问题：{message}"
    return "upstream_error", f"腾讯云返回错误：{message}"


def _parse_result_text(result: str) -> list[Segment]:
    """兜底解析腾讯云 Result 字符串。

    Result 格式示例：
        "[0:0.020,0:2.380] 腾讯云语音识别欢迎您。\n[1:2.500,1:5.100] 第二句。\n"
    每行形如 "[speaker_id:start_seconds,speaker_id:end_seconds] text"，按行拆分为 segment。
    """
    segments: list[Segment] = []
    for index, line in enumerate(result.strip().splitlines()):
        line = line.strip()
        if not line:
            continue
        # 匹配 [speaker:start, speaker:end]
        match = re.match(r"\[(\d+):([\d.]+),(\d+):([\d.]+)\]\s*(.*)", line)
        if not match:
            continue
        speaker_label = match.group(1)
        start = float(match.group(2))
        end = float(match.group(4))
        text = match.group(5).strip()
        if not text:
            continue
        speaker_id = f"spk_{speaker_label}"
        segments.append(
            Segment(
                id=f"seg_{index + 1:06d}",
                speaker_id=speaker_id,
                start=start,
                end=max(start, end),
                text=text,
                words=None,
            )
        )
    return segments


def normalize_result_detail(
    data: dict,
    audio_filename: str,
    existing_speakers: list[Speaker] | None = None,
) -> Transcript:
    """把腾讯云 DescribeTaskStatus 的 Data 归一化为内部 Transcript。

    优先用 ResultDetail 数组（含说话人、词级时间戳）。
    若 ResultDetail 为空，则兜底解析 Result 字符串。
    """
    existing_names = {speaker.id: speaker.name for speaker in existing_speakers or []}
    speaker_ids: list[str] = []
    segments: list[Segment] = []
    audio_duration = float(data.get("AudioDuration") or 0)

    detail = data.get("ResultDetail") or []
    if isinstance(detail, list):
        for index, item in enumerate(detail):
            if not isinstance(item, dict):
                continue
            text = str(item.get("FinalSentence") or "").strip()
            if not text:
                continue

            speaker_label = str(item.get("SpeakerId") or 0)
            speaker_id = f"spk_{speaker_label}"
            if speaker_id not in speaker_ids:
                speaker_ids.append(speaker_id)

            start_ms = float(item.get("StartMs") or 0)
            end_ms = float(item.get("EndMs") or start_ms)
            start = start_ms / 1000.0
            end = end_ms / 1000.0

            words: list[Word] = []
            raw_words = item.get("Words") or []
            if isinstance(raw_words, list):
                for word in raw_words:
                    if not isinstance(word, dict):
                        continue
                    word_text = str(word.get("Word") or "").strip()
                    if not word_text:
                        continue
                    words.append(
                        Word(
                            text=word_text,
                            start=(start_ms + float(word.get("OffsetStartMs") or 0)) / 1000.0,
                            end=(start_ms + float(word.get("OffsetEndMs") or 0)) / 1000.0,
                            speaker_id=speaker_id,
                        )
                    )

            segments.append(
                Segment(
                    id=f"seg_{index + 1:06d}",
                    speaker_id=speaker_id,
                    start=start,
                    end=max(start, end),
                    text=text,
                    words=words or None,
                )
            )

    # 兜底：ResultDetail 为空时，解析 Result 字符串
    if not segments:
        result_text = str(data.get("Result") or "").strip()
        if result_text:
            segments = _parse_result_text(result_text)

    if not segments:
        return Transcript(
            audio=AudioInfo(filename=audio_filename, duration=audio_duration),
            speakers=[],
            segments=[],
        )

    for segment in segments:
        if segment.speaker_id not in speaker_ids:
            speaker_ids.append(segment.speaker_id)

    speakers = [
        Speaker(
            id=speaker_id,
            name=existing_names.get(speaker_id, f"说话人 {i + 1}"),
        )
        for i, speaker_id in enumerate(speaker_ids)
    ]
    duration = max(
        (segment.end for segment in segments),
        default=audio_duration,
    )
    return Transcript(
        audio=AudioInfo(filename=audio_filename, duration=max(duration, audio_duration)),
        speakers=speakers,
        segments=segments,
    )


class TencentCloudProvider(TranscriptionProvider):
    """腾讯云录音文件识别（标准版，异步 API）。中文强、支持说话人分离与词级时间戳。"""

    id = "tencent_cloud"
    name = "腾讯云录音文件识别（标准版）"
    experimental = False  # 已真机跑通（2026-08，腾讯云子账号 + QcloudASRFullAccess 转录成功）
    capabilities = Capabilities(
        diarization=True,
        language_selection=True,
        speaker_count_hint=True,
        audio_events=False,
        word_timestamps=True,
        max_file_bytes=MAX_DATA_BYTES,
    )
    models: ClassVar[list[str]] = [DEFAULT_ENGINE_MODEL, "16k_zh-PY", "16k_yue", "16k_en"]
    credential_fields: ClassVar[list[CredentialField]] = [
        CredentialField(key="secret_id", label="SecretId", secret=True),
        CredentialField(key="secret_key", label="SecretKey", secret=True),
    ]

    def is_configured(self) -> bool:
        return bool(get_credential(self.id, "secret_id")) and bool(
            get_credential(self.id, "secret_key")
        )

    def _prepare_audio_data(self, audio_path: Path) -> tuple[str, int]:
        """读音频字节，超过 5MB 先用 ffmpeg 压成 16k 单声道 opus。返回 (base64, 原始字节数)。"""
        raw = audio_path.read_bytes()
        if len(raw) <= MAX_DATA_BYTES:
            return base64.b64encode(raw).decode("ascii"), len(raw)

        try:
            proc = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(audio_path),
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "24k",
                    "-f",
                    "opus",
                    "-",
                ],
                capture_output=True,
                check=False,
            )
        except FileNotFoundError as error:
            raise ProviderError(
                "本机没有 ffmpeg，无法压缩超过 5MB 的音频。请安装 ffmpeg"
                "（macOS: brew install ffmpeg；Windows: 从 ffmpeg.org 下载并加入 PATH），"
                "或把音频剪成 5 分钟以内的片段。",
                code="missing_ffmpeg",
            ) from error

        if proc.returncode != 0:
            detail = proc.stderr.decode(errors="replace").strip()
            raise ProviderError(
                "ffmpeg 压缩音频失败，可能是音频格式损坏或不被支持。",
                code="audio_convert_failed",
                raw=detail,
            )

        compressed = proc.stdout
        if len(compressed) > MAX_DATA_BYTES:
            raise ProviderError(
                "音频即使压缩后仍超过腾讯云 5MB 上限。请把它剪成 5 分钟以内的片段再试。",
                code="file_too_large",
            )
        return base64.b64encode(compressed).decode("ascii"), len(compressed)

    def _call(self, action: str, payload: dict, secret_id: str, secret_key: str) -> dict:
        body = json.dumps(payload, ensure_ascii=False)
        headers = _tc3_sign(secret_id, secret_key, action, body)
        try:
            with httpx.Client(
                timeout=httpx.Timeout(
                    connect=TENCENT_CALL_CONNECT_TIMEOUT_SECONDS,
                    read=TENCENT_CALL_READ_TIMEOUT_SECONDS,
                    write=TENCENT_CALL_WRITE_TIMEOUT_SECONDS,
                    pool=TENCENT_CALL_POOL_TIMEOUT_SECONDS,
                ),
                trust_env=_TRUST_PROXY,
            ) as client:
                response = client.post(
                    f"https://{TENCENT_ASR_HOST}/", headers=headers, content=body.encode("utf-8")
                )
        except (httpx.ConnectTimeout, httpx.ConnectError, httpx.PoolTimeout) as error:
            raise ProviderError(
                f"连不上腾讯云（{TENCENT_CALL_CONNECT_TIMEOUT_SECONDS} 秒内没建立起连接），"
                "请检查网络或代理后重试",
                code="network",
                raw=str(error),
            ) from error
        except httpx.WriteTimeout as error:
            raise ProviderError(
                f"请求体传到腾讯云时超时（{TENCENT_CALL_WRITE_TIMEOUT_SECONDS // 60} 分钟没传完）。"
                "音频越大越容易发生，可以先把音频压小或剪短再试。",
                code="upload_timeout",
                raw=str(error),
            ) from error
        except httpx.ReadTimeout as error:
            raise ProviderError(
                f"腾讯云 {TENCENT_CALL_READ_TIMEOUT_SECONDS} 秒没有响应 `{action}`。"
                "稍后重试通常就好；若反复出现，可把这条错误信息留档以便排查。",
                code="response_timeout",
                raw=str(error),
            ) from error
        except httpx.HTTPError as error:
            raise ProviderError(
                "与腾讯云的连接中断，请检查网络或代理后重试",
                code="network",
                raw=str(error),
            ) from error

        try:
            data = response.json()
        except ValueError:
            raise ProviderError(
                "腾讯云返回了无法识别的数据格式", code="bad_response", raw=response.text
            )

        if response.status_code != 200:
            return data  # 交给上层按 Response.Error 处理

        error = _describe_tencent_error(data)
        if error:
            code, message = error
            raise ProviderError(message, response.status_code, code=code, raw=json.dumps(data, ensure_ascii=False))
        return data

    def _create_task(
        self, audio_path: Path, options: TranscriptionOptions, secret_id: str, secret_key: str
    ) -> int:
        data_b64, data_len = self._prepare_audio_data(audio_path)
        engine = ENGINE_MODEL_BY_LANG.get(options.language_code or "zho", DEFAULT_ENGINE_MODEL)
        payload: dict = {
            "EngineModelType": engine,
            "ChannelNum": 1,
            # 2 = 基础结果 + 词级时间戳 + 语速值 + 标点（ResultDetail 在此模式下才稳定返回）
            "ResTextFormat": 2,
            "SourceType": 1,  # 1 = 通过 Data 字段传 base64 音频数据
            "SpeakerDiarization": 1 if options.diarize else 0,
            "Data": data_b64,
            "DataLen": data_len,
        }
        if options.num_speakers is not None:
            payload["SpeakerNumber"] = options.num_speakers

        result = self._call("CreateRecTask", payload, secret_id, secret_key)
        inner = (result.get("Response") or {}).get("Data") or {}
        task_id = inner.get("TaskId")
        if task_id is None:
            raise ProviderError(
                "腾讯云创建转写任务失败，未返回 TaskId", code="upstream_error", raw=json.dumps(result, ensure_ascii=False)
            )
        return int(task_id)

    def _wait_task(self, task_id: int, secret_id: str, secret_key: str) -> dict:
        import time

        deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            result = self._call(
                "DescribeTaskStatus", {"TaskId": task_id}, secret_id, secret_key
            )
            inner = (result.get("Response") or {}).get("Data") or {}
            status = int(inner.get("Status", 0))
            if status == 2:  # 成功
                return inner
            if status == 3:  # 失败
                raise ProviderError(
                    f"腾讯云转写任务失败：{inner.get('ErrorMsg') or '未知错误'}",
                    code="upstream_error",
                    raw=json.dumps(result, ensure_ascii=False),
                )
            time.sleep(POLL_INTERVAL_SECONDS)
        raise ProviderError(
            "腾讯云转写任务轮询超时（超过 30 分钟仍未完成）", code="timeout"
        )

    def transcribe(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        existing_speakers: list[Speaker] | None = None,
    ) -> Transcript:
        secret_id = get_credential(self.id, "secret_id")
        secret_key = get_credential(self.id, "secret_key")
        if not secret_id or not secret_key:
            raise ProviderError(
                "请先在设置里填写腾讯云的 SecretId 和 SecretKey",
                status_code=409,
                code="no_api_key",
            )

        task_id = self._create_task(audio_path, options, secret_id, secret_key)
        task_data = self._wait_task(task_id, secret_id, secret_key)
        return normalize_result_detail(
            task_data, original_filename, existing_speakers=existing_speakers
        )
