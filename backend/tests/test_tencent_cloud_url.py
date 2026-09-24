"""URL 版腾讯引擎的测试：提交方式、凭据回落，以及「云上副本一定删掉」。

真实链路要花钱、要桶、要等几十分钟，所以这里把两个网络出口都换掉：
  - `url_module.CosClient` → FakeCos（假桶，记录上传/签名/删除）
  - `provider._call` → 假响应（CreateRecTask / DescribeTaskStatus）
剩下被测的是我们自己的逻辑：传什么参数、用谁的密钥、什么时候删对象。

最后一条（清理）是这个引擎最值得测的地方：它是唯一会把访谈原件放到云上的路径。
"""

from typing import ClassVar

import pytest
from fastapi.testclient import TestClient

import app.providers.tencent_cloud_url as url_module
from app import progress, settings
from app.main import app
from app.models import TranscriptionOptions
from app.providers.base import ProviderError
from app.providers.registry import PROVIDERS
from app.providers.tencent_cloud_url import (
    MAX_DURATION_SECONDS,
    MAX_URL_BYTES,
    TencentCloudUrlProvider,
)

BUCKET = "ripple-audio-1250000000"
REGION = "ap-beijing"
# 假链接的形状与真链接一致：默认域名 + q-sign-* 查询串
PRESIGNED = (
    f"https://{BUCKET}.cos.{REGION}.myqcloud.com/ripple/20260914/abc.m4a"
    "?q-sign-algorithm=sha1&q-ak=AKIDx&q-signature=deadbeef"
)


def _sample_task_data() -> dict:
    """DescribeTaskStatus 成功后的 Data（字段名照官方文档）。"""
    return {
        "Status": 2,
        "AudioDuration": 2.386,
        "ResultDetail": [
            {
                "FinalSentence": "腾讯云智能语音欢迎您。",
                "StartMs": 0,
                "EndMs": 2386,
                "SpeakerId": 0,
                "Words": [{"Word": "腾讯云", "OffsetStartMs": 0, "OffsetEndMs": 780}],
            }
        ],
    }


class FakeCos:
    """假桶。记下每一次上传/签名/删除，并允许让删除失败。"""

    instances: ClassVar[list["FakeCos"]] = []

    def __init__(self, *, secret_id: str, secret_key: str, bucket: str, region: str) -> None:
        self.secret_id = secret_id
        self.secret_key = secret_key
        self.bucket = bucket
        self.region = region
        self.uploaded: list[tuple[str, bytes]] = []
        # 每次上传收到的进度回调：用来验证「引擎确实把进度报出去了」
        self.progress_hooks: list[object] = []
        self.presigned_for: list[str] = []
        self.deleted: list[str] = []
        self.delete_error: Exception | None = None
        FakeCos.instances.append(self)

    def put_object(self, key: str, audio_path: object, *, on_progress=None) -> None:
        data = audio_path.read_bytes()  # type: ignore[attr-defined]
        self.uploaded.append((key, data))
        self.progress_hooks.append(on_progress)
        if on_progress is not None:
            # 真客户端每传完一块就回调一次；这里一次报满，代表「整份都传完了」
            on_progress(len(data), len(data))

    def presigned_get_url(self, key: str, expires_seconds: int = 0) -> str:
        self.presigned_for.append(key)
        return f"{PRESIGNED}&key={key}"

    def delete_object(self, key: str) -> None:
        self.deleted.append(key)
        if self.delete_error is not None:
            raise self.delete_error


@pytest.fixture
def fake_cos(monkeypatch) -> type[FakeCos]:
    FakeCos.instances = []
    monkeypatch.setattr(url_module, "CosClient", FakeCos)
    return FakeCos


def _configure(tmp_path, monkeypatch, *, bucket: str | None = BUCKET, region: str | None = REGION) -> None:
    """写进一份「标准版密钥 + URL 版桶信息」的配置，落在 tmp 的 .env 里。"""
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_cloud", {"secret_id": "AKIDx", "secret_key": "secretx"})
    values = {}
    if bucket:
        values["bucket"] = bucket
    if region:
        values["region"] = region
    if values:
        settings.save_credentials("tencent_cloud_url", values)


