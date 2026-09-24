"""腾讯云录音文件识别极速版：签名、参数组装、结果归一化与错误码映射。

签名部分用官方文档 4.5 节给出的示例原文做「逐字」断言 —— 文档里的 appid/密钥被打了
星号遮蔽，所以那个公布的摘要求值无法复现，但**签名原文（拼接方式与排序）是可以逐字对齐
的**，而拼错排序或漏掉分隔符正是这类签名最容易出错的地方。
"""

import base64
import hashlib
import hmac
import json
from typing import Self
from urllib.parse import parse_qsl, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

import app.providers.tencent_flash as flash_module
from app import settings
from app.main import app
from app.models import Speaker, TranscriptionOptions
from app.providers.base import ProviderError
from app.providers.registry import PROVIDERS
from app.providers.tencent_flash import (
    FLASH_HOST,
    MAX_BODY_BYTES,
    MAX_DURATION_SECONDS,
    TencentFlashProvider,
    as_query_string,
    describe_error,
    normalize_flash_result,
    request_url,
    sign,
    signature_source,
    voice_format_for,
)

client = TestClient(app)

# 官方文档 4.5 节示例所用的参数与签名原文（appid 在 path 里）。
OFFICIAL_APPID = "125922***"
OFFICIAL_PARAMS = {
    "engine_type": "16k_zh_beta",
    "extra_punc": "0",
    "filter_punc": "0",
    "first_channel_only": "1",
    "hotword_id": "584f4d0060d811ed85da525400aec391",
    "reinforce_hotword": "0",
    "secretid": "*****Qq1zhZMN8dv0******",
    "speaker_diarization": "0",
    "timestamp": "1673426168",
    "voice_format": "wav",
    "word_info": "1",
}
OFFICIAL_SOURCE = (
    "POSTasr.cloud.tencent.com/asr/flash/v1/125922***?engine_type=16k_zh_beta"
    "&extra_punc=0&filter_punc=0&first_channel_only=1"
    "&hotword_id=584f4d0060d811ed85da525400aec391&reinforce_hotword=0"
    "&secretid=*****Qq1zhZMN8dv0******&speaker_diarization=0"
    "&timestamp=1673426168&voice_format=wav&word_info=1"
)


def _sample_response() -> dict:
    """官方文档 4.7 节的返回示例。"""
    return {
        "request_id": "6098aecab9c686fbfd35adb0",
        "code": 0,
        "message": "",
        "audio_duration": 2386,
        "flash_result": [
            {
                "text": "腾讯云智能语音欢迎您。",
                "channel_id": 0,
                "sentence_list": [
                    {
                        "text": "腾讯云智能语音欢迎您。",
                        "start_time": 0,
                        "end_time": 2386,
                        "speaker_id": 0,
                        "word_list": [
                            {"word": "腾讯云", "start_time": 0, "end_time": 780, "stable_flag": 1},
                            {"word": "智能语音", "start_time": 780, "end_time": 1590, "stable_flag": 1},
                            {"word": "欢迎", "start_time": 1590, "end_time": 1950, "stable_flag": 1},
                            {"word": "您", "start_time": 1950, "end_time": 2250, "stable_flag": 1},
                        ],
                    }
                ],
            }
        ],
    }


# --- 签名 -------------------------------------------------------------------


def _sdk_signature_source(appid: str, params: dict[str, str]) -> str:
    """照抄官方 Python SDK（asr/flash_recognizer.py）_format_sign_string 的写法。

    这是一份**独立实现**（来自 SDK 而非文档），用来交叉验证我们拼出来的签名原文：
    appid 只出现在路径里，其余参数按字典序 `key=value` 用 `&` 连接。
    """
    query = sorted({**params, "appid": appid}.items(), key=lambda item: item[0])
    signstr = "POSTasr.cloud.tencent.com/asr/flash/v1/"
    for item in query:
        if "appid" in item:
            signstr += str(item[1])
            break
    signstr += "?"
    for item in query:
        if "appid" in item:
            continue
        signstr += f"{item[0]}={item[1]}&"
    return signstr[:-1]


