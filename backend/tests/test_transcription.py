import json
from typing import Self

import pytest
from fastapi.testclient import TestClient

from app import settings, storage
from app.main import app
from app.models import Speaker, TranscriptionOptions
from app.providers.base import ProviderError
from app.providers.elevenlabs import ElevenLabsProvider, normalize_transcript
from app.providers.funasr import FunASRProvider, normalize_sentences
from app.providers.iflytek_lfasr import IflytekLfasrProvider, normalize_lfasr
from app.providers.iflytek_lfasr_llm import (
    IflytekLlmProvider,
    _describe_llm_error,
    _make_signature,
)
from app.providers.openai_compatible import (
    OpenAICompatibleProvider,
)
from app.providers.openai_compatible import (
    normalize_transcript as normalize_openai,
)
from app.providers.tencent_cloud import (
    TencentCloudProvider,
    _describe_tencent_error,
    _tc3_sign,
    normalize_result_detail,
)

client = TestClient(app)

SAMPLE_RESPONSE = {
    "language_code": "zho",
    "text": "你好。我也很好！",
    "words": [
        {"text": "你", "start": 0.0, "end": 0.3, "type": "word", "speaker_id": "speaker_0"},
        {"text": "好", "start": 0.3, "end": 0.6, "type": "word", "speaker_id": "speaker_0"},
        {"text": "。", "start": 0.6, "end": 0.7, "type": "punctuation", "speaker_id": "speaker_0"},
        {"text": "我", "start": 0.8, "end": 1.0, "type": "word", "speaker_id": "speaker_1"},
        {"text": "也", "start": 1.0, "end": 1.2, "type": "word", "speaker_id": "speaker_1"},
        {"text": "很", "start": 1.2, "end": 1.4, "type": "word", "speaker_id": "speaker_1"},
        {"text": "好", "start": 1.4, "end": 1.7, "type": "word", "speaker_id": "speaker_1"},
        {"text": "！", "start": 1.7, "end": 1.8, "type": "punctuation", "speaker_id": "speaker_1"},
    ],
}


