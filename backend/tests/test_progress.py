"""上传进度上报的测试。

这套机制要解决的是「大文件转录时界面一动不动」：后端把「传到哪了」记在进程内的槽里，
前端按秒拉一个只读接口（`GET /api/transcribe/progress`）。这里锁住四件事：

1. 进度表本身的增删改查，以及「查不到不是错误」这条约定；
2. job_id 的收口（前端传什么都进不来奇怪的键）；
3. **最要命的一条假设**：job_id 走 ContextVar 传给引擎，而引擎跑在线程里
   （`asyncio.to_thread`）—— 上下文必须能穿过去，否则进度永远是空的；
4. 上传失败时不能留一条「传到 30%」挂在那里。
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import progress
from app.main import app

client = TestClient(app)


# --- 进度表 -----------------------------------------------------------------


def test_registry_tracks_bytes_and_phase() -> None:
    registry = progress.ProgressRegistry()
    registry.begin("j1", "a.m4a", 1000, phase=progress.PHASE_SENDING)
    registry.advance("j1", 400)

    first = registry.snapshot("j1")
    assert first["active"] is True
    assert (first["sent_bytes"], first["total_bytes"]) == (400, 1000)
    assert first["phase"] == progress.PHASE_SENDING
    assert first["filename"] == "a.m4a"
    assert first["elapsed_seconds"] >= 0

    registry.switch_phase("j1", progress.PHASE_PROCESSING)
    assert registry.snapshot("j1")["phase"] == progress.PHASE_PROCESSING

    registry.end("j1")
    assert registry.snapshot("j1") == {"active": False}


def test_unknown_job_is_simply_inactive() -> None:
    """「查不到」不是错误：不是每个引擎都有「先传到云端」这一步。"""
    assert progress.ProgressRegistry().snapshot("nope") == {"active": False}


def test_operations_on_an_unknown_job_do_not_raise() -> None:
    """任务已经被摘掉之后前端还在轮询是常态，不能因此报错。"""
    registry = progress.ProgressRegistry()
    registry.advance("nope", 10)
    registry.switch_phase("nope", progress.PHASE_PROCESSING)
    registry.end("nope")


def test_progress_never_goes_negative() -> None:
    registry = progress.ProgressRegistry()
    registry.begin("j1", "a.m4a", -5, phase=progress.PHASE_SENDING)
    registry.advance("j1", -100)
    snapshot = registry.snapshot("j1")
    assert (snapshot["sent_bytes"], snapshot["total_bytes"]) == (0, 0)


# --- job_id 收口 ------------------------------------------------------------


@pytest.mark.parametrize("value", ["", None, "有中文", "a" * 65, "with space", "semi;colon", "a/b"])
def test_safe_job_id_rejects_junk(value: str | None) -> None:
    assert progress.safe_job_id(value) is None


def test_safe_job_id_accepts_uuid_like_ids() -> None:
    assert progress.safe_job_id("2f1c8d3e-9a44-4b12-8f77-0d1c9b2e5a11") is not None
    assert progress.safe_job_id("job_1-A") is not None


# --- 上下文传递 -------------------------------------------------------------


def test_context_is_empty_outside_a_request() -> None:
    assert progress.current_job() is None


def test_job_id_survives_asyncio_to_thread() -> None:
    """引擎是在线程里跑的（asyncio.to_thread），job_id 必须能穿过去。

    这条假设一旦不成立，进度上报会静默失效 —— 不会报错，只是永远没有进度，
    排查起来极费劲，所以专门钉一个测试。
    """

    async def main() -> str | None:
        with progress.job_context("job-thread"):
            return await asyncio.to_thread(progress.current_job)

    assert asyncio.run(main()) == "job-thread"


def test_job_context_nests_cleanly() -> None:
    with progress.job_context("outer"):
        with progress.job_context("inner"):
            assert progress.current_job() == "inner"
        assert progress.current_job() == "outer"
    assert progress.current_job() is None


# --- report_upload ----------------------------------------------------------


def test_report_upload_advances_then_switches_to_processing() -> None:
    with progress.job_context("job-r"):
        with progress.report_upload("a.m4a", 500) as report:
            report(100, 500)
            mid = progress.REGISTRY.snapshot("job-r")
            assert mid["sent_bytes"] == 100
            assert mid["phase"] == progress.PHASE_SENDING
        # 上传成功退出即进入「识别中」——引擎接下来要跑很久，界面得说清在等什么
        assert progress.REGISTRY.snapshot("job-r")["phase"] == progress.PHASE_PROCESSING
        progress.finish()
    assert progress.REGISTRY.snapshot("job-r") == {"active": False}


def test_report_upload_removes_the_entry_when_the_upload_fails() -> None:
    """上传失败时不该留一条「传到 30%」挂在那儿 —— 失败原因由引擎给出。"""
    # 异常要原样往上抛，不能被进度记录吃掉
    with (
        progress.job_context("job-f"),
        pytest.raises(RuntimeError),
        progress.report_upload("a.m4a", 500) as report,
    ):
        report(150, 500)
        raise RuntimeError("连接断了")

    assert progress.REGISTRY.snapshot("job-f") == {"active": False}


def test_report_upload_without_a_job_id_is_a_no_op() -> None:
    """从磁盘上的访谈记录直接转录那条路没有 job_id：只是没有进度可看，不能报错。"""
    with progress.report_upload("a.m4a", 500) as report:
        report(10, 500)
        report(500, 500)
    assert progress.REGISTRY.snapshot("") == {"active": False}


def test_finish_without_a_job_id_is_a_no_op() -> None:
    progress.finish()


# --- 接口 -------------------------------------------------------------------


def test_progress_endpoint_reports_inactive_for_unknown_job() -> None:
    response = client.get("/api/transcribe/progress", params={"job_id": "nope"})
    assert response.status_code == 200
    assert response.json() == {"active": False}


def test_progress_endpoint_without_job_id_is_still_an_answer() -> None:
    """少传参数不该是 422：前端拿不到任务时应该看到「没有任务」，而不是一个错误。"""
    response = client.get("/api/transcribe/progress")
    assert response.status_code == 200
    assert response.json() == {"active": False}


def test_progress_endpoint_reads_the_registry() -> None:
    progress.REGISTRY.begin("job-api", "a.m4a", 1000, phase=progress.PHASE_SENDING)
    progress.REGISTRY.advance("job-api", 250)
    try:
        body = client.get("/api/transcribe/progress", params={"job_id": "job-api"}).json()
    finally:
        progress.REGISTRY.end("job-api")

    assert body["active"] is True
    assert body["sent_bytes"] == 250
    assert body["total_bytes"] == 1000
    assert body["phase"] == progress.PHASE_SENDING
    assert body["filename"] == "a.m4a"
