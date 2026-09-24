"""腾讯云录音文件识别极速版（同步返回）。

和「标准版」（tencent_cloud.py）是**两套完全不同的协议**，签名、参数命名、返回结构
都无法复用，所以这里是独立的一份实现：

  - 请求地址：https://asr.cloud.tencent.com/asr/flash/v1/<appid>?<参数>
  - 鉴权：把全部参数按字典序拼成
        POST + host + path?query
    再用 SecretKey 做 HMAC-SHA1、base64，放进 Authorization 头。
    （标准版是 TC3-HMAC-SHA256，完全不同。）
  - 音频：原始字节直接放请求 Body（≤100MB），不做 base64、不做 ffmpeg 压缩。
  - 返回：同步返回 flash_result[]，内含 sentence_list[]（句子文本 + 起止毫秒 + speaker_id）；
    word_info=1 时带 word_list[]（词级时间戳）。
  - 语言：由 engine_type 指定；说话人分离官方说明「目前支持中文普通话引擎」。

凭据：AppID 是极速版独有的（要拼进 URL 路径），标准版没有这个字段，所以本引擎有独立的
凭据槽；SecretId / SecretKey 若留空则回落到标准版（tencent_cloud）那一套 —— 两版共用同一
对密钥，用户不必复制两遍。

限制：单文件 ≤100MB 且时长 ≤2 小时；支持格式见 SUPPORTED_VOICE_FORMATS
（**不含 flac、mp4**，这两类请用标准版或讯飞）。

因为它是同步接口，本地必须一直挂着等结果，所以超时要按「连不上 / 传不完 / 等不到」分段给
（见 FLASH_*_TIMEOUT_SECONDS）；长音频走这里等于占着一个请求等几十分钟，标准版（异步）
在这一点上稳得多。

尚未真机验收（experimental=True）：签名拼接已按官方文档的示例逐字对齐并写了测试，但真实
调用需要在控制台开通过服务后用真密钥跑一次才能翻掉这个标记。
"""

import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from typing import ClassVar

import httpx

from ..models import AudioInfo, Segment, Speaker, Transcript, TranscriptionOptions, Word
from ..settings import get_credential
from .base import Capabilities, CredentialField, ProviderError, TranscriptionProvider

FLASH_HOST = "asr.cloud.tencent.com"
FLASH_PATH_PREFIX = "/asr/flash/v1"

# 凭据回落的来源：极速版与标准版共用同一对 SecretId / SecretKey。
SHARED_CREDENTIAL_PROVIDER_ID = "tencent_cloud"

# 请求 Body（音频原始字节）上限，官方文档：最大不能超过 100MB。
MAX_BODY_BYTES = 100 * 1024 * 1024
# 官方文档：时长不超过 2 小时。
MAX_DURATION_SECONDS = 2 * 3600

# ---- 超时（分成三段，别用一个数管两件事）--------------------------------------
# 极速版是**同步**接口：同一个请求里既要推完整个音频（≤100MB），又要等腾讯算完才返回。
# 2026-09-14 那次 47 分钟音频的失败就是这个设计缺口：一个笼统的 300 秒超时同时管上传与
# 等待，腾讯一个字节都还没回，本地就先掐断了，用户白等 5 分钟，日志里也看不出所以然。
# 现在按阶段给不同容忍度：
FLASH_CONNECT_TIMEOUT_SECONDS = 15  # 连不上要快速失败，别让用户干等
FLASH_WRITE_TIMEOUT_SECONDS = 1200  # 上行带宽决定；100MB 走 1Mbps 约需 13 分钟
# 官方口径（文档 product/239/52097）：「通常 30 分钟音频可在 10 秒内完成识别」—— 也就是说
# 极速版本身并不慢，真跑出十几分钟必然是别的原因（上行带宽、腾讯侧排队），所以这里给足 20 分钟。
FLASH_READ_TIMEOUT_SECONDS = 1200
FLASH_POOL_TIMEOUT_SECONDS = 30


def flash_timeout() -> httpx.Timeout:
    return httpx.Timeout(
        connect=FLASH_CONNECT_TIMEOUT_SECONDS,
        read=FLASH_READ_TIMEOUT_SECONDS,
        write=FLASH_WRITE_TIMEOUT_SECONDS,
        pool=FLASH_POOL_TIMEOUT_SECONDS,
    )

# 内部语言码（ISO-639-3）-> 极速版 engine_type。
ENGINE_TYPE_BY_LANG = {
    "zho": "16k_zh",
    "yue": "16k_yue",
    "eng": "16k_en",
}
DEFAULT_ENGINE_TYPE = "16k_zh"

# 极速版支持的音频格式（官方文档口径）。注意比标准版**少** flac 与 mp4。
SUPPORTED_VOICE_FORMATS = ("wav", "pcm", "ogg-opus", "speex", "silk", "mp3", "m4a", "aac", "amr")