def create_interview() -> str:
    response = client.post(
        "/api/interviews",
        json={
            "title": "API 测试",
            "participants": [
                {"name": "王远", "role": "采访者"},
                {"name": "林老师", "role": "受访者"},
            ],
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_normalizes_speakers_words_and_chinese_spacing() -> None:
    transcript = normalize_transcript(
        SAMPLE_RESPONSE,
        "meeting.m4a",
        [
            Speaker(id="speaker_0", name="王远"),
            Speaker(id="speaker_1", name="林老师"),
        ],
    )

    assert [speaker.name for speaker in transcript.speakers] == ["王远", "林老师"]
    assert [segment.text for segment in transcript.segments] == ["你好。", "我也很好！"]
    assert transcript.segments[0].words is not None
    assert transcript.segments[0].words[0].start == 0
    assert transcript.audio.duration == 1.8


def test_saves_api_key_locally(tmp_path, monkeypatch) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("EXISTING=value\n", encoding="utf-8")
    monkeypatch.setattr(settings, "ENV_PATH", env_path)

    settings.save_credentials("elevenlabs", {"api_key": "sk_test_local_only"})

    assert settings.get_credential("elevenlabs", "api_key") == "sk_test_local_only"
    assert "EXISTING=value" in env_path.read_text(encoding="utf-8")


def test_credentials_are_namespaced_per_provider(tmp_path, monkeypatch) -> None:
    """多个引擎的凭据互不干扰，且重复保存同名项是替换而不是追加。"""
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")

    settings.save_credentials("elevenlabs", {"api_key": "sk_one"})
    settings.save_credentials("xunfei", {"app_id": "id-1", "api_secret": "sec-1"})
    settings.save_credentials("elevenlabs", {"api_key": "sk_two"})

    assert settings.get_credential("elevenlabs", "api_key") == "sk_two"
    assert settings.get_credential("xunfei", "app_id") == "id-1"
    assert settings.get_credential("xunfei", "api_secret") == "sec-1"
    assert settings.get_credential("xunfei", "api_key") is None


def test_save_credentials_hidden_env_tmp(tmp_path, monkeypatch) -> None:
    """回归：`.env` 是隐藏文件（无标准后缀），不能 with_suffix 拼 tmp，
    否则生成 `.env.env.tmp` 且 replace 失败抛 FileNotFoundError。"""
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")

    settings.save_credentials("funasr", {"api_key": "sk_funasr"})

    assert settings.get_credential("funasr", "api_key") == "sk_funasr"
    # 不残留错误命名的临时文件
    assert not (tmp_path / ".env.env.tmp").exists()
    assert not (tmp_path / ".env.tmp").exists()


def test_save_credentials_concurrent_writes(tmp_path, monkeypatch) -> None:
    """前端并发拉多个引擎凭据时后端会并发写 .env（FastAPI 线程池）。
    读-改-写必须串行（锁）且不抛 FileNotFoundError，且不丢密钥。"""
    from concurrent.futures import ThreadPoolExecutor

    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    providers = ["elevenlabs", "iflytek", "iflytek_llm", "openai", "funasr", "tencent_cloud"]

    def write(p: str) -> None:
        settings.save_credentials(p, {"api_key": f"sk_{p}"})

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(write, providers))

    # 锁保证串行，六家的 key 全部保留
    for p in providers:
        assert settings.get_credential(p, "api_key") == f"sk_{p}"


def test_providers_endpoint_describes_capabilities_without_secrets() -> None:
    response = client.get("/api/providers")
    assert response.status_code == 200

    body = response.json()
    elevenlabs = next(item for item in body if item["id"] == "elevenlabs")
    assert elevenlabs["name"] == "ElevenLabs Scribe v2"
    assert elevenlabs["capabilities"]["diarization"] is True
    assert [field["key"] for field in elevenlabs["credential_fields"]] == ["api_key"]
    # 绝不能把密钥内容带出来
    assert "sk_" not in str(body)


def test_unknown_provider_is_rejected() -> None:
    response = client.put(
        "/api/providers/nope/credentials", json={"api_key": "whatever"}
    )
    assert response.status_code == 404


def test_providers_endpoint_lists_all_engines() -> None:
    response = client.get("/api/providers")
    assert response.status_code == 200

    body = response.json()
    ids = [item["id"] for item in body]
    assert "elevenlabs" in ids
    assert "openai_compatible" in ids
    assert "funasr" in ids

    oai = next(item for item in body if item["id"] == "openai_compatible")
    assert oai["name"] == "OpenAI Whisper / 兼容转录服务"
    fields = {item["key"]: item for item in oai["credential_fields"]}
    assert fields["base_url"]["default_value"] == "https://api.openai.com/v1"
    assert fields["model"]["default_value"] == "whisper-1"
    # 自定义端点不做说话人分离，前端据此不显示「区分说话人」开关。
    assert oai["capabilities"]["diarization"] is False
    assert oai["capabilities"]["word_timestamps"] is True
    # base_url 与 model 是必填、明文；api_key 可选。
    field_keys = [field["key"] for field in oai["credential_fields"]]
    assert field_keys == ["base_url", "api_key", "model"]
    assert oai["credential_fields"][0]["secret"] is False
    assert oai["credential_fields"][1]["required"] is False

    funasr = next(item for item in body if item["id"] == "funasr")
    assert funasr["name"] == "FunASR（本地）"
    # FunASR 出说话人分离，但不出词级时间戳。
    assert funasr["capabilities"]["diarization"] is True
    assert funasr["capabilities"]["word_timestamps"] is False
    # host / port 是明文、非必填（有默认值）。
    funasr_fields = {field["key"]: field for field in funasr["credential_fields"]}
    assert set(funasr_fields) == {"host", "port"}
    assert all(not field["secret"] for field in funasr_fields.values())
    # 绝不能把密钥内容带出来
    assert "sk-" not in str(body)


def test_funasr_normalize_maps_speakers_and_timestamps() -> None:
    sentences = [
        {"text": "你好，我是王远。", "start": 0.3, "end": 1.2, "spk_label": "spk0"},
        {"text": "你好，我是林老师。", "start": 1.5, "end": 2.6, "spk_label": "spk1"},
        {"text": "", "start": 0, "end": 0, "spk_label": "spk0"},  # 空句应该被跳过
        {"text": "最近怎么样？", "start": 2.7, "end": 3.5, "spk_label": "spk0"},
    ]
    transcript = normalize_sentences(sentences, "interview.wav")

    assert [speaker.name for speaker in transcript.speakers] == ["说话人 1", "说话人 2"]
    assert [segment.text for segment in transcript.segments] == [
        "你好，我是王远。",
        "你好，我是林老师。",
        "最近怎么样？",
    ]
    assert transcript.segments[0].start == 0.3
    assert transcript.segments[0].end == 1.2
    assert transcript.segments[1].speaker_id == "spk_1"
    assert transcript.audio.duration == 3.5
    assert transcript.segments[0].words is None


def test_funasr_normalize_distributes_without_timestamps() -> None:
    # 服务端没返回时间戳时，按整段时长平摊，保证顺序与大致位置。
    sentences = [
        {"text": "第一句。", "spk_label": "spk0"},
        {"text": "第二句。", "spk_label": "spk0"},
        {"text": "第三句。", "spk_label": "spk1"},
    ]
    transcript = normalize_sentences(sentences, "x.wav", total_duration=3.0)

    assert transcript.segments[0].start == 0.0
    assert transcript.segments[0].end == 1.0
    assert transcript.segments[2].start == 2.0
    assert transcript.segments[2].end == 3.0
    assert transcript.audio.duration == 3.0


def test_funasr_is_configured_without_credentials() -> None:
    # 本地服务没有密钥，「配置好」恒为真，真正的连通性在 transcribe 时验证。
    assert FunASRProvider().is_configured() is True


def test_funasr_connection_refused_raises_provider_error() -> None:
    import asyncio

    provider = FunASRProvider()
    # 向一个必然拒绝连接的端口发请求，应被翻译成带明确排查提示的 ProviderError。
    with pytest.raises(ProviderError) as exc_info:
        asyncio.run(provider._ws_transcribe(b"", "127.0.0.1", 1, "x.wav"))

    assert exc_info.value.code == "connection_refused"


def test_funasr_speaks_real_server_protocol() -> None:
    """起一个忠实地模拟 funasr_wss_server.py 的假服务，验证握手与解析端到端正确。

    真实协议的要点：首条 JSON 配置必须含 mode + chunk_size；随后收二进制 PCM；
    末条 JSON {"is_speaking":false,"is_end":true}；服务端回逐句离线结果
    （mode 含 offline、text、spk_name、timestamp）+ 最后 {"is_end":true} 确认。
    """
    import asyncio
    import json

    from websockets.asyncio.server import serve as ws_serve

    from app.providers.funasr import FunASRProvider, normalize_sentences

    captured: dict = {}

    async def fake_fun_server(websocket) -> None:
        config = json.loads(await websocket.recv())
        captured["mode"] = config.get("mode")
        captured["chunk_size"] = config.get("chunk_size")
        captured["is_speaking"] = config.get("is_speaking")
        async for message in websocket:
            if isinstance(message, str):
                end = json.loads(message)
                if not end.get("is_speaking") and end.get("is_end"):
                    break
        # 逐句离线结果（带说话人与词级时间戳）
        await websocket.send(
            json.dumps(
                {
                    "mode": "2pass-offline",
                    "text": "你好，我是王远。",
                    "spk_name": "spk0",
                    "is_final": True,
                    "timestamp": [[300, 1200, "你"], [1200, 1500, "好"]],
                }
            )
        )
        await websocket.send(
            json.dumps(
                {
                    "mode": "2pass-offline",
                    "text": "你好，我是林老师。",
                    "spk_name": "spk1",
                    "is_final": True,
                    "timestamp": [[1500, 2600, "老"]],
                }
            )
        )
        # 结束确认
        await websocket.send(json.dumps({"mode": "2pass", "is_final": True, "is_end": True}))

    async def run() -> list[dict]:
        server = await ws_serve(fake_fun_server, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            provider = FunASRProvider()
            return await provider._ws_transcribe(b"\x00" * 6400, "127.0.0.1", port, "x.wav")
        finally:
            server.close()
            await server.wait_closed()

    sentences = asyncio.run(run())

    # 握手确实发了真实协议要求的字段
    assert captured["mode"] == "2pass"
    assert captured["chunk_size"] == "8,8,4"
    assert captured["is_speaking"] is True

    # 解析正确：两句话、说话人映射、毫秒时间戳转秒
    transcript = normalize_sentences(sentences, "x.wav")
    assert [segment.text for segment in transcript.segments] == [
        "你好，我是王远。",
        "你好，我是林老师。",
    ]
    assert transcript.segments[0].speaker_id == "spk_0"
    assert transcript.segments[1].speaker_id == "spk_1"
    assert transcript.segments[0].start == 0.3
    assert transcript.segments[1].start == 1.5



def test_openai_credentials_are_saved_and_flip_configured(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")

    # 没填 base_url / model 时不算配置好
    assert settings.get_credential("openai_compatible", "base_url") in (None, "")

    response = client.put(
        "/api/providers/openai_compatible/credentials",
        json={"base_url": "https://example.com/v1", "model": "whisper-1"},
    )
    assert response.status_code == 200
    assert response.json()["configured"] is True

    assert settings.get_credential("openai_compatible", "base_url") == "https://example.com/v1"
    assert settings.get_credential("openai_compatible", "model") == "whisper-1"


def test_openai_normalize_collapses_to_single_speaker() -> None:
    payload = {
        "language": "chinese",
        "duration": 3.2,
        "text": "你好 世界",
        "segments": [
            {
                "id": 0,
                "start": 0.0,
                "end": 1.5,
                "text": " 你好",
                "words": [{"word": "你", "start": 0.0, "end": 0.4}, {"word": "好", "start": 0.4, "end": 0.8}],
            },
            {
                "id": 1,
                "start": 1.5,
                "end": 3.2,
                "text": " 世界",
                "words": [{"word": "世", "start": 1.5, "end": 2.0}, {"word": "界", "start": 2.0, "end": 2.5}],
            },
        ],
    }
    transcript = normalize_openai(payload, "call.m4a")

    # OpenAI 不出说话人，整段归到一个 speaker
    assert [speaker.name for speaker in transcript.speakers] == ["Speaker 1"]
    assert [segment.text for segment in transcript.segments] == ["你好", "世界"]
    assert transcript.segments[0].words[0].text == "你"
    assert transcript.audio.duration == 3.2


def test_interview_transcribe_routes_by_provider_id(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(storage, "INTERVIEWS_DIR", tmp_path)
    interview_id = create_interview()

    client.post(
        f"/api/interviews/{interview_id}/audio",
        files={"file": ("meeting.m4a", b"fake audio bytes", "audio/mp4")},
    )

    calls: list[str] = []

    def fake_transcribe(self, audio_path, original_filename, options, existing_speakers=None):
        calls.append(self.id)
        return normalize_transcript(
            SAMPLE_RESPONSE, original_filename, existing_speakers=existing_speakers
        )

    # 让两个引擎都可配置，再指定走 openai_compatible。
    monkeypatch.setattr(ElevenLabsProvider, "is_configured", lambda self: True)
    monkeypatch.setattr(OpenAICompatibleProvider, "is_configured", lambda self: True)
    monkeypatch.setattr(OpenAICompatibleProvider, "transcribe", fake_transcribe)

    response = client.post(
        f"/api/interviews/{interview_id}/transcribe?provider_id=openai_compatible", json={}
    )
    assert response.status_code == 200
    assert calls == ["openai_compatible"]


def test_upload_and_mocked_transcription_pipeline(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(storage, "INTERVIEWS_DIR", tmp_path)
    interview_id = create_interview()

    upload = client.post(
        f"/api/interviews/{interview_id}/audio",
        files={"file": ("meeting.m4a", b"fake audio bytes", "audio/mp4")},
    )
    assert upload.status_code == 200
    assert upload.json() == {"exists": True, "filename": "meeting.m4a"}
    assert storage.audio_path(interview_id).read_bytes() == b"fake audio bytes"

    # 替身引擎：走的是 provider 这条缝，而不是某个具体厂商的函数。
    monkeypatch.setattr(ElevenLabsProvider, "is_configured", lambda self: True)
    monkeypatch.setattr(
        ElevenLabsProvider,
        "transcribe",
        lambda self, audio_path, original_filename, options, existing_speakers=None: (
            normalize_transcript(
                SAMPLE_RESPONSE, original_filename, existing_speakers=existing_speakers
            )
        ),
    )
    response = client.post(f"/api/interviews/{interview_id}/transcribe", json={})

    assert response.status_code == 200
    assert [segment["text"] for segment in response.json()["segments"]] == [
        "你好。",
        "我也很好！",
    ]
    assert storage.original_response_path(interview_id).is_file()
    assert storage.normalized_transcript_path(interview_id).is_file()
    assert storage.transcript_path(interview_id).is_file()


def test_providers_endpoint_lists_tencent_with_capabilities() -> None:
    response = client.get("/api/providers")
    assert response.status_code == 200

    body = response.json()
    ids = [item["id"] for item in body]
    assert "tencent_cloud" in ids

    tencent = next(item for item in body if item["id"] == "tencent_cloud")
    assert tencent["name"] == "腾讯云录音文件识别（标准版）"
    # 腾讯云出说话人分离与词级时间戳。
    assert tencent["capabilities"]["diarization"] is True
    assert tencent["capabilities"]["word_timestamps"] is True
    # SecretId / SecretKey 都是敏感字段，前端用密码框。
    field_keys = [field["key"] for field in tencent["credential_fields"]]
    assert field_keys == ["secret_id", "secret_key"]
    assert all(field["secret"] for field in tencent["credential_fields"])
    # 绝不能把密钥内容带出来
    assert "AKID" not in str(body)


def test_tencent_normalize_maps_speakers_and_word_offsets() -> None:
    detail = [
        {
            "FinalSentence": "你好。",
            "StartMs": 0,
            "EndMs": 700,
            "SpeakerId": 0,
            "Words": [
                {"Word": "你", "OffsetStartMs": 0, "OffsetEndMs": 300},
                {"Word": "好", "OffsetStartMs": 300, "OffsetEndMs": 600},
            ],
        },
        {
            "FinalSentence": "我也很好。",
            "StartMs": 800,
            "EndMs": 1800,
            "SpeakerId": 1,
        },
    ]
    transcript = normalize_result_detail(
        {"ResultDetail": detail, "AudioDuration": 1.8}, "x.m4a"
    )

    assert [segment.text for segment in transcript.segments] == ["你好。", "我也很好。"]
    assert transcript.segments[0].speaker_id == "spk_0"
    assert transcript.segments[1].speaker_id == "spk_1"
    # 词级时间戳是相对句子起点的偏移，要加回句子起点。
    assert transcript.segments[0].words[0].start == 0.0
    assert transcript.segments[0].words[1].start == 0.3
    assert transcript.segments[0].words[1].end == 0.6
    assert transcript.audio.duration == 1.8


def test_tencent_sign_headers_have_required_shape() -> None:
    headers = _tc3_sign("AKIDx", "secretx", "CreateRecTask", '{"a":1}')
    assert headers["Authorization"].startswith("TC3-HMAC-SHA256 ")
    assert "Credential=AKIDx/" in headers["Authorization"]
    assert headers["X-TC-Action"] == "CreateRecTask"
    assert headers["X-TC-Version"] == "2019-06-14"
    assert headers["X-TC-Region"] == "ap-beijing"
    assert "X-TC-Timestamp" in headers


def test_tencent_call_timeout_is_split_by_phase() -> None:
    """标准版是异步的（提交后拿 TaskId 再轮询），所以不该像极速版那样挂着一个请求干等；
    但提交任务时 body 最多约 6.7MB（5MB 音频的 base64），慢上行时传输与读取要分开给时间。"""
    import app.providers.tencent_cloud as mod

    assert mod.TENCENT_CALL_CONNECT_TIMEOUT_SECONDS <= 30
    assert mod.TENCENT_CALL_WRITE_TIMEOUT_SECONDS > mod.TENCENT_CALL_READ_TIMEOUT_SECONDS


def test_tencent_call_maps_timeouts_to_distinct_codes(monkeypatch) -> None:
    import httpx

    import app.providers.tencent_cloud as mod

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *exc: object) -> bool:
            return False

        def post(self, *args: object, **kwargs: object) -> object:
            raise httpx.ReadTimeout("The read operation timed out")

    monkeypatch.setattr(mod.httpx, "Client", FakeClient)

    with pytest.raises(ProviderError) as excinfo:
        TencentCloudProvider()._call("CreateRecTask", {"a": 1}, "AKIDx", "secretx")

    assert excinfo.value.code == "response_timeout"
    assert "CreateRecTask" in str(excinfo.value)
    assert excinfo.value.raw == "The read operation timed out"


def test_tencent_describe_error_maps_known_codes() -> None:
    # 鉴权失败映射到 invalid_api_key
    bad = {"Response": {"Error": {"Code": "AuthFailure.SignatureFailure", "Message": "sig"}}}
    assert _describe_tencent_error(bad) == (
        "invalid_api_key",
        "腾讯云拒绝了这次请求：SecretId / SecretKey 无效或没有权限",
    )
    # 成功响应无错误
    assert _describe_tencent_error({"Response": {"Data": {}}}) is None


def test_tencent_is_configured_depends_on_credentials() -> None:
    provider = TencentCloudProvider()
    # 凭据读取走 settings，这里只验证逻辑：没填密钥就不算配置好。
    saved = {}
    import app.providers.tencent_cloud as mod

    original = mod.get_credential
    try:
        mod.get_credential = lambda pid, key: saved.get(f"{pid}.{key}")
        assert provider.is_configured() is False
        saved["tencent_cloud.secret_id"] = "AKIDx"
        saved["tencent_cloud.secret_key"] = "secretx"
        assert provider.is_configured() is True
    finally:
        mod.get_credential = original


def test_tencent_full_flow_mocked(tmp_path, monkeypatch) -> None:
    """用假 _call 验证 提交任务 -> 轮询成功 -> 归一化 全链路（不发真实网络请求）。"""
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_cloud", {"secret_id": "AKIDx", "secret_key": "secretx"})

    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"fake audio")  # ≤5MB，直接 base64 传

    responses = {
        "CreateRecTask": {"Response": {"Data": {"TaskId": 12345}}},
        "DescribeTaskStatus": {
            "Response": {
                "Data": {
                    "Status": 2,
                    "ResultDetail": [
                        {
                            "FinalSentence": "你好。",
                            "StartMs": 0,
                            "EndMs": 700,
                            "SpeakerId": 0,
                            "Words": [{"Word": "你", "OffsetStartMs": 0, "OffsetEndMs": 300}],
                        },
                        {
                            "FinalSentence": "我也很好。",
                            "StartMs": 800,
                            "EndMs": 1800,
                            "SpeakerId": 1,
                        },
                    ],
                }
            }
        },
    }

    provider = TencentCloudProvider()
    captured_payloads: dict[str, dict] = {}

    def _fake_call(action: str, payload: dict, sid: str, skey: str) -> dict:
        captured_payloads[action] = payload
        return responses[action]

    monkeypatch.setattr(provider, "_call", _fake_call)

    transcript = provider.transcribe(
        audio, "x.m4a", TranscriptionOptions(), existing_speakers=None
    )
    assert [segment.text for segment in transcript.segments] == ["你好。", "我也很好。"]
    assert transcript.segments[0].speaker_id == "spk_0"
    assert transcript.segments[1].speaker_id == "spk_1"
    assert transcript.segments[0].words[0].text == "你"
    assert transcript.audio.duration == 1.8
    # 腾讯云 CreateRecTask 必须带 SourceType=1（base64 数据）。
    assert captured_payloads["CreateRecTask"].get("SourceType") == 1
    assert captured_payloads["CreateRecTask"].get("DataLen") == len(b"fake audio")
    # ResTextFormat 应为 2（带词级时间戳 + 标点，ResultDetail 才稳定返回）。
    assert captured_payloads["CreateRecTask"].get("ResTextFormat") == 2


def test_tencent_fallback_to_result_when_detail_empty(tmp_path, monkeypatch) -> None:
    """当 ResultDetail 为空时，应兜底解析 Result 字符串。"""
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_cloud", {"secret_id": "AKIDx", "secret_key": "secretx"})

    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"fake audio")

    responses = {
        "CreateRecTask": {"Response": {"Data": {"TaskId": 12345}}},
        "DescribeTaskStatus": {
            "Response": {
                "Data": {
                    "Status": 2,
                    "AudioDuration": 5.2,
                    "Result": "[0:0.020,0:2.380] 腾讯云语音识别欢迎您。\n[0:2.500,0:5.100] 第二句。\n",
                    "ResultDetail": [],
                }
            }
        },
    }

    provider = TencentCloudProvider()
    monkeypatch.setattr(provider, "_call", lambda action, payload, sid, skey: responses[action])

    transcript = provider.transcribe(
        audio, "x.m4a", TranscriptionOptions(), existing_speakers=None
    )
    assert [segment.text for segment in transcript.segments] == [
        "腾讯云语音识别欢迎您。",
        "第二句。",
    ]
    assert transcript.segments[0].speaker_id == "spk_0"
    assert transcript.segments[0].start == 0.02
    assert transcript.segments[0].end == 2.38
    assert transcript.audio.duration == 5.2


SAMPLE_IFLYTEK_ORDER_RESULT = json.dumps(
    {
        "lattice": [
            {
                "json_1best": json.dumps(
                    {
                        "st": {
                            "bg": "50",
                            "ed": "1840",
                            "rt": [
                                {
                                    "ws": [
                                        {"cw": [{"w": "这", "wb": 1, "we": 16}]},
                                        {"cw": [{"w": "是", "wb": 17, "we": 36}]},
                                        {"cw": [{"w": "王远", "wb": 37, "we": 80}]},
                                        {"cw": [{"w": "。", "wb": 80, "we": 172}]},
                                    ]
                                }
                            ],
                        }
                    }
                ),
                "spk": "段落-0",
            },
            {
                "json_1best": json.dumps(
                    {
                        "st": {
                            "bg": "1900",
                            "ed": "3200",
                            "rt": [
                                {
                                    "ws": [
                                        {"cw": [{"w": "你好", "wb": 1, "we": 60}]},
                                        {"cw": [{"w": "林老师", "wb": 61, "we": 200}]},
                                    ]
                                }
                            ],
                        }
                    }
                ),
                "spk": "段落-1",
            },
        ]
    }
)


def test_providers_endpoint_lists_iflytek_with_capabilities() -> None:
    response = client.get("/api/providers")
    assert response.status_code == 200

    body = response.json()
    assert "iflytek" in [item["id"] for item in body]

    iflytek = next(item for item in body if item["id"] == "iflytek")
    assert iflytek["name"] == "科大讯飞录音文件转写（标准版）"
    # 讯飞出说话人分离与词级时间戳。
    assert iflytek["capabilities"]["diarization"] is True
    assert iflytek["capabilities"]["word_timestamps"] is True
    # APPID 明文、SecretKey 敏感。
    field_keys = [field["key"] for field in iflytek["credential_fields"]]
    assert field_keys == ["app_id", "secret_key"]
    assert iflytek["credential_fields"][0]["secret"] is False
    assert iflytek["credential_fields"][1]["secret"] is True
    # 实验性标记应在前端打标。
    assert iflytek["experimental"] is True
    # 绝不能把密钥内容带出来
    assert "sec-" not in str(body)


def test_iflytek_normalize_maps_speakers_and_word_timestamps() -> None:
    transcript = normalize_lfasr(SAMPLE_IFLYTEK_ORDER_RESULT, "x.m4a")

    assert [segment.text for segment in transcript.segments] == [
        "这是王远。",
        "你好林老师",
    ]
    assert transcript.segments[0].speaker_id == "spk_0"
    assert transcript.segments[1].speaker_id == "spk_1"
    # 词级时间戳：bg + 帧数*10ms，再转秒。句1 起始 50ms、词「这」1 帧。
    assert transcript.segments[0].start == 0.05
    assert transcript.segments[0].words[0].text == "这"
    assert transcript.segments[0].words[0].start == (50 + 1 * 10) / 1000.0
    assert transcript.segments[0].words[0].end == (50 + 16 * 10) / 1000.0
    # 句2 起始 1900ms、词「你好」1 帧。
    assert transcript.segments[1].start == 1.9
    assert transcript.segments[1].words[0].start == (1900 + 1 * 10) / 1000.0
    assert transcript.audio.duration == 3.2


def test_iflytek_normalize_interpolates_word_timestamps_when_missing() -> None:
    """接口不返回词级起止（wb/we 全 0）时，按词在段内累计字符比例线性插值，
    保证词级时间戳递增且覆盖段时间窗（否则前端字级高亮退化为段开头）。"""
    order_result = json.dumps(
        {
            "lattice": [
                {
                    "json_1best": json.dumps(
                        {
                            "st": {
                                "bg": "1000",
                                "ed": "3000",
                                "rt": [
                                    {
                                        "ws": [
                                            # 无 wb/we（或均为 0）：不应全部落在段开头
                                            {"cw": [{"w": "你好"}]},
                                            {"cw": [{"w": "世界"}]},
                                        ]
                                    }
                                ],
                            }
                        }
                    ),
                    "spk": "段落-0",
                }
            ]
        }
    )
    transcript = normalize_lfasr(order_result, "x.m4a")
    segment = transcript.segments[0]
    assert [w.text for w in segment.words] == ["你好", "世界"]
    # 线性插值：按字符比例切分 [1.0s, 3.0s] 窗口（各占一半）
    assert segment.words[0].start == 1.0
    assert segment.words[0].end == 2.0
    assert segment.words[1].start == 2.0
    assert segment.words[1].end == 3.0


def test_iflytek_full_flow_mocked(tmp_path, monkeypatch) -> None:
    """用假 _upload_task / _fetch_result 验证 上传 -> 轮询 -> 归一化 全链路（不发真实网络请求）。"""
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("iflytek", {"app_id": "app-x", "secret_key": "sec-x"})

    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"fake audio")

    provider = IflytekLfasrProvider()
    monkeypatch.setattr(provider, "_upload_task", lambda *args, **kwargs: "ORDER123")
    monkeypatch.setattr(
        provider,
        "_fetch_result",
        lambda *args, **kwargs: {"orderResult": SAMPLE_IFLYTEK_ORDER_RESULT},
    )

    transcript = provider.transcribe(
        audio, "x.m4a", TranscriptionOptions(), existing_speakers=None
    )
    assert [segment.text for segment in transcript.segments] == [
        "这是王远。",
        "你好林老师",
    ]
    assert transcript.segments[0].speaker_id == "spk_0"
    assert transcript.segments[1].speaker_id == "spk_1"
    assert transcript.segments[0].words[0].start == 0.06
    assert transcript.audio.duration == 3.2


def test_iflytek_upload_sends_role_params_when_diarize(monkeypatch, tmp_path) -> None:
    """开启分离时带 roleType=1 与 roleNum；关闭时不带 roleNum。"""
    provider = IflytekLfasrProvider()
    captured: dict = {}

    def fake_http(url, params, body):
        captured.clear()
        captured.update(params)
        return {"content": {"orderId": "ORDER_X"}}

    monkeypatch.setattr(provider, "_http", fake_http)
    monkeypatch.setattr("app.providers.iflytek_lfasr._probe_duration_ms", lambda p: 0)

    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"fake")

    provider._upload_task(
        audio, TranscriptionOptions(diarize=True, num_speakers=2), "app-x", "sec-x"
    )
    assert captured.get("roleType") == "1"
    assert captured.get("roleNum") == "2"

    provider._upload_task(audio, TranscriptionOptions(diarize=False), "app-x", "sec-x")
    assert captured.get("roleType") == "0"
    assert "roleNum" not in captured


