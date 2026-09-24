"""FunASR：本机运行的本地推理服务（WebSocket）。

为什么是本地：FunASR 在你自己的机器上起一个推理服务（默认 ws://127.0.0.1:10095），
软件连过去把音频发过去、拿回带说话人（spk_name）的句子。不上云、无需 API Key，
适合重视隐私的中文访谈转写。

协议（严格对齐 FunASR 官方 runtime/python/websocket/funasr_wss_server.py）：
  连接 -> 发首条 JSON 配置 {"mode":"2pass","chunk_size":"8,8,4","chunk_interval":10,
                             "wav_name":"...","is_speaking":true,"audio_fs":16000}
       -> 把音频切成 PCM16/16k/mono 的二进制帧逐段发
       -> 发末条 JSON {"is_speaking":false,"is_end":true}
       <- 服务端逐句回 JSON {"mode":"2pass-offline","text":"...","spk_name":"spk0",
                            "timestamp":[[start_ms,end_ms,word],...],"is_final":true}
       <- 最后回确认 JSON {"mode":"2pass","is_final":true,"is_end":true}

两个硬前提（会在错误提示里讲清楚）：
  1. 本机必须已经起了 FunASR 服务（funasr_wss_server.py --port 10095）。
  2. 音频要先转成 16k/单声道/16bit PCM——我们用 ffmpeg 做这一步，所以本机要有 ffmpeg。
"""

import asyncio
import json
import re
import subprocess
from pathlib import Path
from typing import ClassVar

from websockets.exceptions import WebSocketException

from ..models import AudioInfo, Segment, Speaker, Transcript, TranscriptionOptions
from ..settings import get_credential
from .base import Capabilities, CredentialField, ProviderError, TranscriptionProvider

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 10095
# 16k 采样 × 单声道 × 2 字节/样本 = 每 0.1 秒 3200 字节，按这个切片发送。
_CHUNK_BYTES = 3200


def normalize_sentences(
    sentences: list[dict],
    audio_filename: str,
    total_duration: float = 0.0,
) -> Transcript:
    """把 FunASR 的逐句结果（text / spk_label / start / end 秒）归一化为内部 Transcript。

    FunASR 只有句子级时间戳（来自 timestamp 字段），没有词级，所以每个句子就是一段
    segment、words 留空，回放时退化为段落级高亮。说话人用 spk_name（如 "spk0"）映射
    成 spk_0 / spk_1 …，名字「说话人 N」。若服务端没返回时间戳，则把各句平摊到整段
    音频时长上，至少保证顺序与大致位置。
    """
    speakers: list[Speaker] = []
    speaker_ids: dict[str, str] = {}
    segments: list[Segment] = []

    for sentence in sentences:
        if not isinstance(sentence, dict):
            continue
        text = str(sentence.get("text") or "").strip()
        if not text:
            continue

        label = str(sentence.get("spk_label") or "spk_0")
        if label not in speaker_ids:
            match = re.search(r"(\d+)", label)
            index = int(match.group(1)) if match else len(speaker_ids)
            speaker_id = f"spk_{len(speaker_ids)}"
            speaker_ids[label] = speaker_id
            speakers.append(Speaker(id=speaker_id, name=f"说话人 {index + 1}"))

        start = float(sentence.get("start") or 0.0)
        end = float(sentence.get("end") or start)
        segments.append(
            Segment(
                id=f"seg_{len(segments) + 1:06d}",
                speaker_id=speaker_ids[label],
                start=start,
                end=max(start, end),
                text=text,
                words=None,
            )
        )

    # 没有时间戳时，把各句平摊到整段音频时长上。
    if segments and all(seg.start == 0.0 and seg.end == 0.0 for seg in segments) and total_duration > 0:
        step = total_duration / len(segments)
        for index, seg in enumerate(segments):
            seg.start = index * step
            seg.end = (index + 1) * step

    duration = max((segment.end for segment in segments), default=0.0)
    return Transcript(
        audio=AudioInfo(filename=audio_filename, duration=duration),
        speakers=speakers,
        segments=segments,
    )