# 文件扩展名 -> voice_format 取值。
VOICE_FORMAT_BY_EXTENSION = {
    "wav": "wav",
    "pcm": "pcm",
    "ogg": "ogg-opus",
    "opus": "ogg-opus",
    "speex": "speex",
    "silk": "silk",
    "mp3": "mp3",
    "m4a": "m4a",
    "aac": "aac",
    "amr": "amr",
}

# 极速版返回的 code -> （内部错误码, 中文说明）。前端按内部错误码选操作建议。
FLASH_ERROR_BY_CODE = {
    4001: ("bad_request", "腾讯云认为请求参数不合法"),
    4002: ("invalid_api_key", "腾讯云鉴权失败：SecretId / SecretKey 无效或与本账号不匹配"),
    4003: ("service_not_enabled", "这个腾讯云账号还没开通语音识别服务，请先到控制台开通"),
    4004: ("quota_exceeded", "录音文件识别极速版的免费额度或资源包已用完"),
    4005: ("quota_exceeded", "腾讯云账号欠费，服务已停止"),
    4006: ("rate_limited", "腾讯云极速版并发数已用满，等一会儿再试"),
    4007: ("unsupported_format", "腾讯云无法解码这段音频，请确认文件后缀与实际格式一致"),
    4008: ("network", "向腾讯云上传音频超时"),
    4009: ("network", "向腾讯云上传音频的连接被断开"),
    4010: ("bad_request", "腾讯云收到了无法识别的请求"),
    4011: ("file_too_large", "音频超过腾讯云极速版 100MB 上限"),
    4012: ("empty_result", "上传的音频是空的"),
}

# 默认不走环境里的 HTTP/HTTPS 代理直连腾讯云（与标准版保持一致的行为）。
_TRUST_PROXY = os.environ.get("TRANSCRIPTION_TRUST_PROXY") == "1"


def _as_int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def as_query_string(params: dict[str, str]) -> str:
    """按字典序把参数拼成 query 串（签名原文与请求 URL 共用同一份顺序）。"""
    return "&".join(f"{key}={params[key]}" for key in sorted(params))


def signature_source(appid: str, params: dict[str, str]) -> str:
    """签名原文：POST + host + path?query（官方文档 4.5 节的拼接方式）。

    appid 只在路径里出现，不参与 query 部分 —— 这与官方 Python SDK 的
    ``FlashRecognizer._format_sign_string`` 完全一致（它显式跳过 appid）。
    """
    return f"POST{FLASH_HOST}{FLASH_PATH_PREFIX}/{appid}?{as_query_string(params)}"


def request_url(appid: str, params: dict[str, str]) -> str:
    """请求地址。官方 SDK 是「拿签名原文去掉开头的 POST」直接当 URL
    （``requrl = "https://" + signstr[4:]``），这里照做 —— 这样发出去的 query
    串与签名的原文逐字一致，不依赖服务端自行重排。"""
    return f"https://{FLASH_HOST}{FLASH_PATH_PREFIX}/{appid}?{as_query_string(params)}"