def test_iflytek_llm_upload_sends_role_params_when_diarize(monkeypatch, tmp_path) -> None:
    """大模型版上传 URL 的 query 里带 roleType=1 与 roleNum（参数拼在 query string）。"""
    from urllib.parse import parse_qs, urlparse

    provider = IflytekLlmProvider()
    captured: dict = {}

    def fake_http(url, headers, body):
        captured.clear()
        captured.update({k: v[0] for k, v in parse_qs(urlparse(url).query).items()})
        return {"content": {"orderId": "ORDER_X"}}

    monkeypatch.setattr(provider, "_http", fake_http)

    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"fake")

    provider._upload_task(
        audio,
        TranscriptionOptions(diarize=True, num_speakers=3),
        "app-x",
        "sec-x",
        "key-x",
    )
    assert captured.get("roleType") == "1"
    assert captured.get("roleNum") == "3"


def test_iflytek_normalize_maps_llm_rl_role() -> None:
    """大模型版角色标签在 json_1best.st.rl（1 起），应映射成 spk_0/spk_1。"""
    order_result = json.dumps(
        {
            "lattice": [
                {
                    "json_1best": json.dumps(
                        {
                            "st": {
                                "bg": "880",
                                "rl": "1",
                                "ed": "1680",
                                "rt": [{"ws": [{"cw": [{"w": "为", "wb": 22, "we": 75}]}]}],
                            }
                        }
                    )
                },
                {
                    "json_1best": json.dumps(
                        {
                            "st": {
                                "bg": "2390",
                                "rl": "2",
                                "ed": "3640",
                                "rt": [{"ws": [{"cw": [{"w": "喂", "wb": 19, "we": 52}]}]}],
                            }
                        }
                    )
                },
            ]
        }
    )
    transcript = normalize_lfasr(order_result, "x.m4a")
    assert [segment.speaker_id for segment in transcript.segments] == ["spk_0", "spk_1"]
    assert [segment.text for segment in transcript.segments] == ["为", "喂"]