class FunASRProvider(TranscriptionProvider):
    """FunASR（本地）：说话人分离是它相对云端免费的强项，但不返回词级时间戳。"""

    id = "funasr"
    name = "FunASR（本地）"
    experimental = True  # 代码已接入、协议级测试通过，但本机无 GPU/ffmpeg，未做真机验收
    capabilities = Capabilities(
        diarization=True,
        language_selection=False,  # 由服务端自动识别，协议里没有可靠的指定开关
        speaker_count_hint=False,
        audio_events=False,
        word_timestamps=False,  # 只有句子级时间戳
    )
    models: ClassVar[list[str]] = []  # 模型在服务端启动时固定，前端无需选择
    credential_fields: ClassVar[list[CredentialField]] = [
        CredentialField(
            key="host",
            label="服务地址",
            secret=False,
            placeholder=DEFAULT_HOST,
            default_value=DEFAULT_HOST,
            required=False,
        ),
        CredentialField(
            key="port",
            label="端口",
            secret=False,
            placeholder=str(DEFAULT_PORT),
            default_value=str(DEFAULT_PORT),
            required=False,
        ),
    ]

    def _resolve(self) -> tuple[str, int]:
        host = get_credential(self.id, "host") or DEFAULT_HOST
        raw_port = get_credential(self.id, "port") or str(DEFAULT_PORT)
        try:
            port = int(raw_port)
        except (TypeError, ValueError):
            port = DEFAULT_PORT
        return host, port

    def is_configured(self) -> bool:
        # 本地服务没有密钥，「配置好」等价于「地址可达」，这个要真连才知道；
        # 这里直接放行，连不上时 transcribe 会给出明确的排查提示。
        return True

    def _pcm_from_audio(self, audio_path: Path) -> bytes:
        """用 ffmpeg 把任意音频转成 FunASR 要的 PCM16 / 16k / 单声道。"""
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
                    "-f",
                    "s16le",
                    "-",
                ],
                capture_output=True,
                check=False,
            )
        except FileNotFoundError as error:
            raise ProviderError(
                "本机没有 ffmpeg，无法把音频转成 FunASR 需要的 PCM。"
                "请先安装 ffmpeg（macOS: brew install ffmpeg；Windows: 从 ffmpeg.org 下载并加入 PATH）。",
                code="missing_ffmpeg",
            ) from error

        if proc.returncode != 0:
            detail = proc.stderr.decode(errors="replace").strip()
            raise ProviderError(
                "ffmpeg 无法处理这个音频文件，可能是格式损坏或不被支持。",
                code="audio_convert_failed",
                raw=detail,
            )
        return proc.stdout

    @staticmethod
    def _timestamp_bounds(timestamp: object) -> tuple[float, float]:
        """从 FunASR 的 timestamp 字段（词级 [[start_ms,end_ms,word],...]）提取句子起止秒。"""
        if not isinstance(timestamp, list) or not timestamp:
            return 0.0, 0.0

        points: list[tuple[float, float]] = []

        def recurse(node: object) -> None:
            if isinstance(node, list):
                if (
                    len(node) >= 2
                    and isinstance(node[0], (int, float))
                    and not isinstance(node[0], bool)
                ):
                    points.append((float(node[0]), float(node[1])))
                else:
                    for item in node:
                        recurse(item)

        recurse(timestamp)
        if points:
            return points[0][0] / 1000.0, points[-1][1] / 1000.0
        return 0.0, 0.0

    async def _ws_transcribe(
        self, pcm: bytes, host: str, port: int, wav_name: str
    ) -> list[dict]:
        """按 FunASR WS 协议收发，返回逐句结果列表（text / spk_label / start / end）。"""
        import websockets

        uri = f"ws://{host}:{port}"
        sentences: list[dict] = []
        error_text: str | None = None
        try:
            async with websockets.connect(
                uri, open_timeout=10, close_timeout=5, subprotocols=["binary"]
            ) as ws:
                await ws.send(
                    json.dumps(
                        {
                            "mode": "2pass",
                            "chunk_size": "8,8,4",
                            "chunk_interval": 10,
                            "wav_name": wav_name,
                            "is_speaking": True,
                            "audio_fs": 16000,
                        },
                        ensure_ascii=False,
                    )
                )
                for offset in range(0, len(pcm), _CHUNK_BYTES):
                    await ws.send(pcm[offset : offset + _CHUNK_BYTES])
                await ws.send(
                    json.dumps({"is_speaking": False, "is_end": True}, ensure_ascii=False)
                )

                while True:
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=120)
                    except TimeoutError as error:
                        raise ProviderError(
                            "FunASR 未在时限内确认转录完成，已停止处理，避免保存不完整的结果。",
                            code="timeout",
                        ) from error
                    if isinstance(message, bytes):
                        continue
                    data = json.loads(message)
                    if not isinstance(data, dict):
                        raise TypeError("invalid FunASR response")
                    if data.get("error"):
                        error_text = str(data["error"])
                        break
                    mode = data.get("mode", "")
                    # 只收离线/2pass 的整句最终结果（带 is_final 与 text）。
                    if data.get("is_final") and "offline" in mode and data.get("text"):
                        start, end = self._timestamp_bounds(data.get("timestamp"))
                        sentences.append(
                            {
                                "text": data["text"],
                                "spk_label": data.get("spk_name") or "spk_0",
                                "start": start,
                                "end": end,
                            }
                        )
                    if data.get("is_end"):
                        if not data.get("is_final"):
                            raise ProviderError("FunASR 未确认转录完整完成。", code="incomplete_result")
                        break
        except (ValueError, TypeError) as error:
            raise ProviderError("FunASR 返回的结果格式不正确。", code="bad_response") from error
        except (OSError, WebSocketException) as error:
            raise ProviderError(
                f"连不上本机 FunASR 服务（{uri}）。请确认已启动推理服务，"
                f"例如在 FunASR 目录运行：python funasr_wss_server.py --port {port}",
                code="connection_refused",
                raw=str(error),
            ) from error

        if error_text:
            raise ProviderError(f"FunASR 处理失败：{error_text}", code="upstream_error", raw=error_text)
        if not sentences:
            raise ProviderError("FunASR 没有返回可识别的文本。", code="empty_result")
        return sentences

    def transcribe(
        self,
        audio_path: Path,
        original_filename: str,
        options: TranscriptionOptions,
        existing_speakers: list[Speaker] | None = None,
    ) -> Transcript:
        host, port = self._resolve()
        pcm = self._pcm_from_audio(audio_path)
        # PCM16/16k/mono：字节数 / 2 / 16000 = 秒，用于无时间戳时平摊。
        total_duration = len(pcm) / 2 / 16000.0
        sentences = asyncio.run(
            self._ws_transcribe(pcm, host, port, original_filename or "audio")
        )
        return normalize_sentences(sentences, original_filename, total_duration=total_duration)