def _calls_recorder(provider: TencentCloudUrlProvider, *, status: int = 2) -> list[tuple]:
    calls: list[tuple] = []

    def fake_call(action: str, payload: dict, secret_id: str, secret_key: str) -> dict:
        calls.append((action, payload, secret_id, secret_key))
        if action == "CreateRecTask":
            return {"Response": {"Data": {"TaskId": 42}}}
        if status == 3:
            return {"Response": {"Data": {"Status": 3, "ErrorMsg": "decode failed"}}}
        return {"Response": {"Data": _sample_task_data()}}

    provider._call = fake_call  # type: ignore[method-assign]
    return calls


# --- 注册与声明 -------------------------------------------------------------


def test_url_provider_is_registered_with_limits_and_credential_fields() -> None:
    assert "tencent_cloud_url" in PROVIDERS
    info = PROVIDERS["tencent_cloud_url"].info()

    assert info.capabilities.max_file_bytes == MAX_URL_BYTES
    assert info.capabilities.max_duration_seconds == MAX_DURATION_SECONDS
    assert info.capabilities.diarization is True
    assert info.experimental is False, "2026-09-14 已真机跑通（真实密钥 + 真实桶）"

    assert [field.key for field in info.credential_fields] == [
        "bucket",
        "region",
        "secret_id",
        "secret_key",
    ]
    # 桶名与地域是配置信息，用明文框；两个密钥仍走密码框，且都可留空沿用标准版。
    assert [field.secret for field in info.credential_fields] == [False, False, True, True]
    assert [field.required for field in info.credential_fields] == [True, True, False, False]


def test_url_limits_match_official_documentation() -> None:
    """数字必须与官方文档一致，且明显高于「Data 传 base64」那条路的 5MB。"""
    assert MAX_URL_BYTES == 1024 * 1024 * 1024
    assert MAX_DURATION_SECONDS == 5 * 3600
    assert MAX_URL_BYTES == 1024 * 1024 * 1024
    assert MAX_URL_BYTES > 100 * 1024 * 1024


def test_providers_endpoint_exposes_url_engine() -> None:
    payload = TestClient(app).get("/api/providers").json()
    entry = next(item for item in payload if item["id"] == "tencent_cloud_url")

    assert entry["name"].startswith("腾讯云录音文件识别")
    assert entry["capabilities"]["max_file_bytes"] == MAX_URL_BYTES
    assert [field["key"] for field in entry["credential_fields"]][:2] == ["bucket", "region"]


def test_url_engine_needs_bucket_but_shares_standard_secrets(tmp_path, monkeypatch) -> None:
    _configure(tmp_path, monkeypatch, bucket=None, region=None)
    provider = TencentCloudUrlProvider()

    # 只有标准版密钥（用户现有状态）：还不算配置好，因为缺桶信息。
    assert provider._secret_id() == "AKIDx"
    assert provider._secret_key() == "secretx"
    assert provider.is_configured() is False

    settings.save_credentials("tencent_cloud_url", {"bucket": BUCKET})
    assert provider.is_configured() is False, "只有桶、没有地域，仍不可用"

    settings.save_credentials("tencent_cloud_url", {"region": REGION})
    assert provider.is_configured() is True, "补上桶与地域即可用，密钥不用再抄一遍"

    # URL 版自己的密钥槽优先于标准版。
    settings.save_credentials("tencent_cloud_url", {"secret_id": "OWNID"})
    assert provider._secret_id() == "OWNID"


# --- 全链路（无真实网络）----------------------------------------------------


