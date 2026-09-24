"""科大讯飞录音文件转写（标准版 / LFASR）。

接口形态（官方文档 https://xfyun.cn/doc/asr/ifasr_new/API.html）：
  - 鉴权：signa = base64(HmacSHA1(MD5(appId + ts), secretKey))
  - 流程：/v2/api/upload 上传（返回 orderId）-> /v2/api/getResult 轮询直到 status=4
  - 音频：文件流模式，参数拼在 URL query，音频原始字节放 body（application/octet-stream）
  - 返回：orderResult 是一个 JSON 字符串，内含 lattice[]，每项 json_1best 又是一层 JSON
         （st.bg/ed 毫秒、st.rt[].ws[].cw[].w 词文本、wb/we 相对 bg 的帧数、外层 spk 为角色标签）

能力：中文 / 粤语 / 藏语 / 英文等，说话人分离（roleType/roleNum），词级时间戳。
注：本 provider 代码已接入、但作者无云端密钥未做真机验收，故 experimental=True，
    等用户用真实密钥跑通一次后翻回 False。
"""

import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import ClassVar

import httpx

from ..models import AudioInfo, Segment, Speaker, Transcript, TranscriptionOptions, Word
from ..settings import get_credential
from .base import Capabilities, CredentialField, ProviderError, TranscriptionProvider

IFLYTEK_UPLOAD_URL = "https://raasr.xfyun.cn/v2/api/upload"
IFLYTEK_RESULT_URL = "https://raasr.xfyun.cn/v2/api/getResult"

# 轮询参数：讯飞承诺有效任务最大 5 小时，这里给足时间。
POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 1800

# 内部语言码（ISO-639-3）-> 讯飞 language 参数。
LANGUAGE_BY_CODE = {
    "zho": "cn",
    "eng": "en",
    "yue": "cn_cantonese",
    "tib": "cn_tibetan",
}
DEFAULT_LANGUAGE = "cn"

# 默认不走环境里的 HTTP/HTTPS 代理直连讯飞（本地开发机的代理常不稳定，
# 反而会让请求失败）。若你确实处于必须用代理才能上网的环境，设
# TRANSCRIPTION_TRUST_PROXY=1 即可恢复代理。
_TRUST_PROXY = os.environ.get("TRANSCRIPTION_TRUST_PROXY") == "1"


def _make_signa(app_id: str, secret_key: str, ts: int) -> str:
    """讯飞签名：base64(HmacSHA1(MD5(appId + ts), secretKey))。"""
    base = f"{app_id}{ts}"
    md5_hex = hashlib.md5(base.encode("utf-8")).hexdigest()
    digest = hmac.new(
        secret_key.encode("utf-8"), md5_hex.encode("utf-8"), hashlib.sha1
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def _describe_iflytek_error(code: str) -> tuple[str, str] | None:
    """把讯飞业务错误码翻译成（code, 中文说明）。无错误返回 None。"""
    mapping: dict[str, tuple[str, str]] = {
        "26600": ("upstream_error", "讯飞转写服务返回通用错误，请检查请求参数或稍后重试"),
        "26601": ("invalid_api_key", "讯飞拒绝了这次请求：APPID 无效或不存在"),
        "26602": ("upstream_error", "讯飞查询的转写任务不存在，可能订单尚未建立"),
        "26603": ("rate_limited", "讯飞接口访问频率受限，请稍后重试"),
        "26606": ("empty_result", "讯飞认为音频是空文件，请确认音频里有说话声"),
        "26607": ("unsupported_option", "讯飞转写语种未授权或已过期，请在控制台开通对应语种"),
        "26610": ("bad_request", "讯飞认为请求参数有问题，请检查音频格式与参数"),
        "26621": ("file_too_large", "音频文件超过讯飞 500MB 上限，请压缩或切分后再试"),
        "26622": ("too_long", "音频时长超过讯飞 5 小时上限，请切分后再试"),
        "26625": ("quota_exceeded", "讯飞转写免费时长已用尽，请到控制台购买或领取时长包"),
        "26631": ("file_too_large", "音频文件超过讯飞 500MB 上限，请压缩或切分后再试"),
        "26632": ("too_long", "音频时长超过讯飞 5 小时上限，请切分后再试"),
        "26633": ("quota_exceeded", "讯飞转写免费时长已用尽，请到控制台购买或领取时长包"),
        "26643": ("unsupported_format", "讯飞无法计算音频时长，音频可能加密或损坏，请换一份干净的音频"),
    }
    if code in mapping:
        return mapping[code]
    if code.startswith("266"):
        return "upstream_error", f"讯飞返回错误码 {code}"
    return None


def _probe_duration_ms(audio_path: Path) -> int:
    """尽力探测音频时长（毫秒）。没有 ffprobe 时回退到 0——讯飞文档说明 duration
    当前未做严格校验，传 0 一般也能过；但我们优先用真实时长以免日后收紧校验。"""
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
                str(audio_path),
            ],
            capture_output=True,
            check=False,
            timeout=30,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return 0
    if proc.returncode != 0:
        return 0
    try:
        return int(float(proc.stdout.decode("utf-8", errors="replace").strip()) * 1000)
    except ValueError:
        return 0


