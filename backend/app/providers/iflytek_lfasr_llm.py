"""科大讯飞录音文件转写（大模型版 / Ifasr_llm）。

接口形态（官方文档 https://xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html）：
  - 鉴权：signature = base64(HmacSHA1(自然排序+Java式URL编码后的查询串, APISecret))
         参与签名的参数：appId / accessKeyId(APIKey) / dateTime / signatureRandom /
         fileSize / fileName / duration* / language 等（除 signature 本身外全部 query 参数）
  - accessKeyId 即开放平台应用的 APIKey，accessKeySecret 即 APISecret
  - 流程：/v2/upload 上传（返回 orderId）-> /v2/getResult 轮询直到 status=4
  - 音频：文件流模式，原始字节放 body（application/octet-stream），signature 放请求头
  - 返回：orderResult 是 JSON 字符串，结构与标准版一致（lattice[].json_1best），
         故直接复用 iflytek_lfasr.normalize_lfasr 解析

能力：202 种方言 / 37 个语种免切识别（autodialect / autominor），说话人分离，词级时间戳。
注：本 provider 代码已接入，且用户于 2026-08-31 用免费额度真机转录跑通，故 experimental=False。
"""

import base64
import hashlib
import hmac
import json
import os
import random
import string
import time
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import ClassVar

import httpx

from ..models import Speaker, Transcript, TranscriptionOptions
from ..settings import get_credential
from .base import Capabilities, CredentialField, ProviderError, TranscriptionProvider
from .iflytek_lfasr import normalize_lfasr

# 大模型版接口域名。官方文档（https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html）给出的请求地址。
IFLYTEK_LLM_UPLOAD_URL = "https://office-api-ist-dx.iflyaisol.com/v2/upload"
IFLYTEK_LLM_RESULT_URL = "https://office-api-ist-dx.iflyaisol.com/v2/getResult"

# 轮询参数：讯飞承诺有效任务最大 5 小时，这里给足时间。
POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 1800

# 内部语言码（ISO-639-3）-> 大模型版的 language 参数：
#   autodialect：中英 + 202 种方言免切；autominor：37 个语种免切（部分需单独付费）。
LANGUAGE_BY_CODE = {
    "zho": "autodialect",
    "yue": "autodialect",
    "tib": "autodialect",
    "eng": "autominor",
    "jpn": "autominor",
    "kor": "autominor",
    "rus": "autominor",
    "fra": "autominor",
    "deu": "autominor",
    "spa": "autominor",
    "ita": "autominor",
    "ara": "autominor",
    "vie": "autominor",
    "tha": "autominor",
    "por": "autominor",
    "hin": "autominor",
}
DEFAULT_LANGUAGE = "autodialect"

# 默认不走环境里的 HTTP/HTTPS 代理直连讯飞（本地开发机的代理常不稳定，
# 反而会让请求失败）。若你确实处于必须用代理才能上网的环境，设
# TRANSCRIPTION_TRUST_PROXY=1 即可恢复代理。
_TRUST_PROXY = os.environ.get("TRANSCRIPTION_TRUST_PROXY") == "1"


def _encode_value(value: str) -> str:
    """模仿 Java URLEncoder.encode(value, "UTF-8")：空格->'+'，保留 A-Za-z0-9-_.!*'()。"""
    return urllib.parse.quote(str(value), safe="-_.!*'()").replace("%20", "+")


def _build_query(params: dict) -> str:
    """按 key 自然排序，空值跳过，value 做 Java 式 URL 编码，拼接成 query 串。"""
    pairs = []
    for key in sorted(params.keys()):
        value = params[key]
        if value is None or value == "":
            continue
        pairs.append(f"{key}={_encode_value(value)}")
    return "&".join(pairs)


