"""Synthetic desktop transport tests; no real credentials or documents."""

import asyncio
import json
import os

import httpx
import pytest

from app import connector_relay as relay


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_configuration_hides_credentials_and_persists_restart(tmp_path, monkeypatch):
    device_token = "synthetic-device-token-not-public"
    paired = False

    def handler(request):
        nonlocal paired
        if request.method == "POST" and request.url.path == "/devices":
            return httpx.Response(
                200,
                json={
                    "device_id": "device",
                    "device_token": device_token,
                    "pair_code": "123456ABCDEF",
                    "expires_at": 100,
                },
            )
        assert request.headers["Authorization"] == "Bearer " + device_token
        if request.url.path == "/devices/status":
            return httpx.Response(200, json={"paired": paired})
        if request.method == "DELETE":
            paired = False
            return httpx.Response(200, json={"revoked": True})
        return httpx.Response(200, json={"pair_code": "ABCDEF123456", "expires_at": 200})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        relay.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    result = await relay.configure(tmp_path, "http://127.0.0.1:18801", "pair")
    assert "device_token" not in result
    assert device_token not in json.dumps(result)
    assert os.stat(tmp_path / "connector/relay.json").st_mode & 0o777 == 0o600
    paired = True
    assert (await relay.configure(tmp_path, "http://127.0.0.1:18801", "status"))["paired"]
    assert relay.saved(tmp_path)["device_token"] == device_token
    await relay.configure(tmp_path, "http://127.0.0.1:18801", "revoke")
    assert relay.saved(tmp_path) is None


@pytest.mark.anyio
@pytest.mark.parametrize("local_timeout", [False, True])
async def test_lost_reply_retries_only_delivery_never_local_write(
    tmp_path, monkeypatch, local_timeout
):
    relay.persist(
        tmp_path,
        {
            "base_url": "http://127.0.0.1:18801",
            "device_id": "device",
            "device_token": "synthetic-device",
        },
    )
    (tmp_path / "connector/client.key").write_text("s" * 40)
    writes, replies = [], []
    ended = asyncio.Event()
    jobs = [
        {
            "request_id": "synthetic-request",
            "operation": "apply_marks",
            "arguments": {"task_id": "synthetic"},
        }
    ]

    async def handler(request):
        if request.url.port == 18701:
            writes.append(json.loads(request.content))
            if local_timeout:
                raise httpx.ReadTimeout("Unknown write outcome", request=request)
            return httpx.Response(200, json={"ok": True, "data": {"saved": True}})
        if request.url.path == "/devices/status":
            return httpx.Response(200, json={"paired": True})
        if request.url.path == "/devices/heartbeat":
            return httpx.Response(200, json={"ready": True})
        if request.url.path == "/devices/jobs":
            if jobs:
                return httpx.Response(200, json={"job": jobs.pop()})
            await ended.wait()
            return httpx.Response(401)
        if request.url.path == "/devices/reply":
            replies.append(json.loads(request.content))
            if len(replies) == 1:
                raise httpx.ReadTimeout("Lost reply delivery", request=request)
            ended.set()
            return httpx.Response(200, json={"accepted": True})
        raise AssertionError(request.url)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        relay.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    await asyncio.wait_for(relay.run_worker(tmp_path, "http://127.0.0.1:18701"), 5)
    assert len(writes) == 1
    assert len(replies) == 2 and replies[0] == replies[1]
    assert replies[0]["result"]["ok"] == (not local_timeout)
    assert not (tmp_path / "connector/relay-status.json").exists()