def test_transcribe_uploads_submits_url_and_deletes(tmp_path, monkeypatch, fake_cos) -> None:
    _configure(tmp_path, monkeypatch)
    audio = tmp_path / "田燕燕.m4a"
    audio.write_bytes(b"audio-bytes")

    provider = TencentCloudUrlProvider()
    calls = _calls_recorder(provider)

    transcript = provider.transcribe(
        audio, "田燕燕.m4a", TranscriptionOptions(), existing_speakers=None
    )

    cos = fake_cos.instances[-1]
    assert (cos.secret_id, cos.bucket, cos.region) == ("AKIDx", BUCKET, REGION)

    key, body = cos.uploaded[0]
    assert body == b"audio-bytes", "上传的是原始字节，不压缩、不改码率"
    assert key.startswith("ripple/") and key.isascii(), "对象键不能带中文原名"

    action, payload, secret_id, _ = calls[0]
    assert action == "CreateRecTask"
    assert payload["SourceType"] == 0, "SourceType=0 才是「音频在链接上」"
    assert payload["Url"] == f"{PRESIGNED}&key={key}", "给出的必须是刚上传那个对象的链接"
    assert "Data" not in payload and "DataLen" not in payload, "URL 模式不该再塞 base64"
    assert payload["ChannelNum"] == 1
    assert payload["ResTextFormat"] == 2
    assert payload["SpeakerDiarization"] == 1
    assert payload["EngineModelType"] == "16k_zh"
    assert secret_id == "AKIDx"

    assert [call[0] for call in calls] == ["CreateRecTask", "DescribeTaskStatus"]
    assert cos.presigned_for == [key]
    assert cos.deleted == [key], "转录结束必须删掉云上的副本"
    assert [segment.text for segment in transcript.segments] == ["腾讯云智能语音欢迎您。"]
    assert transcript.audio.duration == 2.386


def test_language_and_diarize_options_reach_the_payload(tmp_path, monkeypatch, fake_cos) -> None:
    _configure(tmp_path, monkeypatch)
    audio = tmp_path / "x.wav"
    audio.write_bytes(b"data")

    provider = TencentCloudUrlProvider()
    calls = _calls_recorder(provider)
    provider.transcribe(
        audio,
        "x.wav",
        TranscriptionOptions(language_code="yue", diarize=False, num_speakers=3),
        existing_speakers=None,
    )

    payload = calls[0][1]
    assert payload["EngineModelType"] == "16k_yue"
    assert payload["SpeakerDiarization"] == 0
    assert payload["SpeakerNumber"] == 3


def test_transcribe_deletes_the_copy_even_when_the_task_fails(
    tmp_path, monkeypatch, fake_cos
) -> None:
    """失败也要清：否则一次失败的转录会在云上留一份访谈原件。"""
    _configure(tmp_path, monkeypatch)
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"data")

    provider = TencentCloudUrlProvider()
    _calls_recorder(provider, status=3)

    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.m4a", TranscriptionOptions(), existing_speakers=None)

    assert excinfo.value.code == "upstream_error"
    assert "decode failed" in str(excinfo.value)
    cos = fake_cos.instances[-1]
    assert cos.deleted == [cos.uploaded[0][0]]


def test_cleanup_failure_does_not_break_a_successful_transcript(
    tmp_path, monkeypatch, fake_cos
) -> None:
    """删除失败只留日志：不能让「没删掉」这件事把已经拿到的转写结果毁掉。"""
    _configure(tmp_path, monkeypatch)
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"data")

    provider = TencentCloudUrlProvider()
    _calls_recorder(provider)

    fake = FakeCos(secret_id="AKIDx", secret_key="secretx", bucket=BUCKET, region=REGION)
    fake.delete_error = ProviderError("删不掉", code="upload_failed")
    monkeypatch.setattr(url_module, "CosClient", lambda **kwargs: fake)

    transcript = provider.transcribe(
        audio, "x.m4a", TranscriptionOptions(), existing_speakers=None
    )

    assert fake.deleted, "确实尝试过删除"
    assert [segment.text for segment in transcript.segments] == ["腾讯云智能语音欢迎您。"]


def test_task_failure_still_wins_over_cleanup_failure(tmp_path, monkeypatch, fake_cos) -> None:
    """两个错同时发生时，抛的必须是与用户相关的那个（任务失败），不是清理失败。"""
    _configure(tmp_path, monkeypatch)
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"data")

    provider = TencentCloudUrlProvider()
    _calls_recorder(provider, status=3)

    fake = FakeCos(secret_id="AKIDx", secret_key="secretx", bucket=BUCKET, region=REGION)
    fake.delete_error = ProviderError("删不掉", code="upload_failed")
    monkeypatch.setattr(url_module, "CosClient", lambda **kwargs: fake)

    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.m4a", TranscriptionOptions(), existing_speakers=None)

    assert excinfo.value.code == "upstream_error", "不能变成上传失败的提示"