def sign(appid: str, params: dict[str, str], secret_key: str) -> str:
    """对签名原文做 HMAC-SHA1，再 base64。结果直接放进 Authorization 头。"""
    digest = hmac.new(
        secret_key.encode("utf-8"),
        signature_source(appid, params).encode("utf-8"),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def voice_format_for(filename: str) -> str:
    """按文件名后缀推断 voice_format；不支持的格式立刻给出可操作的报错。"""
    extension = Path(filename).suffix.lower().lstrip(".")
    voice_format = VOICE_FORMAT_BY_EXTENSION.get(extension)
    if voice_format:
        return voice_format
    label = f".{extension}" if extension else "无后缀"
    raise ProviderError(
        f"极速版不支持「{label}」格式（支持：{'、'.join(SUPPORTED_VOICE_FORMATS)}）。"
        "可以先把它转成其中一种格式，或换用支持该格式的引擎。",
        code="unsupported_format",
    )


def describe_error(payload: object) -> tuple[str, str] | None:
    """把极速版的 BusinessError 翻译成（内部码, 中文说明）。code=0 返回 None。"""
    if not isinstance(payload, dict):
        return ("bad_response", "腾讯云返回了无法识别的数据格式")
    code = _as_int(payload.get("code"))
    if code == 0:
        return None
    if code is None:
        return ("bad_response", "腾讯云极速版没有返回 code 字段")
    message = str(payload.get("message") or "").strip()
    known = FLASH_ERROR_BY_CODE.get(code)
    if known:
        internal_code, explanation = known
        return (internal_code, f"{explanation}（{message}）" if message else explanation)
    if 5000 <= code < 6000:
        return ("upstream_error", f"腾讯云极速版临时故障（{code} {message}），重试通常就好")
    return ("upstream_error", f"腾讯云极速版返回错误 {code}：{message}")


def normalize_flash_result(
    data: dict,
    audio_filename: str,
    existing_speakers: list[Speaker] | None = None,
) -> Transcript:
    """把极速版响应归一化为内部 Transcript。

    flash_result 是「每个声道一份」，请求里 first_channel_only=1，所以取第一份即可。
    sentence_list 里时间单位是毫秒；word_list 的时间也是毫秒（绝对时间，不是句内偏移）。
    """
    existing_names = {speaker.id: speaker.name for speaker in existing_speakers or []}
    audio_duration = float(_as_int(data.get("audio_duration")) or 0) / 1000.0

    channels = data.get("flash_result") or []
    channel = next((item for item in channels if isinstance(item, dict)), {})
    sentences = channel.get("sentence_list") or []

    speaker_ids: list[str] = []
    segments: list[Segment] = []
    for index, item in enumerate(sentences):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue

        speaker_label = _as_int(item.get("speaker_id"))
        speaker_id = f"spk_{0 if speaker_label is None else speaker_label}"
        if speaker_id not in speaker_ids:
            speaker_ids.append(speaker_id)

        start_ms = float(_as_int(item.get("start_time")) or 0)
        end_ms = float(_as_int(item.get("end_time")) or start_ms)
        start = start_ms / 1000.0
        end = end_ms / 1000.0

        words: list[Word] = []
        raw_words = item.get("word_list") or []
        if isinstance(raw_words, list):
            for word in raw_words:
                if not isinstance(word, dict):
                    continue
                word_text = str(word.get("word") or "").strip()
                if not word_text:
                    continue
                word_start = float(_as_int(word.get("start_time")) or 0) / 1000.0
                word_end = float(_as_int(word.get("end_time")) or 0) / 1000.0
                words.append(
                    Word(
                        text=word_text,
                        start=word_start,
                        end=max(word_start, word_end),
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

    if not segments:
        return Transcript(
            audio=AudioInfo(filename=audio_filename, duration=audio_duration),
            speakers=[],
            segments=[],
        )

    speakers = [
        Speaker(id=speaker_id, name=existing_names.get(speaker_id, f"说话人 {i + 1}"))
        for i, speaker_id in enumerate(speaker_ids)
    ]
    duration = max((segment.end for segment in segments), default=audio_duration)
    return Transcript(
        audio=AudioInfo(filename=audio_filename, duration=max(duration, audio_duration)),
        speakers=speakers,
        segments=segments,
    )


class TencentFlashProvider(TranscriptionProvider):
    """腾讯云录音文件识别极速版。≤100MB / ≤2 小时，同步返回，不做本地压缩。"""

    id = "tencent_flash"
    name = "腾讯云录音文件识别（极速版）"
    # 已接入代码但尚未真机验收；用户在控制台开通过服务、跑通一次后可翻 False。
    experimental = True
    capabilities = Capabilities(
        diarization=True,  # 官方说明「目前支持中文普通话引擎」
        language_selection=True,
        speaker_count_hint=False,  # 极速版没有 speaker_number 参数
        audio_events=False,
        word_timestamps=True,
        max_file_bytes=MAX_BODY_BYTES,
        max_duration_seconds=MAX_DURATION_SECONDS,
    )
    models: ClassVar[list[str]] = [DEFAULT_ENGINE_TYPE, "16k_zh-PY", "16k_yue", "16k_en"]
    credential_fields: ClassVar[list[CredentialField]] = [
        # AppID 不是密钥，前端用明文框更省事（账号级数字 id，控制台 API 密钥页可见）。
        CredentialField(
            key="appid",
            label="AppID",
            secret=False,
            placeholder="腾讯云账号 AppID（纯数字，拼在请求地址里）",
        ),
        CredentialField(
            key="secret_id",
            label="SecretId",
            required=False,
            placeholder="留空则沿用标准版的 SecretId",
        ),
        CredentialField(
            key="secret_key",
            label="SecretKey",
            required=False,
            placeholder="留空则沿用标准版的 SecretKey",
        ),
    ]

    # 极速版独有的凭据：AppID。
    def _appid(self) -> str | None:
        return get_credential(self.id, "appid")

    # 与标准版共用：先看极速版自己的槽，没有就回落到标准版。
    def _secret_id(self) -> str | None:
        return get_credential(self.id, "secret_id") or get_credential(
            SHARED_CREDENTIAL_PROVIDER_ID, "secret_id"
        )

    def _secret_key(self) -> str | None:
        return get_credential(self.id, "secret_key") or get_credential(
            SHARED_CREDENTIAL_PROVIDER_ID, "secret_key"
        )

    def is_configured(self) -> bool:
        return bool(self._appid() and self._secret_id() and self._secret_key())

    def _build_request(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        appid: str,
        secret_id: str,
        secret_key: str,
    ) -> tuple[str, dict[str, str], bytes]:
        """组装一次请求所需的 (url, headers, body)，不做网络调用（便于测试）。

        URL 里已经带好按字典序排好的 query 串，与签名原文的 query 部分逐字相同；
        所以发请求时不再另传 params，避免两处顺序不一致。
        """
        body = audio_path.read_bytes()
        if not body:
            raise ProviderError("音频文件是空的", code="empty_result")
        if len(body) > MAX_BODY_BYTES:
            limit_mb = MAX_BODY_BYTES // 1024 // 1024
            limit_hours = MAX_DURATION_SECONDS // 3600
            raise ProviderError(
                f"这段音频 {len(body) / 1024 / 1024:.1f}MB，超过极速版单文件 {limit_mb}MB 的"
                f"上限（另有 {limit_hours} 小时时长上限）。极速版不会自动压缩音频，"
                "可以剪成几段分别转录，或自行压到上限以内。",
                code="file_too_large",
            )

        engine_type = ENGINE_TYPE_BY_LANG.get(
            options.language_code or "zho", DEFAULT_ENGINE_TYPE
        )
        params = {
            "secretid": secret_id,
            "engine_type": engine_type,
            "voice_format": voice_format_for(original_filename),
            "timestamp": str(int(time.time())),
            "speaker_diarization": "1" if options.diarize else "0",
            "word_info": "1",  # 词级时间戳，不含标点
            "first_channel_only": "1",
        }
        headers = {
            "Authorization": sign(appid, params, secret_key),
            "Content-Type": "application/octet-stream",
        }
        return request_url(appid, params), headers, body

    def _post(self, url: str, headers: dict[str, str], body: bytes) -> dict:
        """唯一发 HTTP 的地方；测试可替换掉它。

        超时按「连不上 / 传不完 / 等不到」分别翻译成不同错误码，前端才能给出对症的建议；
        不再把三类失败一律说成「连不上腾讯云」。
        """
        try:
            with httpx.Client(timeout=flash_timeout(), trust_env=_TRUST_PROXY) as client:
                response = client.post(url, headers=headers, content=body)
        except (httpx.ConnectTimeout, httpx.ConnectError, httpx.PoolTimeout) as error:
            raise ProviderError(
                f"连不上腾讯云（{FLASH_CONNECT_TIMEOUT_SECONDS} 秒内没建立起连接），"
                "请检查网络或代理后重试",
                code="network",
                raw=str(error),
            ) from error
        except httpx.WriteTimeout as error:
            raise ProviderError(
                f"音频传到腾讯云时超时（{FLASH_WRITE_TIMEOUT_SECONDS // 60} 分钟没能传完）。"
                "音频越大、上行带宽越慢越容易发生；可以先把音频压小或剪短再试。",
                code="upload_timeout",
                raw=str(error),
            ) from error
        except httpx.ReadTimeout as error:
            raise ProviderError(
                f"等腾讯云极速版返回结果超过 {FLASH_READ_TIMEOUT_SECONDS // 60} 分钟。"
                "极速版是同步接口：上传和等待压在同一个请求里，音频越长越容易等不到。"
                "换成异步提交的引擎（提交后由本地轮询取结果）会稳得多。",
                code="response_timeout",
                raw=str(error),
            ) from error
        except httpx.HTTPError as error:
            raise ProviderError(
                "与腾讯云的连接中断（还没拿到结果），请检查网络或代理后重试",
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
            raise ProviderError(
                f"腾讯云极速版返回 HTTP {response.status_code}",
                code="upstream_error",
                raw=json.dumps(data, ensure_ascii=False)[:2000],
            )
        return data

    def transcribe(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        existing_speakers: list[Speaker] | None = None,
    ) -> Transcript:
        appid = self._appid()
        secret_id = self._secret_id()
        secret_key = self._secret_key()
        if not (appid and secret_id and secret_key):
            raise ProviderError(
                "请先在设置里填写腾讯云极速版的 AppID"
                "（SecretId / SecretKey 留空即可沿用标准版那套）",
                status_code=409,
                code="no_api_key",
            )

        url, headers, body = self._build_request(
            audio_path, original_filename, options, appid, secret_id, secret_key
        )
        data = self._post(url, headers, body)

        error = describe_error(data)
        if error:
            code, message = error
            raise ProviderError(
                message, code=code, raw=json.dumps(data, ensure_ascii=False)[:2000]
            )
        return normalize_flash_result(
            data, original_filename, existing_speakers=existing_speakers
        )