def test_iflytek_llm_listed_with_three_credential_fields() -> None:
    """大模型版应出现在 providers 端点，且带 APPID/APIKey/APISecret 三字段（已真机跑通，非 experimental）。"""
    response = client.get("/api/providers")
    assert response.status_code == 200
    body = response.json()
    assert "iflytek_llm" in [item["id"] for item in body]

    llm = next(item for item in body if item["id"] == "iflytek_llm")
    assert llm["name"] == "科大讯飞录音文件转写（大模型版）"
    assert llm["capabilities"]["diarization"] is True
    assert llm["capabilities"]["word_timestamps"] is True
    field_keys = [field["key"] for field in llm["credential_fields"]]
    assert field_keys == ["app_id", "api_secret", "api_key"]
    # 三条都是敏感密钥类（app_id 明文、另两条 secret）。
    assert llm["credential_fields"][0]["secret"] is False
    assert llm["credential_fields"][1]["secret"] is True
    assert llm["credential_fields"][2]["secret"] is True
    assert llm["experimental"] is False
    # 绝不能把密钥内容带出来
    assert "sec-" not in str(body)


def test_iflytek_llm_signature_is_hmac_sha1_base64_of_sorted_query() -> None:
    """签名必须等于 base64(HmacSHA1(按 key 自然排序+Java式URL编码的查询串, APISecret))。"""
    import base64
    import hashlib
    import hmac

    params = {
        "appId": "app-x",
        "accessKeyId": "key-x",
        "dateTime": "2025-09-08T22:58:29+0800",
        "signatureRandom": "abc123",
        "fileSize": "100",
        "fileName": "x m4a.wav",
        "language": "autodialect",
        "roleType": "1",
        "durationCheckDisable": "true",
    }
    signature = _make_signature("secret-x", params)

    # 复算期望签名，验证算法与排序/编码正确（含空格->'+' 的 Java 式编码）。
    import urllib.parse

    pairs = []
    for key in sorted(params.keys()):
        value = params[key]
        encoded = urllib.parse.quote(str(value), safe="-_.!*'()").replace("%20", "+")
        pairs.append(f"{key}={encoded}")
    expected_base = "&".join(pairs)
    expected = base64.b64encode(
        hmac.new(b"secret-x", expected_base.encode("utf-8"), hashlib.sha1).digest()
    ).decode("ascii")

    assert signature == expected
    # 签名对密钥敏感：换密钥应得到不同结果。
    assert _make_signature("secret-y", params) != signature


