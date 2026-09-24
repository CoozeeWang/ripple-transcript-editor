"""转录任务的实时进度。

**为什么需要它**：大文件转录里最慢的一段是「本地后端 → 云上对象存储」的上传，而前端那次
`POST /api/transcribe` 是一个不返回中间状态的普通请求 —— 用户在整段上传期间看到的界面毫无变化。
2026-09-14 实测同一个 201.9MB 的文件：网络好时 35 秒传完，差时 12 分钟挂掉，而界面在这两种
情况下长得一模一样，用户只能盯着一个不动的进度条等。没有进度，用户连「它在慢慢走」和
「它已经死了」都分不出来。

**做法**：后端把「当前这次上传传了多少字节」记在一个进程内的槽里，前端按秒拉一个只读接口。
刻意不做 WebSocket / SSE —— 只有一条进度线要报，轮询足够，也不给本地服务引入长连接的生命周期问题。

**任务身份**：用前端生成、随表单一起提交的 `job_id`，不按文件名认领 —— 同一个文件先后跑两次
不会串号。没有 job_id 的调用路径（例如从磁盘上的访谈记录直接转录那条）只是没有进度可看，
功能不受影响。

**为什么不把 job_id 一路当参数传下去**：那要改所有引擎的 `transcribe()` 签名，而进度只有
「要走云端上传的引擎」用得上。改用 ContextVar：main.py 在进入请求时设一次，引擎在自己内部
按需读取。`asyncio.to_thread` 会复制当前上下文，所以引擎线程里读得到。
"""

from __future__ import annotations

import re
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

# 进度上报的两个阶段，与前端 TranscriptionPhase 一一对应：
#   "sending"    —— 正在把音频传到云端存储（有字节进度）
#   "processing" —— 已交给引擎，正在识别（没有进度可报，只能报时长）
PHASE_SENDING = "sending"
PHASE_PROCESSING = "processing"

# job_id 只当字典键用，但长度与字符集还是要收一下，免得被塞进奇怪的东西。
_JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_current_job: ContextVar[str | None] = ContextVar("ripple_progress_job", default=None)


@dataclass
class Task:
    """一次转录任务的进度快照（在内存里，进程结束即消失）。"""

    job_id: str
    filename: str
    phase: str
    total_bytes: int = 0
    sent_bytes: int = 0
    started_at: float = 0.0
    updated_at: float = 0.0


class ProgressRegistry:
    """进程内的进度表。同一时间通常只有一个任务，但仍然按 job_id 分开存。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tasks: dict[str, Task] = {}

    def begin(self, job_id: str, filename: str, total_bytes: int, phase: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._tasks[job_id] = Task(
                job_id=job_id,
                filename=filename,
                phase=phase,
                total_bytes=max(total_bytes, 0),
                sent_bytes=0,
                started_at=now,
                updated_at=now,
            )

    def advance(self, job_id: str, sent_bytes: int) -> None:
        with self._lock:
            task = self._tasks.get(job_id)
            if task is None:
                return
            task.sent_bytes = max(sent_bytes, 0)
            task.updated_at = time.monotonic()

    def switch_phase(self, job_id: str, phase: str) -> None:
        with self._lock:
            task = self._tasks.get(job_id)
            if task is None:
                return
            task.phase = phase
            task.updated_at = time.monotonic()

    def end(self, job_id: str) -> None:
        with self._lock:
            self._tasks.pop(job_id, None)

    def snapshot(self, job_id: str) -> dict:
        """给接口用的只读视图。没有这个任务就返回 active=False（前端据此保持原样）。"""
        with self._lock:
            task = self._tasks.get(job_id)
            if task is None:
                return {"active": False}
            return {
                "active": True,
                "filename": task.filename,
                "phase": task.phase,
                "sent_bytes": task.sent_bytes,
                "total_bytes": task.total_bytes,
                "elapsed_seconds": round(task.updated_at - task.started_at, 1),
            }


REGISTRY = ProgressRegistry()


def safe_job_id(value: str | None) -> str | None:
    """把前端传来的 job_id 收成合法值；不合规就当没有（宁可不显示进度，也不接受脏键）。"""
    if value and _JOB_ID_PATTERN.match(value):
        return value
    return None


@contextmanager
def job_context(job_id: str | None) -> Iterator[None]:
    """进入一次请求：把 job_id 放进上下文，供引擎在内部读取。"""
    token = _current_job.set(job_id)
    try:
        yield
    finally:
        _current_job.reset(token)


def current_job() -> str | None:
    return _current_job.get()


@contextmanager
def report_upload(filename: str, total_bytes: int) -> Iterator[Callable[[int, int], None]]:
    """登记「正在上传到云端」并给出一个「已传多少」的回调。

    用法（在引擎里）：

        with report_upload(filename, size) as report:
            client.put_object(key, path, on_progress=report)

    上传成功退出时自动切到「识别中」；抛异常时把这条进度撤掉（失败信息由引擎给出，
    进度条不该继续挂在那里）。没有 job_id 时回调是空操作，功能不受影响。
    """
    job_id = current_job()
    if job_id is None:
        yield _ignore
        return
    REGISTRY.begin(job_id, filename, total_bytes, phase=PHASE_SENDING)
    try:
        # 回调签名与 CosClient 的 on_progress 一致：(已传字节, 总字节)。
        # 总字节这里用不上（开始的时候就记下了），但对齐签名省得两边各写一套。
        yield lambda sent, _total: REGISTRY.advance(job_id, sent)
    except Exception:
        REGISTRY.end(job_id)
        raise
    else:
        REGISTRY.switch_phase(job_id, PHASE_PROCESSING)


def finish() -> None:
    """转录结束（无论成败）把当前任务从进度表里摘掉。由 main.py 在请求收尾时调用。"""
    job_id = current_job()
    if job_id is not None:
        REGISTRY.end(job_id)


def _ignore(_sent: int, _total: int) -> None:
    """没有 job_id 时的空回调。签名与 CosClient 的 on_progress 保持一致。"""
