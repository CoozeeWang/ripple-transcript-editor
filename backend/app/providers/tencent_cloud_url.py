"""腾讯云录音文件识别（标准版 · 音频链接）。

和 tencent_cloud.py 用的是同一套 API 与签名（TC3-HMAC-SHA256 + CreateRecTask /
DescribeTaskStatus），区别只在**音频怎么送进去**：

  - 文档版（tencent_cloud）：音频 base64 塞进 `Data` 字段（SourceType=1），单文件上限 5MB，
    超了先用 ffmpeg 压成 16k 单声道 opus。
  - URL 版（本文件）：先把音频原样上传到腾讯云 COS，再把一个限时私有下载链接交给腾讯云
    （SourceType=0 + `Url`），由它自己来取。上限因此抬到 1GB / 5 小时，且不压缩、不动音质。

这解决的现实问题是：一批 100MB 以上的访谈录音，压缩会掉音质，而 5MB 那条路根本走不通。

**失败也要把云上的副本删掉**：整段流程包在 try/finally 里，无论转录成功、报错还是被取消，
都会去删 COS 对象——否则就留了一份访谈原件在云上（虽然每小时不到一厘钱，但没必要）。
删除失败只记日志、不往上抛，免得盖掉真正的转录错误；进程被杀这类极端情况靠桶上的生命周期
规则兜底。

复用父类（tencent_cloud）的 _call（签名 + 错误翻译）、_wait_task（轮询、
normalize_result_detail（结果归一化）；本文件只负责「音频怎么上去」这一段。

上传全程把进度报给界面：这一段是大文件最慢的地方，没有进度用户只能干等（2026-09-14 实测同一个
201.9MB 的文件，网络好时 35 秒传完，差时挂了 12 分钟，而界面在这两种情况下长得一模一样）。

真机验收：2026-09-14 21:49 用真实密钥 + 真实桶跑通（201.9MB / 2 小时 29 分，全程 155.4 秒，
对象在结束时删除）。
"""

import json
from pathlib import Path
from typing import ClassVar

from ..cos import OBJECT_PREFIX, CosClient, object_key
from ..models import Speaker, Transcript, TranscriptionOptions
from ..progress import report_upload
from ..settings import get_credential
from .base import Capabilities, CredentialField, ProviderError
from .diagnostics import human_bytes, logger
from .tencent_cloud import (
    DEFAULT_ENGINE_MODEL,
    ENGINE_MODEL_BY_LANG,
    TencentCloudProvider,
    normalize_result_detail,
)

# 官方文档：URL 方式单文件不超过 1GB，时长不超过 5 小时。
MAX_URL_BYTES = 1024 * 1024 * 1024
MAX_DURATION_SECONDS = 5 * 3600

# 密钥回落来源：URL 版与标准版共用同一对 SecretId / SecretKey，用户不必复制两遍。
SHARED_CREDENTIAL_PROVIDER_ID = TencentCloudProvider.id


