"""Deployable Ripple relay: OAuth metadata on disk, interview RPC only in memory.

One process per deployment. Do not enable HTTP access logs: authorization URLs
contain short-lived codes. Public deployments require HTTPS and request limits.
"""

import asyncio
import hashlib
import html
import json
import os
import secrets
import sqlite3
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from .connector_mcp import INSTRUCTIONS, register_tools

SCOPE = "interview"
OPERATIONS = frozenset(
    (
        "set_rules",
        "read_current",
        "read_page",
        "read_examples",
        "prepare",
        "stage",
        "publish",
        "status",
        "cancel",
        "prepare_marks",
        "stage_marks",
        "apply_marks",
        "marks_status",
        "cancel_marks",
    )
)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def validate_url(value):
    p = urlparse(value)
    if p.username or p.password or p.query or p.fragment or p.path not in ("", "/"):
        raise ValueError("Connection service must be an origin URL")
    if p.scheme != "https" and not (
        p.scheme == "http" and p.hostname in ("127.0.0.1", "localhost", "::1")
    ):
        raise ValueError("HTTPS required except for loopback development")
    if not p.hostname:
        raise ValueError("Missing service host")
    return value.rstrip("/")


class Store:
    """No transcript fields. Secret lookup keys are SHA256 digests."""

    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.is_symlink():
            raise ValueError("Database must not be a symlink")
        self.db = sqlite3.connect(path, check_same_thread=False)
        os.chmod(path, 0o600)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS records(kind TEXT, key TEXT, body TEXT, expires REAL, PRIMARY KEY(kind,key))"
        )
        self.db.commit()

    def put(self, kind, key, body, expires):
        with self.db:
            self.db.execute("DELETE FROM records WHERE expires < ?", (time.time(),))
            count = self.db.execute("SELECT count(*) FROM records").fetchone()[0]
            if count >= 10000:
                raise HTTPException(503, "service_capacity")
            self.db.execute(
                "INSERT OR REPLACE INTO records VALUES(?,?,?,?)",
                (kind, key, json.dumps(body), expires),
            )

    def get(self, kind, key, consume=False):
        with self.db:
            row = self.db.execute(
                "SELECT body,expires FROM records WHERE kind=? AND key=?", (kind, key)
            ).fetchone()
            if consume:
                self.db.execute("DELETE FROM records WHERE kind=? AND key=?", (kind, key))
            if not row or row[1] <= time.time():
                return None
            return json.loads(row[0])

    def revoke(self, device):
        with self.db:
            # Every grant to this device is invalidated, including refresh tokens.
            rows = self.db.execute("SELECT kind,key,body FROM records").fetchall()
            for kind, key, body in rows:
                if json.loads(body).get("subject") == device:
                    self.db.execute("DELETE FROM records WHERE kind=? AND key=?", (kind, key))