def test_iflytek_llm_error_mapping() -> None:
    """业务错误码应被翻译成可中文呈现的（code, message）。"""
    assert _describe_llm_error("100009") == (
        "invalid_api_key",
        "讯飞签名校验不通过，请确认 APISecret 填写正确",
    )
    assert _describe_llm_error("100007") == (
        "permission",
        "讯飞返回权限错误，请确认该应用已开通「录音文件转写大模型」服务",
    )
    # 未知码返回 None（走兜底报错）。
    assert _describe_llm_error("000000") is None
    assert _describe_llm_error("999999") is not None


def test_iflytek_llm_full_flow_mocked(tmp_path, monkeypatch) -> None:
    """用假 _upload_task / _fetch_result 验证 上传 -> 轮询 -> 归一化 全链路（不发真实网络请求）。"""
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials(
        "iflytek_llm",
        {"app_id": "app-x", "api_key": "key-x", "api_secret": "sec-x"},
    )

    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"fake audio")

    provider = IflytekLlmProvider()
    monkeypatch.setattr(provider, "_upload_task", lambda *args, **kwargs: ("ORDER123", "rand-x"))
    monkeypatch.setattr(
        provider,
        "_fetch_result",
        lambda *args, **kwargs: {"orderResult": SAMPLE_IFLYTEK_ORDER_RESULT},
    )

    transcript = provider.transcribe(
        audio, "x.m4a", TranscriptionOptions(), existing_speakers=None
    )
    assert [segment.text for segment in transcript.segments] == [
        "这是王远。",
        "你好林老师",
    ]
    assert transcript.segments[0].speaker_id == "spk_0"
    assert transcript.segments[1].speaker_id == "spk_1"
    assert transcript.segments[0].words[0].start == 0.06
    assert transcript.audio.duration == 3.2


