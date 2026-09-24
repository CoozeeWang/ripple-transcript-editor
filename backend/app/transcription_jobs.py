"""Recover browser connections without submitting the audio to the provider twice.

Results stay in memory for 24 hours, up to 20 jobs. Backend restart is explicitly
not recoverable; this is not provider-side checkpointing.
"""
import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import HTTPException

from . import diagnostics


@dataclass
class Job:
    task: asyncio.Task
    created: float

JOBS: dict[str, Job] = {}
RETENTION = 86400
MAX_JOBS = 20

def prune():
    for key, job in list(JOBS.items()):
        if job.task.done() and time.monotonic() - job.created > RETENTION:
            del JOBS[key]

def get(job_id: str):
    prune()
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, detail="任务已失效，后台可能已重启。")
    if not job.task.done():
        return {"state": "running"}
    return job.task.result()

def ensure_capacity(job_id: str):
    prune()
    if job_id in JOBS:
        raise HTTPException(409, detail="此任务已提交，请查询原任务。")
    if len(JOBS) >= MAX_JOBS:
        raise HTTPException(429, detail="待领取的转录任务过多，请先领取结果。")

def submit(job_id: str, work: Callable[[], Awaitable]):
    ensure_capacity(job_id)
    async def run():
        try:
            result = await work()
            return {"state": "completed", "transcript": result.model_dump(mode="json")}
        except HTTPException as exc:
            diagnostics.record_failure("transcription", exc.status_code)
            return {"state": "failed", "status": exc.status_code, "detail": exc.detail}
        except Exception:  # noqa: BLE001 -- Background failures must remain queryable without leaking provider data.
            diagnostics.record_failure("transcription", 500)
            return {"state": "failed", "status": 500, "detail": "转录未完成，请重试。"}
        finally:
            if job_id in JOBS:
                JOBS[job_id].created = time.monotonic()
    JOBS[job_id] = Job(asyncio.create_task(run()), time.monotonic())