def test_signature_source_matches_official_sdk_implementation() -> None:
    assert signature_source(OFFICIAL_APPID, OFFICIAL_PARAMS) == _sdk_signature_source(
        OFFICIAL_APPID, OFFICIAL_PARAMS
    )
    # 换一组参数（含真实引擎名与时间戳）再对一次
    params = {"secretid": "AKIDx", "engine_type": "16k_yue", "voice_format": "aac",
              "timestamp": "1789000000", "speaker_diarization": "1", "word_info": "1",
              "first_channel_only": "1"}
    assert signature_source("1259220000", params) == _sdk_signature_source("1259220000", params)
    assert sign("1259220000", params, "skey") == base64.b64encode(
        hmac.new(
            b"skey", _sdk_signature_source("1259220000", params).encode("utf-8"), hashlib.sha1
        ).digest()
    ).decode("ascii")


def test_signature_source_matches_official_example_verbatim() -> None:
    assert signature_source(OFFICIAL_APPID, OFFICIAL_PARAMS) == OFFICIAL_SOURCE


def test_signature_source_sorts_params_regardless_of_insertion_order() -> None:
    shuffled = dict(reversed(list(OFFICIAL_PARAMS.items())))
    assert signature_source(OFFICIAL_APPID, shuffled) == OFFICIAL_SOURCE


def test_sign_uses_hmac_sha1_base64() -> None:
    signature = sign(OFFICIAL_APPID, OFFICIAL_PARAMS, "*****SkqpeHgqmSz*****")
    expected = base64.b64encode(
        hmac.new(
            b"*****SkqpeHgqmSz*****", OFFICIAL_SOURCE.encode("utf-8"), hashlib.sha1
        ).digest()
    ).decode("ascii")
    assert signature == expected
    # SHA-1 摘要 20 字节；SHA-256 会是 32 字节（标准版用的才是 SHA-256）。
    assert len(base64.b64decode(signature)) == 20


def test_signature_changes_with_secret_and_params() -> None:
    base = sign(OFFICIAL_APPID, OFFICIAL_PARAMS, "secret-a")
    assert base != sign(OFFICIAL_APPID, OFFICIAL_PARAMS, "secret-b")
    assert base != sign("125922000", OFFICIAL_PARAMS, "secret-a")
    assert base != sign(OFFICIAL_APPID, {**OFFICIAL_PARAMS, "word_info": "0"}, "secret-a")


def test_request_url_is_signature_source_without_post_prefix() -> None:
    """官方 SDK 直接拿签名原文当 URL（requrl = "https://" + signstr[4:]），这里照做。"""
    url = request_url(OFFICIAL_APPID, OFFICIAL_PARAMS)
    assert url == "https://" + OFFICIAL_SOURCE[len("POST") :]
    assert url.startswith("https://asr.cloud.tencent.com/asr/flash/v1/125922***?")


# --- 格式推断 ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("x.m4a", "m4a"),
        ("x.M4A", "m4a"),
        ("田燕燕_20200518.aac", "aac"),
        ("x.wav", "wav"),
        ("x.mp3", "mp3"),
        ("x.ogg", "ogg-opus"),
        ("x.opus", "ogg-opus"),
        ("x.silk", "silk"),
        ("x.speex", "speex"),
        ("x.amr", "amr"),
        ("x.pcm", "pcm"),
    ],
)
def test_voice_format_by_extension(filename: str, expected: str) -> None:
    assert voice_format_for(filename) == expected


@pytest.mark.parametrize("filename", ["x.flac", "x.mp4", "x.wma", "x", "x.3gp"])
def test_unsupported_extension_raises_clear_error(filename: str) -> None:
    with pytest.raises(ProviderError) as excinfo:
        voice_format_for(filename)
    assert excinfo.value.code == "unsupported_format"
    # 报错里要写清支持哪些格式，用户才知道下一步怎么做。
    assert "不支持" in str(excinfo.value)


# --- 错误码 -----------------------------------------------------------------


def test_describe_error_returns_none_on_success() -> None:
    assert describe_error(_sample_response()) is None
    assert describe_error({"code": 0, "message": ""}) is None