class Provider:
    def __init__(self, store, base):
        self.store, self.base = store, base

    async def get_client(self, client_id):
        data = self.store.get("client", client_id)
        return OAuthClientInformationFull.model_validate(data) if data else None

    async def register_client(self, client):
        if client.token_endpoint_auth_method != "none":
            raise RegistrationError("invalid_client_metadata", "Use a public client with PKCE")
        for uri in client.redirect_uris or []:
            p = urlparse(str(uri))
            if (
                p.fragment
                or p.username
                or (
                    p.scheme != "https"
                    and not (p.scheme == "http" and p.hostname in ("localhost", "127.0.0.1", "::1"))
                )
            ):
                raise RegistrationError(
                    "invalid_redirect_uri", "HTTPS or loopback redirect required"
                )
        self.store.put(
            "client", client.client_id, client.model_dump(mode="json"), time.time() + 365 * 86400
        )

    async def authorize(self, client, params):
        if params.resource != self.base + "/mcp":
            raise TokenError("invalid_target", "Ripple resource required")
        tx = secrets.token_urlsafe(32)
        self.store.put(
            "transaction",
            digest(tx),
            {"client_id": client.client_id, "params": params.model_dump(mode="json")},
            time.time() + 300,
        )
        return self.base + "/pair?transaction=" + tx

    async def load_authorization_code(self, client, code):
        data = self.store.get("code", digest(code))
        if not data or data["client_id"] != client.client_id:
            return None
        return AuthorizationCode(code=code, **data)

    def issue(self, subject, client_id, scopes, resource):
        if not self.store.get("device", subject):
            raise TokenError("invalid_grant", "Device disconnected")
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        common = {
            "client_id": client_id,
            "scopes": scopes,
            "resource": resource,
            "subject": subject,
        }
        self.store.put(
            "access",
            digest(access),
            dict(common, expires_at=int(time.time()) + 3600),
            time.time() + 3600,
        )
        self.store.put(
            "refresh",
            digest(refresh),
            dict(common, expires_at=int(time.time()) + 30 * 86400),
            time.time() + 30 * 86400,
        )
        return OAuthToken(
            access_token=access, refresh_token=refresh, expires_in=3600, scope=" ".join(scopes)
        )

    async def exchange_authorization_code(self, client, code):
        data = self.store.get("code", digest(code.code), consume=True)
        if not data or data["client_id"] != client.client_id:
            raise TokenError("invalid_grant", "Code already used or expired")
        return self.issue(data["subject"], client.client_id, data["scopes"], data["resource"])

    async def load_refresh_token(self, client, token):
        data = self.store.get("refresh", digest(token))
        if (
            not data
            or data["client_id"] != client.client_id
            or not self.store.get("device", data["subject"])
        ):
            return None
        return RefreshToken(token=token, **data)

    async def exchange_refresh_token(self, client, token, scopes):
        data = self.store.get("refresh", digest(token.token), consume=True)
        if (
            not data
            or data["client_id"] != client.client_id
            or not set(scopes).issubset(data["scopes"])
        ):
            raise TokenError("invalid_grant", "Refresh token invalid or already used")
        return self.issue(data["subject"], client.client_id, scopes, data["resource"])

    async def load_access_token(self, token):
        data = self.store.get("access", digest(token))
        if not data or not self.store.get("device", data["subject"]):
            return None
        return AccessToken(token=token, **data)

    async def revoke_token(self, token):
        if token.subject:
            self.store.revoke(token.subject)


class Relay:
    def __init__(self):
        self.queues, self.pending, self.seen = {}, {}, {}

    async def call(self, device, operation, arguments):
        if time.monotonic() - self.seen.get(device, 0) > 45:
            raise ToolError("Ripple is offline. Open Ripple and enable its connection.")
        if len(self.pending) >= 256:
            raise ToolError("Ripple connection busy")
        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = (device, future)
        self.queues.setdefault(device, deque()).append(
            {"request_id": request_id, "operation": operation, "arguments": arguments}
        )
        try:
            result = await asyncio.wait_for(asyncio.shield(future), 125)
            if not result.get("ok"):
                raise ToolError(result.get("error", "Ripple operation failed"))
            return result["data"]
        except TimeoutError as error:
            raise ToolError(
                "Outcome unknown. Check task status before repeating a write."
            ) from error
        finally:
            self.pending.pop(request_id, None)
            queue = self.queues.get(device, deque())
            self.queues[device] = deque(j for j in queue if j["request_id"] != request_id)

    async def poll(self, device):
        self.seen[device] = time.monotonic()
        for _ in range(100):
            queue = self.queues.setdefault(device, deque())
            if queue:
                return queue.popleft()
            await asyncio.sleep(0.2)
        return None

    def reply(self, device, request_id, result):
        item = self.pending.get(request_id)
        if item and item[0] != device:
            raise HTTPException(403, "wrong_device")
        if item and not item[1].done():
            item[1].set_result(result)

    def revoke(self, device):
        self.seen.pop(device, None)
        self.queues.pop(device, None)
        for owner, future in self.pending.values():
            if owner == device and not future.done():
                future.set_result({"ok": False, "error": "Device disconnected"})