# --- 前置校验（不该上传就不上传）--------------------------------------------


def test_oversized_audio_is_rejected_before_uploading(tmp_path, monkeypatch, fake_cos) -> None:
    _configure(tmp_path, monkeypatch)
    monkeypatch.setattr(url_module, "MAX_URL_BYTES", 2 * 1024 * 1024)
    audio = tmp_path / "big.m4a"
    audio.write_bytes(b"x" * (3 * 1024 * 1024))

    provider = TencentCloudUrlProvider()
    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "big.m4a", TranscriptionOptions(), existing_speakers=None)

    assert excinfo.value.code == "file_too_large"
    assert "2MB" in str(excinfo.value), "上限数字要从常量推导，不能手写"
    assert fake_cos.instances == [], "超限的文件不该被传到云上"


def test_missing_bucket_is_reported_before_uploading(tmp_path, monkeypatch, fake_cos) -> None:
    _configure(tmp_path, monkeypatch, bucket=None, region=None)
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"data")

    provider = TencentCloudUrlProvider()
    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.m4a", TranscriptionOptions(), existing_speakers=None)

    assert excinfo.value.code == "cos_not_configured"
    assert excinfo.value.status_code == 409
    assert fake_cos.instances == []


def test_missing_secrets_are_reported_before_uploading(tmp_path, monkeypatch, fake_cos) -> None:
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    settings.save_credentials("tencent_cloud_url", {"bucket": BUCKET, "region": REGION})
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"data")

    provider = TencentCloudUrlProvider()
    with pytest.raises(ProviderError) as excinfo:
        provider.transcribe(audio, "x.m4a", TranscriptionOptions(), existing_speakers=None)

    assert excinfo.value.code == "no_api_key"
    assert fake_cos.instances == []


def test_upload_progress_reaches_the_registry_through_the_job_context(
    tmp_path, monkeypatch, fake_cos
) -> None:
    """上传期间要把「已传多少」报给进度表。

    这是界面上那条「正在上传到云端 xx%」的唯一数据来源；断了它，大文件转录时用户
    又只能对着一个不动的进度条猜程序是不是死了。
    """
    _configure(tmp_path, monkeypatch)
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"x" * 2048)
    provider = TencentCloudUrlProvider()
    _calls_recorder(provider)

    with progress.job_context("job-abc"):
        provider.transcribe(audio, "a.m4a", TranscriptionOptions(), existing_speakers=None)
        snapshot = progress.REGISTRY.snapshot("job-abc")

    assert fake_cos.instances[-1].progress_hooks, "put_object 必须收到进度回调"
    assert snapshot["active"] is True
    assert snapshot["filename"] == "a.m4a"
    assert snapshot["sent_bytes"] == 2048, "回调要真的写进进度表，而不是拿了个函数不用"
    assert snapshot["total_bytes"] == 2048
    assert snapshot["phase"] == progress.PHASE_PROCESSING, "传完即进入「识别中」阶段"


def test_transcription_without_a_job_id_still_works(tmp_path, monkeypatch, fake_cos) -> None:
    """没有 job_id 的路径（从磁盘上的访谈记录直接转录）只是没有进度，功能不受影响。"""
    _configure(tmp_path, monkeypatch)
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"x" * 64)
    provider = TencentCloudUrlProvider()
    _calls_recorder(provider)

    transcript = provider.transcribe(
        audio, "a.m4a", TranscriptionOptions(), existing_speakers=None
    )

    assert transcript.segments
    hook = fake_cos.instances[-1].progress_hooks[-1]
    assert callable(hook)
    hook(10, 10)  # type: ignore[operator]  # 没有 job_id 时调用它该是空操作
    assert progress.REGISTRY.snapshot("") == {"active": False}
