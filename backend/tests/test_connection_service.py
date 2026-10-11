"""Synthetic local acceptance of device authorization and MCP routing."""

import asyncio
import base64
import hashlib
import re
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

from app.connection_service import create_service, digest, validate_url


@pytest.fixture
def anyio_backend():
    return "asyncio"


BASE = "http://127.0.0.1:18801"
VERIFIER = "s" * 64
CHALLENGE = (
    base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
)


def authorize(client, device):
    registration = client.post(
        "/register",
        json={
            "redirect_uris": ["http://127.0.0.1:18802/callback"],
            "token_endpoint_auth_method": "none",
            "client_name": "Synthetic AI",
            "scope": "interview",
        },
    )
    assert registration.status_code == 201, registration.text
    cid = registration.json()["client_id"]
    response = client.get(
        "/authorize",
        params={
            "client_id": cid,
            "redirect_uri": "http://127.0.0.1:18802/callback",
            "response_type": "code",
            "scope": "interview",
            "state": "synthetic-state",
            "resource": BASE + "/mcp",
            "code_challenge": CHALLENGE,
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    assert response.status_code in (302, 303), response.text
    url = response.headers["location"]
    consent = client.get(url)
    assert consent.status_code == 200
    # no-referrer turns a real browser's form Origin into null. Keep same-origin
    # validation while hiding the referring URL from the external callback.
    assert consent.headers["Referrer-Policy"] == "same-origin"
    assert "http://127.0.0.1:18802" in consent.headers["Content-Security-Policy"]
    assert "form-action 'self'" in consent.headers["Content-Security-Policy"]
    csrf = re.search('name="csrf" value="([^"]+)"', consent.text)[1]
    tx = parse_qs(urlparse(url).query)["transaction"][0]
    assert (
        client.post(
            "/pair/approve",
            headers={"Origin": "https://untrusted.invalid"},
            data={"transaction": tx, "csrf": csrf, "code": device["pair_code"]},
        ).status_code
        == 403
    )
    response = client.post(
        "/pair/approve",
        data={"transaction": tx, "csrf": csrf, "code": device["pair_code"]},
        follow_redirects=False,
    )
    assert response.status_code == 303, response.text
    query = parse_qs(urlparse(response.headers["location"]).query)
    assert query["state"] == ["synthetic-state"]
    return cid, query["code"][0], tx, csrf


def exchange(client, cid, code, verifier=VERIFIER):
    return client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "client_id": cid,
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": "http://127.0.0.1:18802/callback",
            "resource": BASE + "/mcp",
        },
    )


def test_pairing_pkce_single_use_refresh_revoke_restart(tmp_path):
    app = create_service(BASE, tmp_path)
    with TestClient(app, base_url=BASE) as client:
        device = client.post("/devices").json()
        headers = {"Authorization": "Bearer " + device["device_token"]}
        cid, code, tx, csrf = authorize(client, device)
        assert exchange(client, cid, code, "wrong").status_code == 400
        token = exchange(client, cid, code)
        assert token.status_code == 200, token.text
        tokens = token.json()
        assert exchange(client, cid, code).status_code == 400
        assert client.post(
            "/pair/approve", data={"transaction": tx, "csrf": csrf, "code": device["pair_code"]}
        ).status_code in (400, 403)
        assert client.get("/devices/status", headers=headers).json()["paired"] is True
        rotated = client.post(
            "/token",
            data={
                "grant_type": "refresh_token",
                "client_id": cid,
                "refresh_token": tokens["refresh_token"],
                "resource": BASE + "/mcp",
            },
        )
        assert rotated.status_code == 200, rotated.text
        assert client.post(
            "/token",
            data={
                "grant_type": "refresh_token",
                "client_id": cid,
                "refresh_token": tokens["refresh_token"],
            },
        ).status_code in (400, 403)
        # Secrets are not stored verbatim.
        data = (tmp_path / "connection.sqlite3").read_bytes()
        assert device["device_token"].encode() not in data
        assert tokens["access_token"].encode() not in data
    # Authorized device and tokens persist a service restart.
    app = create_service(BASE, tmp_path)
    with TestClient(app, base_url=BASE) as client:
        assert client.get("/devices/status", headers=headers).json()["paired"] is True
        assert asyncio.run(app.state.provider.load_access_token(tokens["access_token"]))
        assert client.delete("/devices", headers=headers).status_code == 200
        assert client.get("/devices/status", headers=headers).status_code == 401
        assert asyncio.run(app.state.provider.load_access_token(tokens["access_token"])) is None
        assert client.post(
            "/token",
            data={
                "grant_type": "refresh_token",
                "client_id": cid,
                "refresh_token": rotated.json()["refresh_token"],
            },
        ).status_code in (400, 403)