from app import main

# ---------------------------------------------------------------------------
# 命名凭据档案（多套 / 备忘名 / 启用切换）端点
# ---------------------------------------------------------------------------

def _patch_cred_paths(monkeypatch, tmp_path):
    """把凭据存储指向临时文件，避免污染项目根目录的 .env / credentials.json。"""
    env = tmp_path / ".env"
    profiles = tmp_path / "credentials.json"
    monkeypatch.setattr(settings, "ENV_PATH", env)
    monkeypatch.setattr(settings, "PROFILES_PATH", profiles)
    monkeypatch.setattr(main, "PROFILES_PATH", profiles)
    return env, profiles


def test_credentials_migrate_from_env_and_list_hides_values(tmp_path, monkeypatch) -> None:
    """首次访问时 .env 现有密钥应迁移成以 provider 名称命名的档案；列表视图绝不能泄露密钥值。"""
    _patch_cred_paths(monkeypatch, tmp_path)
    settings.save_credentials("elevenlabs", {"api_key": "sk_should_stay_hidden"})

    response = client.get("/api/providers/elevenlabs/credentials")
    assert response.status_code == 200
    body = response.json()
    assert body["provider_id"] == "elevenlabs"
    assert len(body["profiles"]) == 1
    assert body["profiles"][0]["name"] == "ElevenLabs Scribe v2"
    assert body["profiles"][0]["active"] is True
    assert body["active_profile_id"] == body["profiles"][0]["id"]
    assert "api_key" in body["profiles"][0]["field_keys_present"]
    # 安全契约：列表端点不得出现任何密钥值
    assert "sk_should_stay_hidden" not in str(body)