def _make_signature(api_secret: str, params: dict) -> str:
    """讯飞大模型版签名：base64(HmacSHA1(排序编码后的 query 串, APISecret))。"""
    base = _build_query(params)
    digest = hmac.new(
        api_secret.encode("utf-8"), base.encode("utf-8"), hashlib.sha1
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def _now_iso() -> str:
    """本地时区时间戳，形如 2025-09-08T22:58:29+0800（与 %z 一致）。"""
    return datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")


def _random_signature_random() -> str:
    """16 位大小写字母+数字组合。"""
    alphabet = string.ascii_letters + string.digits
    return "".join(random.choices(alphabet, k=16))


def _describe_llm_error(code: str) -> tuple[str, str] | None:
    """把大模型版业务错误码翻译成（code, 中文说明）。无错误返回 None。"""
    mapping: dict[str, tuple[str, str]] = {
        "000001": ("bad_request", "讯飞认为请求参数不完整或有误，请检查后重试"),
        "000002": ("invalid_api_key", "讯飞拒绝了这次请求：APIKey（accessKeyId）不存在"),
        "100003": ("bad_request", "讯飞认为请求参数有误，请检查后重试"),
        "100007": ("permission", "讯飞返回权限错误，请确认该应用已开通「录音文件转写大模型」服务"),
        "100008": ("bad_request", "讯飞签名异常：请求时间超过限制，请检查本机系统时间与时区是否准确"),
        "100009": ("invalid_api_key", "讯飞签名校验不通过，请确认 APISecret 填写正确"),
        "100012": ("rate_limited", "讯飞接口访问频率受限，请稍后重试"),
        "100013": ("upstream_error", "讯飞订单尚未完成，查询过早，请稍后重试"),
        "100029": ("bad_request", "讯飞提示文件已存在，请勿重复上传同一音频"),
        "100030": ("unsupported_format", "讯飞无法识别该音频格式，请换 mp3/wav/opus/m4a 等常见格式"),
        "100033": ("bad_request", "讯飞认为角色分离人数无效（应为 0-10）"),
        "100037": ("bad_request", "讯飞认为订单号非法，请重试"),
        "100042": ("bad_request", "讯飞认为外链地址无效（未使用外链可忽略）"),
        "999999": ("upstream_error", "讯飞返回未知异常，请稍后重试或联系讯飞技术支持"),
    }
    if code in mapping:
        return mapping[code]
    return None


class IflytekLlmProvider(TranscriptionProvider):
    """科大讯飞录音文件转写（大模型版）。202 方言 / 37 语种免切，说话人分离与词级时间戳。"""

    id = "iflytek_llm"
    name = "科大讯飞录音文件转写（大模型版）"
    experimental = False  # 用户已用免费额度真机跑通（2026-08-31）
    capabilities = Capabilities(
        diarization=True,
        language_selection=True,
        speaker_count_hint=True,
        audio_events=False,
        word_timestamps=True,
        max_duration_seconds=5 * 3600,
        max_file_bytes=500 * 1024 * 1024,
    )
    models: ClassVar[list[str]] = ["lfasr_llm"]
    credential_fields: ClassVar[list[CredentialField]] = [
        CredentialField(key="app_id", label="APPID", secret=False),
        CredentialField(key="api_secret", label="APISecret", secret=True),
        CredentialField(key="api_key", label="APIKey", secret=True),
    ]

    def is_configured(self) -> bool:
        return (
            bool(get_credential(self.id, "app_id"))
            and bool(get_credential(self.id, "api_key"))
            and bool(get_credential(self.id, "api_secret"))
        )

    def _http(self, url: str, headers: dict, body: bytes | None) -> dict:
        try:
            with httpx.Client(
                timeout=httpx.Timeout(120, connect=30), trust_env=_TRUST_PROXY
            ) as client:
                response = client.post(url, content=body, headers=headers)
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
            mapped = _describe_llm_error(raw_code)
            if mapped:
                code, message = mapped
                raise ProviderError(
                    message,
                    response.status_code,
                    code=code,
                    raw=json.dumps(data, ensure_ascii=False),
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
        api_key: str,
        api_secret: str,
    ) -> tuple[str, str]:
        """上传音频，返回 (orderId, signatureRandom)。"""
        language = LANGUAGE_BY_CODE.get(options.language_code or "zho", DEFAULT_LANGUAGE)
        signature_random = _random_signature_random()

        params: dict[str, str] = {
            "appId": app_id,
            "accessKeyId": api_key,
            "dateTime": _now_iso(),
            "signatureRandom": signature_random,
            "fileSize": str(audio_path.stat().st_size),
            "fileName": audio_path.name,
            "durationCheckDisable": "true",  # 关闭时长校验，免去探测音频时长
            "language": language,
            # roleType=1 开启通用角色分离（大模型版 0/1/3）。
            "roleType": "1" if options.diarize else "0",
        }
        if options.diarize and options.num_speakers:
            params["roleNum"] = str(options.num_speakers)

        signature = _make_signature(api_secret, params)
        url = f"{IFLYTEK_LLM_UPLOAD_URL}?{_build_query(params)}"
        headers = {
            "Content-Type": "application/octet-stream",
            "signature": signature,
        }
        body = audio_path.read_bytes()
        data = self._http(url, headers, body)
        order_id = (data.get("content") or {}).get("orderId")
        if not order_id:
            raise ProviderError(
                "讯飞创建转写任务失败，未返回 orderId",
                code="upstream_error",
                raw=json.dumps(data, ensure_ascii=False),
            )
        return str(order_id), signature_random

    def _fetch_result(
        self, order_id: str, signature_random: str, app_id: str, api_key: str, api_secret: str
    ) -> dict:
        deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            params = {
                "accessKeyId": api_key,
                "dateTime": _now_iso(),
                "signatureRandom": signature_random,
                "orderId": order_id,
                "resultType": "transfer",
            }
            signature = _make_signature(api_secret, params)
            url = f"{IFLYTEK_LLM_RESULT_URL}?{_build_query(params)}"
            headers = {
                "Content-Type": "application/json",
                "signature": signature,
            }
            data = self._http(url, headers, b"{}")
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
            time.sleep(POLL_INTERVAL_SECONDS)
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
        api_key = get_credential(self.id, "api_key")
        api_secret = get_credential(self.id, "api_secret")
        if not app_id or not api_key or not api_secret:
            raise ProviderError(
                "请先在设置里填写科大讯飞的 APPID、APIKey 与 APISecret",
                status_code=409,
                code="no_api_key",
            )

        order_id, signature_random = self._upload_task(
            audio_path, options, app_id, api_key, api_secret
        )
        content = self._fetch_result(
            order_id, signature_random, app_id, api_key, api_secret
        )
        order_result = content.get("orderResult")
        if not order_result:
            raise ProviderError(
                "讯飞任务已完成但未返回转写内容",
                code="bad_response",
                raw=json.dumps(content, ensure_ascii=False),
            )
        # 大模型版 orderResult 的 lattice 结构与标准版一致，直接复用解析。
        return normalize_lfasr(
            order_result, original_filename, existing_speakers=existing_speakers
        )