def normalize_lfasr(
    order_result: str,
    audio_filename: str,
    existing_speakers: list[Speaker] | None = None,
) -> Transcript:
    """把讯飞的 orderResult JSON 字符串归一化为内部 Transcript。

    每一条 lattice 是一段（一句话），json_1best 内含 st.bg/ed（毫秒）与 rt[].ws[].cw[]
    （词文本 w、相对 bg 的帧数 wb/we，1 帧 = 10ms）。外层 spk 形如「段落-0」对应角色。
    """
    existing_names = {speaker.id: speaker.name for speaker in existing_speakers or []}
    speaker_ids: list[str] = []
    segments: list[Segment] = []

    try:
        parsed = json.loads(order_result)
    except (ValueError, TypeError) as error:
        raise ProviderError(
            "讯飞返回的转写结果无法解析", code="bad_response", raw=str(error)
        ) from error

    lattice = parsed.get("lattice") or []
    for index, item in enumerate(lattice):
        if not isinstance(item, dict):
            continue
        raw_inner = item.get("json_1best")
        if not raw_inner:
            continue
        try:
            st = json.loads(raw_inner)["st"]
        except (ValueError, TypeError, KeyError):
            continue

        bg = int(st.get("bg", 0) or 0)
        ed = int(st.get("ed", bg) or bg)

        # 角色标签：标准版在 lattice[].spk（「段落-N」，0 起）；大模型版在
        # json_1best.st.rl（正整数角色编号，1 起）。统一映射成 0 起的 spk_N。
        speaker_id = "spk_0"
        spk_label = item.get("spk")
        if isinstance(spk_label, str) and spk_label.strip():
            match = re.search(r"\d+", spk_label)
            if match:
                speaker_id = f"spk_{match.group()}"
        elif isinstance(st, dict):
            rl = st.get("rl")
            if rl is not None and str(rl).strip() != "":
                match = re.search(r"\d+", str(rl))
                if match:
                    speaker_id = f"spk_{max(0, int(match.group()) - 1)}"
        if speaker_id not in speaker_ids:
            speaker_ids.append(speaker_id)

        raw_words: list[tuple[str, int, int]] = []  # (text, wb, we)
        text_parts: list[str] = []
        for rt in st.get("rt", []) or []:
            if not isinstance(rt, dict):
                continue
            for ws in rt.get("ws", []) or []:
                if not isinstance(ws, dict):
                    continue
                for cw in ws.get("cw", []) or []:
                    if not isinstance(cw, dict):
                        continue
                    word_text = str(cw.get("w") or "")
                    if not word_text:
                        continue
                    wb = int(cw.get("wb", 0) or 0)
                    we = int(cw.get("we", wb) or wb)
                    raw_words.append((word_text, wb, we))
                    text_parts.append(word_text)

        text = "".join(text_parts)
        if not text:
            continue

        # wb/we 是相对 bg 的偏移，单位 10ms（标准版协议）。若接口（如大模型版）
        # 不返回可靠的词级起止（全部零宽），按词在段内的累计字符比例线性插值，
        # 保证词级时间戳递增且覆盖段时间窗——否则前端字级高亮/从光标播放
        # 会全部退化为「段开头」。
        if any(we > wb for _, wb, we in raw_words):
            word_items = [
                Word(
                    text=wtext,
                    start=(bg + wb * 10) / 1000.0,
                    end=(bg + we * 10) / 1000.0,
                    speaker_id=speaker_id,
                )
                for wtext, wb, we in raw_words
            ]
        else:
            span = max(0, ed - bg)
            total_chars = sum(len(wt) for wt, _, _ in raw_words) or 1
            consumed = 0
            word_items = []
            for wtext, _, _ in raw_words:
                start_ms = bg + span * (consumed / total_chars)
                consumed += len(wtext)
                end_ms = bg + span * (consumed / total_chars)
                word_items.append(
                    Word(
                        text=wtext,
                        start=start_ms / 1000.0,
                        end=end_ms / 1000.0,
                        speaker_id=speaker_id,
                    )
                )

        segments.append(
            Segment(
                id=f"seg_{index + 1:06d}",
                speaker_id=speaker_id,
                start=bg / 1000.0,
                end=max(bg, ed) / 1000.0,
                text=text,
                words=word_items or None,
            )
        )

    if not segments:
        return Transcript(
            audio=AudioInfo(filename=audio_filename, duration=0.0),
            speakers=[],
            segments=[],
        )

    speakers = [
        Speaker(
            id=speaker_id,
            name=existing_names.get(speaker_id, f"说话人 {i + 1}"),
        )
        for i, speaker_id in enumerate(speaker_ids)
    ]
    duration = max((segment.end for segment in segments), default=0.0)
    return Transcript(
        audio=AudioInfo(filename=audio_filename, duration=duration),
        speakers=speakers,
        segments=segments,
    )