@pytest.mark.parametrize(
    ("code", "expected_code"),
    [
        (4001, "bad_request"),
        (4002, "invalid_api_key"),
        (4003, "service_not_enabled"),
        (4004, "quota_exceeded"),
        (4005, "quota_exceeded"),
        (4006, "rate_limited"),
        (4007, "unsupported_format"),
        (4008, "network"),
        (4009, "network"),
        (4010, "bad_request"),
        (4011, "file_too_large"),
        (4012, "empty_result"),
        (5001, "upstream_error"),
        (5002, "upstream_error"),
        (5003, "upstream_error"),
    ],
)
def test_describe_error_maps_documented_codes(code: int, expected_code: str) -> None:
    mapped = describe_error({"code": code, "message": "某条原始说明"})
    assert mapped is not None
    assert mapped[0] == expected_code


def test_describe_error_keeps_raw_message_and_handles_unknown() -> None:
    mapped = describe_error({"code": 4999, "message": "weird"})
    assert mapped is not None
    assert mapped[0] == "upstream_error"
    assert "4999" in mapped[1]
    # code 是字符串也要认
    assert describe_error({"code": "4002", "message": "m"})[0] == "invalid_api_key"
    # 返回体压根不是字典
    assert describe_error(["oops"])[0] == "bad_response"


# --- 归一化 -----------------------------------------------------------------


def test_normalize_flash_result_maps_sentence_and_words() -> None:
    transcript = normalize_flash_result(_sample_response(), "x.m4a")

    assert [segment.text for segment in transcript.segments] == ["腾讯云智能语音欢迎您。"]
    segment = transcript.segments[0]
    assert segment.speaker_id == "spk_0"
    assert segment.start == 0.0
    assert segment.end == 2.386
    # 毫秒要换成秒
    assert segment.words[0].text == "腾讯云"
    assert segment.words[0].end == 0.78
    assert segment.words[3].start == 1.95
    # 音频时长同样来自毫秒
    assert transcript.audio.duration == 2.386
    assert [speaker.name for speaker in transcript.speakers] == ["说话人 1"]


def test_normalize_flash_result_splits_speakers_and_reuses_existing_names() -> None:
    payload = {
        "code": 0,
        "audio_duration": 4200,
        "flash_result": [
            {
                "channel_id": 0,
                "sentence_list": [
                    {"text": "你好。", "start_time": 0, "end_time": 1800, "speaker_id": 0},
                    {"text": "我也很好。", "start_time": 2000, "end_time": 4200, "speaker_id": 1},
                ],
            }
        ],
    }
    transcript = normalize_flash_result(
        payload, "x.wav", existing_speakers=[Speaker(id="spk_1", name="受访者")]
    )

    assert [segment.speaker_id for segment in transcript.segments] == ["spk_0", "spk_1"]
    # 第二个说话人沿用已有名字
    assert [speaker.name for speaker in transcript.speakers] == ["说话人 1", "受访者"]
    assert transcript.audio.duration == 4.2


def test_normalize_flash_result_handles_empty_and_missing_speaker() -> None:
    empty = normalize_flash_result({"code": 0, "flash_result": []}, "x.m4a")
    assert empty.segments == []
    assert empty.speakers == []

    # 没给 speaker_id 时按单说话人 0 处理，不能崩
    payload = {
        "code": 0,
        "flash_result": [{"sentence_list": [{"text": "只有一句。", "start_time": 0, "end_time": 500}]}],
    }
    transcript = normalize_flash_result(payload, "x.m4a")
    assert transcript.segments[0].speaker_id == "spk_0"
    # end 缺失时退化成 start，不会让 Segment 校验失败
    assert transcript.segments[0].end >= transcript.segments[0].start


# --- 引擎元信息 -------------------------------------------------------------