def create_service(base_url, data_dir):
    base = validate_url(base_url)
    store = Store(Path(data_dir) / "connection.sqlite3")
    provider, relay = Provider(store, base), Relay()

    async def call(operation, arguments):
        token = get_access_token()
        if not token or not token.subject or SCOPE not in token.scopes:
            raise ToolError("Ripple authorization required")
        # Recheck revocation even within an established MCP session.
        if not await provider.load_access_token(token.token):
            raise ToolError("Ripple authorization revoked")
        return await relay.call(token.subject, operation, arguments)

    mcp = register_tools(
        MCPServer(
            "Ripple",
            instructions=INSTRUCTIONS,
            auth_server_provider=provider,
            auth=AuthSettings(
                issuer_url=base,
                resource_server_url=base + "/mcp",
                required_scopes=[SCOPE],
                validate_token_resource=True,
                client_registration_options=ClientRegistrationOptions(
                    enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]
                ),
                revocation_options=RevocationOptions(enabled=True),
            ),
        ),
        call,
    )
    parsed = urlparse(base)
    transport = mcp.streamable_http_app(
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[parsed.netloc],
            allowed_origins=[base],
        ),
    )

    @asynccontextmanager
    async def lifespan(app):
        async with transport.router.lifespan_context(transport):
            yield
        store.db.close()

    app = FastAPI(lifespan=lifespan)
    app.state.store, app.state.provider, app.state.relay = store, provider, relay
    attempts = {}

    @app.middleware("http")
    async def limits(request, next_handler):
        # Origin must be canonical; proxy must preserve Host. Reject oversized bodies
        # before JSON/form processing; streaming bodies are bounded too.
        if request.headers.get("host") != parsed.netloc:
            return HTMLResponse("Invalid host", status_code=400)
        if request.method == "POST":
            key = request.client.host if request.client else "unknown"
            now = time.monotonic()
            if request.url.path in ("/devices", "/register", "/pair/approve"):
                if len(attempts) >= 10000:
                    attempts.clear()
                count, start = attempts.get(key, (0, now))
                count = count + 1 if now - start < 60 else 1
                if count > 30:
                    return HTMLResponse("Try again later", status_code=429)
                attempts[key] = (count, start if now - start < 60 else now)
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 1024 * 1024:
                    return HTMLResponse("Request too large", status_code=413)
            request._body = bytes(body)
        response = await next_handler(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers.setdefault(
            "Content-Security-Policy",
            (
                "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
            ),
        )
        return response

    def device_auth(request):
        value = request.headers.get("authorization", "")
        if not value.startswith("Bearer "):
            raise HTTPException(401, "device_authorization_required")
        record = store.get("device_token", digest(value[7:]))
        if not record or not store.get("device", record["subject"]):
            raise HTTPException(401, "device_authorization_revoked")
        return record["subject"]

    def pair(device):
        with store.db:
            store.db.execute(
                "DELETE FROM records WHERE kind='pair' AND json_extract(body,'$.subject')=?",
                (device,),
            )
        code = secrets.token_hex(6).upper()
        expires = int(time.time()) + 600
        store.put("pair", digest(code), {"subject": device}, expires)
        return {"pair_code": code, "expires_at": expires}

    @app.post("/devices")
    async def enroll():
        device, token = uuid.uuid4().hex, secrets.token_urlsafe(32)
        expiry = time.time() + 365 * 86400
        store.put("device", device, {"subject": device, "paired": False}, expiry)
        store.put("device_token", digest(token), {"subject": device}, expiry)
        return dict(device_id=device, device_token=token, **pair(device))

    @app.post("/devices/pair")
    async def renew(request: Request):
        return pair(device_auth(request))

    @app.get("/devices/status")
    async def status(request: Request):
        device = device_auth(request)
        pending = (
            store.db.execute(
                "SELECT count(*) FROM records WHERE kind='pair' AND expires>? AND json_extract(body,'$.subject')=?",
                (time.time(), device),
            ).fetchone()[0]
            > 0
        )
        return {"paired": store.get("device", device)["paired"], "pairing_pending": pending}

    @app.delete("/devices")
    async def revoke(request: Request):
        device = device_auth(request)
        store.revoke(device)
        relay.revoke(device)
        return {"revoked": True}

    @app.post("/devices/heartbeat")
    async def heartbeat(request: Request):
        device = device_auth(request)
        if not store.get("device", device)["paired"]:
            raise HTTPException(403, "pairing_required")
        relay.seen[device] = time.monotonic()
        return {"ready": True}

    @app.get("/devices/jobs")
    async def jobs(request: Request):
        device = device_auth(request)
        if not store.get("device", device)["paired"]:
            raise HTTPException(403, "pairing_required")
        job = await relay.poll(device)
        device_auth(request)
        return {"job": job}

    @app.post("/devices/reply")
    async def reply(request: Request):
        device = device_auth(request)
        data = await request.json()
        if not isinstance(data, dict) or not isinstance(data.get("result"), dict):
            raise HTTPException(400, "invalid_reply")
        relay.reply(device, data.get("request_id"), data["result"])
        return {"accepted": True}

    @app.get("/pair", response_class=HTMLResponse)
    async def consent(transaction: str):
        tx = store.get("transaction", digest(transaction))
        if not tx:
            raise HTTPException(400, "Authorization expired; try connecting again")
        client = await provider.get_client(tx["client_id"])
        csrf = secrets.token_urlsafe(32)
        store.put("csrf", digest(csrf), {"transaction": transaction}, time.time() + 300)
        response = HTMLResponse(f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Ripple / 连接 Ripple</title>
<style>body{{font:16px system-ui;max-width:36rem;margin:4rem auto;padding:1rem;line-height:1.6}}input,button{{font:inherit;padding:.7rem}}label{{display:block;margin:1rem 0}}</style>
<h1>Connect Ripple / 连接 Ripple</h1><p>{html.escape(client.client_name or "AI application")} requests access to your currently open interview: read and analyze text, save edited versions, add annotations and highlights.</p>
<p>此 AI 应用将可读取和分析当前访谈、保存新修改稿、添加批注与高亮。仅在 Ripple 开启连接时可访问；不传输音频。文字会离开本机。</p>
<p>Open Ripple → Settings → AI Assisted Editing → Connect. Enter its pairing code here.<br>打开 Ripple → 设置 → AI 辅助编辑 → 连接，在此输入配对码。</p>
<form method="post" action="/pair/approve"><input type="hidden" name="transaction" value="{html.escape(transaction)}"><input type="hidden" name="csrf" value="{csrf}"><label>Pairing code / 配对码 <input name="code" required maxlength="20" autocomplete="off"></label><button>Authorize / 授权连接</button></form></html>''')
        callback = urlparse(tx["params"]["redirect_uri"])
        callback_origin = f"{callback.scheme}://{callback.netloc}"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; "
            f"form-action 'self' {callback_origin}"
        )
        response.set_cookie(
            "ripple_csrf",
            csrf,
            httponly=True,
            secure=parsed.scheme == "https",
            samesite="lax",
            max_age=300,
        )
        return response

    @app.post("/pair/approve")
    async def approve(request: Request):
        form = await request.form()
        txid, csrf = str(form.get("transaction", "")), str(form.get("csrf", ""))
        csrfdata = store.get("csrf", digest(csrf))
        if (
            not csrfdata
            or csrfdata["transaction"] != txid
            or not secrets.compare_digest(csrf, request.cookies.get("ripple_csrf", ""))
            or request.headers.get("origin", base) != base
        ):
            raise HTTPException(403, "authorization_form_expired")
        tx = store.get("transaction", digest(txid))
        if not tx:
            raise HTTPException(400, "authorization_expired")
        code = str(form.get("code", "")).strip().replace("-", "").replace(" ", "").upper()
        pairdata = store.get("pair", digest(code), consume=True)
        if not pairdata or not store.get("device", pairdata["subject"]):
            raise HTTPException(400, "pairing_code_invalid_or_expired")
        store.get("transaction", digest(txid), consume=True)
        store.get("csrf", digest(csrf), consume=True)
        device = pairdata["subject"]
        store.put("device", device, {"subject": device, "paired": True}, time.time() + 365 * 86400)
        params = AuthorizationParams.model_validate(tx["params"])
        raw = secrets.token_urlsafe(32)
        store.put(
            "code",
            digest(raw),
            {
                "client_id": tx["client_id"],
                "scopes": params.scopes,
                "expires_at": time.time() + 60,
                "code_challenge": params.code_challenge,
                "redirect_uri": str(params.redirect_uri),
                "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
                "resource": params.resource,
                "subject": device,
            },
            time.time() + 60,
        )
        return RedirectResponse(
            construct_redirect_uri(
                str(params.redirect_uri), code=raw, state=params.state, iss=base
            ),
            status_code=303,
        )

    @app.get("/health")
    async def health():
        return {"service": "Ripple", "status": "ok"}

    app.mount("/", transport)
    return app


def main():
    import uvicorn

    base = os.environ["RIPPLE_CONNECTION_URL"]
    app = create_service(base, os.environ["RIPPLE_RELAY_DATA_DIR"])
    uvicorn.run(
        app,
        host=os.environ.get("RIPPLE_RELAY_BIND", "127.0.0.1"),
        port=int(os.environ.get("RIPPLE_RELAY_PORT", "18801")),
        access_log=False,
    )


if __name__ == "__main__":
    main()