class TencentCloudUrlProvider(TencentCloudProvider):
    """腾讯云录音文件识别（标准版）的「音频链接」提交方式。大文件专用。"""

    id = "tencent_cloud_url"
    name = "腾讯云录音文件识别（标准版 · 音频链接）"
    experimental = False  # 2026-09-14 真机跑通（真实密钥 + 真实桶）：201.9MB / 2 小时 29 分，155.4 秒
    capabilities = Capabilities(
        diarization=True,
        language_selection=True,
        speaker_count_hint=True,
        audio_events=False,
        word_timestamps=True,
        max_file_bytes=MAX_URL_BYTES,
        max_duration_seconds=MAX_DURATION_SECONDS,
    )
    models: ClassVar[list[str]] = list(TencentCloudProvider.models)
    credential_fields: ClassVar[list[CredentialField]] = [
        CredentialField(
            key="bucket",
            label="存储桶",
            secret=False,
            placeholder="形如 ripple-audio-1250000000（在 COS 控制台的桶列表里复制）",
        ),
        CredentialField(
            key="region",
            label="地域",
            secret=False,
            placeholder="ap-beijing（必须与桶所在地域一致）",
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

    # ---- 凭据 -----------------------------------------------------------------
    # 本引擎自己的槽优先，留空则回落到标准版那一对（与极速版同样的做法）。
    def _secret_id(self) -> str | None:
        return get_credential(self.id, "secret_id") or get_credential(
            SHARED_CREDENTIAL_PROVIDER_ID, "secret_id"
        )

    def _secret_key(self) -> str | None:
        return get_credential(self.id, "secret_key") or get_credential(
            SHARED_CREDENTIAL_PROVIDER_ID, "secret_key"
        )

    def _bucket(self) -> str | None:
        return get_credential(self.id, "bucket")

    def _region(self) -> str | None:
        return get_credential(self.id, "region")

    def is_configured(self) -> bool:
        # 桶与地域是这条路的必需品：没有它们，音频没地方放。
        return bool(
            self._bucket() and self._region() and self._secret_id() and self._secret_key()
        )

    # ---- 提交 -----------------------------------------------------------------
    def _create_task(
        self, audio_url: str, options: TranscriptionOptions, secret_id: str, secret_key: str
    ) -> int:
        """提交任务：SourceType=0 表示「音频在某个 URL 上，你自己去下」。"""
        engine = ENGINE_MODEL_BY_LANG.get(options.language_code or "zho", DEFAULT_ENGINE_MODEL)
        payload: dict = {
            "EngineModelType": engine,
            "ChannelNum": 1,
            # 2 = 基础结果 + 词级时间戳 + 语速值 + 标点（ResultDetail 在此模式下才稳定返回）
            "ResTextFormat": 2,
            "SourceType": 0,  # 0 = 通过 Url 字段给出音频地址
            "Url": audio_url,
            "SpeakerDiarization": 1 if options.diarize else 0,
        }
        if options.num_speakers is not None:
            payload["SpeakerNumber"] = options.num_speakers

        result = self._call("CreateRecTask", payload, secret_id, secret_key)
        inner = (result.get("Response") or {}).get("Data") or {}
        task_id = inner.get("TaskId")
        if task_id is None:
            raise ProviderError(
                "腾讯云创建转写任务失败，未返回 TaskId",
                code="upstream_error",
                raw=json.dumps(result, ensure_ascii=False),
            )
        return int(task_id)

    @staticmethod
    def _discard(client: CosClient, key: str) -> None:
        """尽力删掉云上的副本；删不掉只记日志，不干扰真正的转录结果。"""
        try:
            client.delete_object(key)
        except ProviderError as error:
            logger.warning(
                "COS 对象没删掉 key=%s：%s。桶里会留下一份音频，可到控制台手工删除，"
                "或给桶挂一条「%s/ 下 1 天后自动删除」的生命周期规则。",
                key,
                error,
                OBJECT_PREFIX,
            )

    def transcribe(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        existing_speakers: list[Speaker] | None = None,
    ) -> Transcript:
        secret_id = self._secret_id()
        secret_key = self._secret_key()
        bucket = self._bucket()
        region = self._region()

        if not secret_id or not secret_key:
            raise ProviderError(
                "请先在设置里填写腾讯云的 SecretId 和 SecretKey",
                status_code=409,
                code="no_api_key",
            )
        if not bucket or not region:
            raise ProviderError(
                "这条引擎要先把音频传到腾讯云 COS，还缺存储桶或地域："
                "到设置的「腾讯云录音文件识别（标准版 · 音频链接）」里填上 Bucket 和 Region。",
                status_code=409,
                code="cos_not_configured",
            )

        size = audio_path.stat().st_size
        if size > MAX_URL_BYTES:
            limit_mb = MAX_URL_BYTES // 1024 // 1024
            raise ProviderError(
                f"这段音频 {size / 1024 / 1024:.1f}MB，超过音频链接方式单文件 {limit_mb}MB 的"
                f"上限（另有 {MAX_DURATION_SECONDS // 3600} 小时时长上限）。可以剪成几段分别转录。",
                code="file_too_large",
            )

        client = CosClient(
            secret_id=secret_id, secret_key=secret_key, bucket=bucket, region=region
        )
        key = object_key(original_filename)
        logger.info(
            "上传音频到 COS key=%s（%s），转录结束后自动删除", key, human_bytes(size)
        )
        # 上传期间把「已传多少字节」报给界面；出了这个 with 就算进入「识别中」阶段。
        with report_upload(original_filename, size) as report:
            client.put_object(key, audio_path, on_progress=report)
        try:
            url = client.presigned_get_url(key)
            task_id = self._create_task(url, options, secret_id, secret_key)
            task_data = self._wait_task(task_id, secret_id, secret_key)
        finally:
            self._discard(client, key)

        return normalize_result_detail(
            task_data, original_filename, existing_speakers=existing_speakers
        )