class IflytekLfasrProvider(TranscriptionProvider):
    """科大讯飞录音文件转写（标准版）。中文强、支持说话人分离与词级时间戳。"""

    id = "iflytek"
    name = "科大讯飞录音文件转写（标准版）"
    experimental = True  # 已接入但无密钥未做真机验收，等用户跑通后翻 False
    capabilities = Capabilities(
        diarization=True,
        language_selection=True,
        speaker_count_hint=True,
        audio_events=False,
        word_timestamps=True,
        max_duration_seconds=5 * 3600,
        max_file_bytes=500 * 1024 * 1024,
    )
    models: ClassVar[list[str]] = ["lfasr_standard"]
    credential_fields: ClassVar[list[CredentialField]] = [
        CredentialField(key="app_id", label="APPID", secret=False),
        CredentialField(key="secret_key", label="密钥 SecretKey", secret=True),
    ]

    def is_configured(self) -> bool:
        return bool(get_credential(self.id, "app_id")) and bool(
            get_credential(self.id, "secret_key")
        )

    def _http(self, url: str, params: dict, body: bytes | None) -> dict:
        headers = {"Content-Type": "application/octet-stream"} if body is not None else {}
        try:
            with httpx.Client(timeout=httpx.Timeout(120, connect=30), trust_env=_TRUST_PROXY) as client:
                response = client.post(url, params=params, content=body, headers=headers)
        except httpx.HTTPError as error:
            raise ProviderError(
                "连不上讯飞，请检查网络（或代理）后重试", code="network", raw=str(error)
            ) from error

        try:
            data = response.json()
        except ValueError:
            raise ProviderError(
                "讯飞返回了无法识别的数据格式", code="bad_response", raw=response.text
            )

        if response.status_code != 200 or data.get("code") != "000000":
            raw_code = str(data.get("code", ""))
            mapped = _describe_iflytek_error(raw_code)
            if mapped:
                code, message = mapped
                raise ProviderError(
                    message, response.status_code, code=code, raw=json.dumps(data, ensure_ascii=False)
                )
            raise ProviderError(
                f"讯飞返回错误：{data.get('descInfo') or raw_code}",
                response.status_code,
                code="upstream_error",
                raw=json.dumps(data, ensure_ascii=False),
            )
        return data

    def _upload_task(
        self,
        audio_path: Path,
        options: TranscriptionOptions,
        app_id: str,
        secret_key: str,
    ) -> str:
        ts = int(time.time())
        signa = _make_signa(app_id, secret_key, ts)
        language = LANGUAGE_BY_CODE.get(options.language_code or "zho", DEFAULT_LANGUAGE)

        params: dict[str, str] = {
            "appId": app_id,
            "ts": str(ts),
            "signa": signa,
            "fileName": audio_path.name,
            "fileSize": str(audio_path.stat().st_size),
            "duration": str(_probe_duration_ms(audio_path)),
            "language": language,
            # roleType=1 开启角色分离；大模型版支持 0/1/3，标准版 0/1。
            "roleType": "1" if options.diarize else "0",
        }
        if options.diarize and options.num_speakers:
            params["roleNum"] = str(options.num_speakers)

        body = audio_path.read_bytes()
        data = self._http(IFLYTEK_UPLOAD_URL, params, body)
        order_id = (data.get("content") or {}).get("orderId")
        if not order_id:
            raise ProviderError(
                "讯飞创建转写任务失败，未返回 orderId",
                code="upstream_error",
                raw=json.dumps(data, ensure_ascii=False),
            )
        return str(order_id)

    def _fetch_result(
        self, order_id: str, app_id: str, secret_key: str
    ) -> dict:
        import time as _time

        deadline = _time.monotonic() + POLL_TIMEOUT_SECONDS
        while _time.monotonic() < deadline:
            ts = int(_time.time())
            signa = _make_signa(app_id, secret_key, ts)
            params = {
                "appId": app_id,
                "ts": str(ts),
                "signa": signa,
                "orderId": order_id,
            }
            data = self._http(IFLYTEK_RESULT_URL, params, None)
            content = data.get("content") or {}
            order_info = content.get("orderInfo") or {}
            status = int(order_info.get("status", 0))
            if status == 4:  # 完成
                return content
            if status == -1:  # 失败
                fail_type = order_info.get("failType")
                raise ProviderError(
                    f"讯飞转写任务失败（failType={fail_type}）",
                    code="upstream_error",
                    raw=json.dumps(data, ensure_ascii=False),
                )
            _time.sleep(POLL_INTERVAL_SECONDS)
        raise ProviderError(
            "讯飞转写任务轮询超时（超过 30 分钟仍未完成）", code="timeout"
        )

    def transcribe(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        existing_speakers: list[Speaker] | None = None,
    ) -> Transcript:
        app_id = get_credential(self.id, "app_id")
        secret_key = get_credential(self.id, "secret_key")
        if not app_id or not secret_key:
            raise ProviderError(
                "请先在设置里填写科大讯飞的 APPID 和 SecretKey",
                status_code=409,
                code="no_api_key",
            )

        order_id = self._upload_task(audio_path, options, app_id, secret_key)
        content = self._fetch_result(order_id, app_id, secret_key)
        order_result = content.get("orderResult")
        if not order_result:
            raise ProviderError(
                "讯飞任务已完成但未返回转写内容",
                code="bad_response",
                raw=json.dumps(content, ensure_ascii=False),
            )
        return normalize_lfasr(
            order_result, original_filename, existing_speakers=existing_speakers
        )