def test_flash_provider_declares_expected_capabilities() -> None:
    provider = TencentFlashProvider()
    assert provider.id == "tencent_flash"
    assert "极速版" in provider.name
    assert provider.capabilities.diarization is True
    assert provider.capabilities.word_timestamps is True
    assert provider.capabilities.language_selection is True
    # 极速版没有 speaker_number 参数，不该给用户看「预计说话人数」
    assert provider.capabilities.speaker_count_hint is False
    assert provider.capabilities.max_file_bytes == MAX_BODY_BYTES == 100 * 1024 * 1024
    assert provider.capabilities.max_duration_seconds == 2 * 3600
    # 尚未真机验收
    assert provider.experimental is True


def test_flash_provider_is_registered() -> None:
    assert "tencent_flash" in PROVIDERS
    assert isinstance(PROVIDERS["tencent_flash"], TencentFlashProvider)


def test_providers_endpoint_exposes_flash_engine() -> None:
    response = client.get("/api/providers")
    assert response.status_code == 200
    body = response.json()
    flash = next(item for item in body if item["id"] == "tencent_flash")

    assert flash["name"] == "腾讯云录音文件识别（极速版）"
    assert flash["experimental"] is True
    assert flash["capabilities"]["max_file_bytes"] == 100 * 1024 * 1024
    assert flash["capabilities"]["speaker_count_hint"] is False
    keys = [field["key"] for field in flash["credential_fields"]]
    assert keys == ["appid", "secret_id", "secret_key"]
    # AppID 不是密钥，用明文框；两个密钥字段仍走密码框，且都不强制（可沿用标准版）。
    assert [field["secret"] for field in flash["credential_fields"]] == [False, True, True]
    assert [field["required"] for field in flash["credential_fields"]] == [True, False, False]


