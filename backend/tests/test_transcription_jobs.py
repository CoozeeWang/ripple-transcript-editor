import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import transcription_jobs as jobs


@pytest.fixture(autouse=True)
def isolated_jobs(monkeypatch):
    monkeypatch.setattr(jobs, "JOBS", {})


def test_reconnect_does_not_resubmit_and_completed_results_remain():
    async def scenario():
        gate = asyncio.Event()
        calls = []
        async def work():
            calls.append(1)
            await gate.wait()
            return SimpleNamespace(model_dump=lambda **kw: {"segments": [{"text": "test"}]})
        jobs.submit("job", work)
        await asyncio.sleep(0)
        assert jobs.get("job") == {"state": "running"}
        with pytest.raises(HTTPException) as error:
            jobs.submit("job", work)
        assert error.value.status_code == 409
        gate.set()
        await jobs.JOBS["job"].task
        assert jobs.get("job")["state"] == "completed"
        assert jobs.get("job")["transcript"]["segments"][0]["text"] == "test"
        assert calls == [1]
    asyncio.run(scenario())


def test_failures_are_retrievable_and_recorded_without_raw_errors():
    async def scenario():
        async def work():
            raise HTTPException(502, detail={"code": "network", "message": "connection failed"})
        jobs.submit("job", work)
        await jobs.JOBS["job"].task
        assert jobs.get("job")["state"] == "failed"
        assert jobs.get("job")["status"] == 502
    asyncio.run(scenario())


def test_unknown_job_requires_explicit_new_submission():
    with pytest.raises(HTTPException) as error:
        jobs.get("lost-after-restart")
    assert error.value.status_code == 404


def test_capacity_does_not_evict_running_job(monkeypatch):
    monkeypatch.setattr(jobs, "MAX_JOBS", 1)
    async def scenario():
        gate = asyncio.Event()
        async def work():
            await gate.wait()
            return SimpleNamespace(model_dump=lambda **kw: {})
        jobs.submit("one", work)
        with pytest.raises(HTTPException) as error:
            jobs.submit("two", work)
        assert error.value.status_code == 429
        assert jobs.get("one")["state"] == "running"
        gate.set()
        await jobs.JOBS["one"].task
    asyncio.run(scenario())


def test_background_endpoint_returns_before_provider_and_result_can_be_acknowledged(monkeypatch):
    import threading
    import time

    from fastapi.testclient import TestClient

    from app import main
    from app.models import Transcript
    from app.providers.base import ProviderError
    gate = threading.Event()
    calls = []
    def transcribe(*args):
        calls.append(1)
        if not gate.wait(3):
            raise ProviderError("test timeout")
        return Transcript.model_validate({"audio":{"filename":"test.wav","duration":1},"speakers":[],"segments":[]})
    provider = SimpleNamespace(id="test", name="test", is_configured=lambda:True, transcribe=transcribe)
    monkeypatch.setattr(main, "get_provider", lambda _:provider)
    with TestClient(main.app) as client:
        try:
            response = client.post('/api/transcribe', files={'file':('test.wav',b'audio')}, data={'options':'{}','job_id':'test-job','background':'true'})
            assert response.status_code == 202
            assert client.get('/api/transcribe/jobs/test-job').json()['state'] == 'running'
            # Repeating the submission must not create a second provider request.
            duplicate = client.post('/api/transcribe', files={'file':('test.wav',b'audio')}, data={'options':'{}','job_id':'test-job','background':'true'})
            assert duplicate.status_code == 409
        finally:
            gate.set()
        for _ in range(100):
            result = client.get('/api/transcribe/jobs/test-job').json()
            if result['state'] != 'running':
                break
            time.sleep(.01)
        assert result['state'] == 'completed'
        assert calls == [1]
        assert client.delete('/api/transcribe/jobs/test-job').status_code == 200
        assert client.get('/api/transcribe/jobs/test-job').status_code == 404