def test_csrf_redirect_expiration_and_https(tmp_path):
    with pytest.raises(ValueError):
        validate_url("http://example.invalid")
    app = create_service(BASE, tmp_path)
    with TestClient(app, base_url=BASE) as client:
        assert client.post("/pair/approve", data={"code": "wrong"}).status_code == 403
        assert client.post(
            "/register",
            json={
                "redirect_uris": ["https://example.invalid/#fragment"],
                "token_endpoint_auth_method": "none",
            },
        ).status_code in (400, 403)
        assert client.get("/health", headers={"Host": "attacker.invalid"}).status_code in (400, 403)
        device = client.post("/devices").json()
        app.state.store.db.execute('UPDATE records SET expires=0 WHERE kind="pair"')
        app.state.store.db.commit()
        assert app.state.store.get("pair", digest(device["pair_code"])) is None


@pytest.mark.anyio
async def test_authenticated_mcp_tools_route_only_to_paired_device(tmp_path):
    app = create_service(BASE, tmp_path)
    # OAuth setup via synchronous SDK routes; keep the store open for ASGI below.
    with TestClient(app, base_url=BASE) as client:
        device = client.post("/devices").json()
        cid, code, _, _ = authorize(client, device)
        token = exchange(client, cid, code).json()["access_token"]
    app = create_service(BASE, tmp_path)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=BASE) as client,
    ):
        headers = {
            "Authorization": "Bearer " + token,
            "Accept": "application/json, text/event-stream",
        }
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        assert (await client.post("/mcp", json=body)).status_code == 401
        listed = await client.post("/mcp", json=body, headers=headers)
        assert listed.status_code == 200, listed.text
        assert len(listed.json()["result"]["tools"]) == 13
        app.state.relay.seen[device["device_id"]] = __import__("time").monotonic()
        pending = asyncio.create_task(
            client.post(
                "/mcp",
                headers=headers,
                json={
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": "read_current_interview", "arguments": {}},
                },
            )
        )
        await asyncio.sleep(0.1)
        job = (
            await client.get(
                "/devices/jobs", headers={"Authorization": "Bearer " + device["device_token"]}
            )
        ).json()["job"]
        other = (await client.post("/devices")).json()
        reply = {
            "request_id": job["request_id"],
            "result": {"ok": True, "data": {"title": "Synthetic interview"}},
        }
        assert (
            await client.post(
                "/devices/reply",
                headers={"Authorization": "Bearer " + other["device_token"]},
                json=reply,
            )
        ).status_code == 403
        assert (
            await client.post(
                "/devices/reply",
                headers={"Authorization": "Bearer " + device["device_token"]},
                json=reply,
            )
        ).status_code == 200
        response = await pending
        assert response.json()["result"]["structuredContent"]["title"] == "Synthetic interview"
        assert b"Synthetic interview" not in (tmp_path / "connection.sqlite3").read_bytes()
        await client.delete(
            "/devices", headers={"Authorization": "Bearer " + device["device_token"]}
        )
        assert (await client.post("/mcp", headers=headers, json=body)).status_code == 401


def test_add_another_client_preserves_existing_authorization(tmp_path):
    app = create_service(BASE, tmp_path)
    with TestClient(app, base_url=BASE) as client:
        device = client.post("/devices").json()
        headers = {"Authorization": "Bearer " + device["device_token"]}
        cid, code, _, _ = authorize(client, device)
        first = exchange(client, cid, code).json()
        assert client.get("/devices/status", headers=headers).json()["pairing_pending"] is False
        new_pair = client.post("/devices/pair", headers=headers).json()
        assert client.get("/devices/status", headers=headers).json()["pairing_pending"] is True
        second_device = dict(device, **new_pair)
        cid2, code2, _, _ = authorize(client, second_device)
        assert cid != cid2
        assert exchange(client, cid2, code2).status_code == 200
        assert client.get("/devices/status", headers=headers).json()["pairing_pending"] is False
        assert asyncio.run(app.state.provider.load_access_token(first["access_token"]))