def test_flash_needs_own_appid_but_shares_standard_secrets(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    provider = TencentFlashProvider()

    # 只有标准版密钥（用户现有状态）：极速版还不算配置好，因为缺 AppID。
    settings.save_credentials("tencent_cloud", {"secret_id": "AKIDx", "secret_key": "secretx"})
    assert provider._secret_id() == "AKIDx"
    assert provider._secret_key() == "secretx"
    assert provider.is_configured() is False

    # 只补一个 AppID 即可用 —— 不用把两个密钥再抄一遍。
    settings.save_credentials("tencent_flash", {"appid": "125922"})
    assert provider._appid() == "125922"
    assert provider.is_configured() is True

    # 极速版自己的槽优先于标准版。
    settings.save_credentials("tencent_flash", {"secret_id": "OWNID"})
    assert provider._secret_id() == "OWNID"


# --- 全链路（不发真实请求）--------------------------------------------------


def test_flash_full_flow_builds_signed_request_and_normalizes(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_cloud", {"secret_id": "AKIDx", "secret_key": "secretx"})
    settings.save_credentials("tencent_flash", {"appid": "125922"})

    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"fake audio bytes")

    provider = TencentFlashProvider()
    captured: dict = {}

    def fake_post(url, headers, body):
        captured.update(url=url, headers=headers, body=body)
        return _sample_response()

    monkeypatch.setattr(provider, "_post", fake_post)

    transcript = provider.transcribe(
        audio, "x.m4a", TranscriptionOptions(), existing_speakers=None
    )

    # 地址：appid 只在路径里（与官方 SDK 的 _format_sign_string 一致）
    parsed = urlparse(captured["url"])
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == (
        f"https://{FLASH_HOST}/asr/flash/v1/125922"
    )
    params = dict(parse_qsl(parsed.query))
    assert "appid" not in params
    # query 串必须是字典序，且与签名原文的 query 部分逐字一致（官方 SDK 直接拿签名原文当 URL）
    assert parsed.query == as_query_string(params)
    assert captured["url"].endswith(f"?{as_query_string(params)}")

    assert params["engine_type"] == "16k_zh"
    assert params["voice_format"] == "m4a"
    assert params["secretid"] == "AKIDx"  # 沿用了标准版密钥
    assert params["speaker_diarization"] == "1"  # 默认开启分离
    assert params["word_info"] == "1"
    assert int(params["timestamp"]) > 0

    # 音频原始字节走 body：不 base64、不压缩
    assert captured["body"] == b"fake audio bytes"
    assert captured["headers"]["Content-Type"] == "application/octet-stream"
    # 签名必须与实际发出的这串 query 完全对应
    assert captured["headers"]["Authorization"] == sign("125922", params, "secretx")

    assert [segment.text for segment in transcript.segments] == ["腾讯云智能语音欢迎您。"]
    assert transcript.audio.duration == 2.386


def test_flash_full_flow_honours_language_and_diarize_options(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_flash", {"appid": "1", "secret_id": "a", "secret_key": "b"})
    audio = tmp_path / "x.wav"
    audio.write_bytes(b"data")

    provider = TencentFlashProvider()
    captured: dict = {}
    monkeypatch.setattr(
        provider,
        "_post",
        lambda url, headers, body: (
            captured.update(url=url) or {"code": 0, "flash_result": []}
        ),
    )

    provider.transcribe(
        audio,
        "x.wav",
        TranscriptionOptions(language_code="yue", diarize=False),
        existing_speakers=None,
    )
    params = dict(parse_qsl(urlparse(captured["url"]).query))
    assert params["engine_type"] == "16k_yue"
    assert params["speaker_diarization"] == "0"


def test_flash_transcribe_surfaces_upstream_error_with_raw(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_flash", {"appid": "1", "secret_id": "a", "secret_key": "b"})
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"data")

    provider = TencentFlashProvider()
    payload = {"code": 4003, "message": "AppID not enabled", "request_id": "r1"}
    monkeypatch.setattr(provider, "_post", lambda *args: payload)

    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.m4a", TranscriptionOptions(), existing_speakers=None)
    assert excinfo.value.code == "service_not_enabled"
    # 原始返回要保留下来，供「复制错误信息」排查
    assert json.loads(excinfo.value.raw)["message"] == "AppID not enabled"


def test_flash_requires_credentials_before_calling_api(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"data")

    provider = TencentFlashProvider()
    called = {"post": False}
    monkeypatch.setattr(
        provider, "_post", lambda *args: called.update(post=True) or {"code": 0}
    )

    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.m4a", TranscriptionOptions(), existing_speakers=None)
    assert excinfo.value.code == "no_api_key"
    assert excinfo.value.status_code == 409
    assert called["post"] is False


def test_flash_limits_match_official_documentation() -> None:
    """上限取自官方文档：Body ≤100MB、时长 ≤2 小时；对外声明的 capabilities 必须同源。"""
    assert MAX_BODY_BYTES == 100 * 1024 * 1024
    assert MAX_DURATION_SECONDS == 2 * 3600
    capabilities = TencentFlashProvider().capabilities
    assert capabilities.max_file_bytes == MAX_BODY_BYTES
    assert capabilities.max_duration_seconds == MAX_DURATION_SECONDS


def test_flash_rejects_oversized_audio_without_uploading(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_flash", {"appid": "1", "secret_id": "a", "secret_key": "b"})
    # 把上限临时压到 1MB，免得为了造一个超限文件往磁盘写 100MB。
    monkeypatch.setattr(flash_module, "MAX_BODY_BYTES", 1024 * 1024)

    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"\0" * (1024 * 1024 + 1))

    provider = TencentFlashProvider()
    used = {"post": False}
    monkeypatch.setattr(
        provider, "_post", lambda *args: used.update(post=True) or {"code": 0}
    )

    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.m4a", TranscriptionOptions(), existing_speakers=None)
    message = str(excinfo.value)
    assert excinfo.value.code == "file_too_large"
    # 必须说清两道线，并讲明极速版不做自动压缩 —— 否则用户会以为压一下就能过，
    # 而这正是标准版与极速版行为不同的地方（标准版超 5MB 会自动压）。
    assert "超过极速版单文件 1MB 的上限" in message
    assert "2 小时时长上限" in message
    assert "不会自动压缩" in message
    # 只讲「怎么办」这一类的办法，不点名推荐某个具体引擎：提示语是给所有用户看的，
    # 不该带上某个人当前的引擎配置（他可能根本没配那家）。
    assert "剪成几段" in message
    assert "科大讯飞" not in message
    assert used["post"] is False


def test_flash_rejects_unsupported_format_before_uploading(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_flash", {"appid": "1", "secret_id": "a", "secret_key": "b"})
    audio = tmp_path / "x.flac"
    audio.write_bytes(b"data")

    provider = TencentFlashProvider()
    monkeypatch.setattr(provider, "_post", lambda *args: {"code": 0})

    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.flac", TranscriptionOptions(), existing_speakers=None)
    assert excinfo.value.code == "unsupported_format"


def test_flash_empty_audio_is_reported_as_empty_result(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_flash", {"appid": "1", "secret_id": "a", "secret_key": "b"})
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"")

    provider = TencentFlashProvider()
    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.m4a", TranscriptionOptions(), existing_speakers=None)
    assert excinfo.value.code == "empty_result"


# --- 超时：三段分开给，且失败原因要能区分 ---------------------------------------


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self) -> dict:
        return self._payload


def _recording_client(monkeypatch, outcome: object) -> dict:
    """替换 httpx.Client，记录构造时收到的 timeout，post 时抛出 outcome（或返回它）。"""
    captured: dict = {}

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *exc: object) -> bool:
            return False

        def post(self, *args: object, **kwargs: object) -> _FakeResponse:
            if isinstance(outcome, Exception):
                raise outcome
            return _FakeResponse(outcome)  # type: ignore[arg-type]

    monkeypatch.setattr(flash_module.httpx, "Client", FakeClient)
    return captured


def test_flash_timeout_is_split_by_phase() -> None:
    """一个笼统的 300 秒超时曾把「上传」和「等结果」混在一起：47 分钟音频等到 300 秒
    被掐断，用户白等 5 分钟。这里固定三段各自的取值，防止又退回单一超时。"""
    timeout = flash_module.flash_timeout()
    assert timeout.connect == flash_module.FLASH_CONNECT_TIMEOUT_SECONDS
    assert timeout.write == flash_module.FLASH_WRITE_TIMEOUT_SECONDS
    assert timeout.read == flash_module.FLASH_READ_TIMEOUT_SECONDS
    assert timeout.pool == flash_module.FLASH_POOL_TIMEOUT_SECONDS
    # 连不上要快速失败，不能和「在算」共用一个大数。
    assert flash_module.FLASH_CONNECT_TIMEOUT_SECONDS <= 30
    # 等待时间必须明显长于曾经失败的 300 秒，否则长音频还是跑不完。
    assert flash_module.FLASH_READ_TIMEOUT_SECONDS > 300


def test_flash_passes_split_timeout_to_http_client(monkeypatch) -> None:
    captured = _recording_client(monkeypatch, {"code": 0, "flash_result": []})
    TencentFlashProvider()._post("https://example.invalid/x", {}, b"audio")
    assert captured["timeout"].read == flash_module.FLASH_READ_TIMEOUT_SECONDS
    assert captured["timeout"].write == flash_module.FLASH_WRITE_TIMEOUT_SECONDS


@pytest.mark.parametrize(
    ("raised", "expected_code", "expected_text"),
    [
        (httpx.ReadTimeout("The read operation timed out"), "response_timeout", "分钟"),
        (httpx.WriteTimeout("The write operation timed out"), "upload_timeout", "传完"),
        (httpx.ConnectTimeout("timed out"), "network", "连不上腾讯云"),
        (httpx.ConnectError("nodename nor servname provided"), "network", "连不上腾讯云"),
        (httpx.ReadError("peer closed connection"), "network", "连接中断"),
    ],
)
def test_flash_timeout_failures_are_distinguishable(
    monkeypatch, raised: Exception, expected_code: str, expected_text: str
) -> None:
    """读超时 ≠ 连不上。以前三类失败都被说成「连不上腾讯云」，用户既不知道该等还是该查网络，
    也看不出问题出在上传还是等待。"""
    _recording_client(monkeypatch, raised)

    with pytest.raises(ProviderError) as excinfo:
        TencentFlashProvider()._post("https://example.invalid/x", {}, b"audio")

    assert excinfo.value.code == expected_code
    assert expected_text in str(excinfo.value)
    # 服务商/httpx 的英文原文必须保留，供排查时复制。
    assert excinfo.value.raw == str(raised)