def test_credentials_reveal_returns_values_only_on_demand(tmp_path, monkeypatch) -> None:
    """reveal 端点才返回完整密钥值，且能按需查看。"""
    _patch_cred_paths(monkeypatch, tmp_path)
    settings.save_credentials("elevenlabs", {"api_key": "sk_reveal_me"})

    list_body = client.get("/api/providers/elevenlabs/credentials").json()
    pid = list_body["profiles"][0]["id"]

    reveal = client.get(f"/api/providers/elevenlabs/credentials/{pid}/reveal")
    assert reveal.status_code == 200
    assert reveal.json()["values"] == {"api_key": "sk_reveal_me"}


def test_credentials_add_activate_delete_flow(tmp_path, monkeypatch) -> None:
    """新增第二套 -> 设为启用（镜像进 .env）-> 删除，全链路正确。"""
    _patch_cred_paths(monkeypatch, tmp_path)
    settings.save_credentials("elevenlabs", {"api_key": "sk_primary"})

    # 新增第二套（此时已有启用档案，不会自动切换）
    created = client.post(
        "/api/providers/elevenlabs/credentials",
        json={"name": "备用", "values": {"api_key": "sk_backup"}},
    )
    assert created.status_code == 200
    listing = created.json()
    assert len(listing["profiles"]) == 2
    backup = next(p for p in listing["profiles"] if p["name"] == "备用")
    assert backup["active"] is False

    # 设为启用 -> .env 应被镜像成 sk_backup
    activated = client.post(
        f"/api/providers/elevenlabs/credentials/{backup['id']}/activate"
    )
    assert activated.status_code == 200
    assert activated.json()["active_profile_id"] == backup["id"]
    assert settings.get_credential("elevenlabs", "api_key") == "sk_backup"

    # 删除启用中的那套 -> .env 清空
    deleted = client.delete(f"/api/providers/elevenlabs/credentials/{backup['id']}")
    assert deleted.status_code == 200
    assert len(deleted.json()["profiles"]) == 1
    assert settings.get_credential("elevenlabs", "api_key") in (None, "")


def test_credentials_empty_store_first_add_auto_activates(tmp_path, monkeypatch) -> None:
    """空存储下首次新增应自动启用。"""
    _patch_cred_paths(monkeypatch, tmp_path)

    created = client.post(
        "/api/providers/elevenlabs/credentials",
        json={"name": "首套", "values": {"api_key": "sk_first"}},
    )
    body = created.json()
    assert len(body["profiles"]) == 1
    assert body["profiles"][0]["active"] is True
    assert settings.get_credential("elevenlabs", "api_key") == "sk_first"


def test_credentials_unknown_provider_404(tmp_path, monkeypatch) -> None:
    _patch_cred_paths(monkeypatch, tmp_path)
    assert client.get("/api/providers/nope/credentials").status_code == 404
    assert client.post("/api/providers/nope/credentials", json={"values": {}}).status_code == 404


def test_credentials_global_default_is_single_after_migration(tmp_path, monkeypatch) -> None:
    """迁移后全局默认跨引擎唯一：所有引擎里只有一套标 is_default=True。"""
    _patch_cred_paths(monkeypatch, tmp_path)
    # 给两个引擎各放一套密钥
    settings.save_credentials("elevenlabs", {"api_key": "sk_el"})
    settings.save_credentials("openai_compatible", {"api_key": "sk_oa"})

    # 触发迁移（访问任一引擎列表）
    first = client.get("/api/providers/elevenlabs/credentials").json()
    second = client.get("/api/providers/openai_compatible/credentials").json()

    # 全局默认端点只能指向一套
    default = client.get("/api/credentials/default").json()["default_profile"]
    assert default is not None
    # 恰好一套 is_default=True
    all_profiles = first["profiles"] + second["profiles"]
    defaults = [p for p in all_profiles if p.get("is_default")]
    assert len(defaults) == 1
    # 列表里回传的 default_profile 与 is_default 标记一致
    assert default["profile_id"] == defaults[0]["id"]
    assert default["provider_id"] in {first["provider_id"], second["provider_id"]}
    # 单套密钥的默认名应为 provider 名称，而非"默认配置"
    assert first["profiles"][0]["name"] == "ElevenLabs Scribe v2"


def test_credentials_set_default_is_cross_engine_unique(tmp_path, monkeypatch) -> None:
    """把第二引擎的密钥设为默认后，第一引擎的默认标记应被撤销（全局唯一）。"""
    _patch_cred_paths(monkeypatch, tmp_path)
    settings.save_credentials("elevenlabs", {"api_key": "sk_el"})
    settings.save_credentials("openai_compatible", {"api_key": "sk_oa"})

    el = client.get("/api/providers/elevenlabs/credentials").json()
    oa = client.get("/api/providers/openai_compatible/credentials").json()
    el_pid = el["profiles"][0]["id"]
    oa_pid = oa["profiles"][0]["id"]

    # 把 openai_compatible 那套设为全局默认
    res = client.post(f"/api/providers/openai_compatible/credentials/{oa_pid}/default")
    assert res.status_code == 200
    default = client.get("/api/credentials/default").json()["default_profile"]
    assert default == {"provider_id": "openai_compatible", "profile_id": oa_pid}

    el_after = client.get("/api/providers/elevenlabs/credentials").json()
    assert el_after["profiles"][0]["id"] == el_pid
    assert el_after["profiles"][0].get("is_default") is False
    assert el_after["default_profile"] == {"provider_id": "openai_compatible", "profile_id": oa_pid}

    # elevenlabs 那套仍是该引擎的启用档案（只是不再是全局默认）
    assert el_after["profiles"][0]["active"] is True


def test_credentials_set_default_unknown_profile_404(tmp_path, monkeypatch) -> None:
    _patch_cred_paths(monkeypatch, tmp_path)
    settings.save_credentials("elevenlabs", {"api_key": "sk_el"})
    assert client.post("/api/providers/elevenlabs/credentials/nope/default").status_code == 404


def test_reconcile_env_restores_active_profile_keys(tmp_path, monkeypatch) -> None:
    """.env 与档案库脱节时，对账应把启用中档案的密钥镜像回 .env。"""
    _patch_cred_paths(monkeypatch, tmp_path)
    settings.add_profile(
        "iflytek_llm", "大模型", {"app_id": "app-x", "api_key": "key-x", "api_secret": "sec-x"}
    )
    assert settings.get_credential("iflytek_llm", "app_id") == "app-x"

    # 模拟 .env 被意外清空（档案库仍在），造成「界面显示已填、转录却读不到」的脱节
    settings.clear_credentials("iflytek_llm", ["app_id", "api_key", "api_secret"])
    assert settings.get_credential("iflytek_llm", "app_id") is None

    settings.reconcile_env_from_profiles()
    assert settings.get_credential("iflytek_llm", "app_id") == "app-x"
    assert settings.get_credential("iflytek_llm", "api_key") == "key-x"
    assert settings.get_credential("iflytek_llm", "api_secret") == "sec-x"


def test_clear_credentials_precise_match_does_not_erase_prefixed_provider(
    tmp_path, monkeypatch
) -> None:
    """iflytek 与 iflytek_llm 共享 IFLYTEK_ 前缀，清除标准版不应误删大模型版的 .env 键。"""
    _patch_cred_paths(monkeypatch, tmp_path)
    settings.save_credentials("iflytek", {"app_id": "std-app", "secret_key": "std-sec"})
    settings.save_credentials(
        "iflytek_llm", {"app_id": "llm-app", "api_key": "llm-key", "api_secret": "llm-sec"}
    )
    assert settings.get_credential("iflytek_llm", "app_id") == "llm-app"

    settings.clear_credentials("iflytek", ["app_id", "secret_key"])
    assert settings.get_credential("iflytek", "app_id") is None
    # 大模型版的键必须原样保留
    assert settings.get_credential("iflytek_llm", "app_id") == "llm-app"
    assert settings.get_credential("iflytek_llm", "api_key") == "llm-key"
    assert settings.get_credential("iflytek_llm", "api_secret") == "llm-sec"
