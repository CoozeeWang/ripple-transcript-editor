"""Authenticated, leased bridge to an explicitly enabled editor window.

No transcript cache or filesystem API: the editor owns document identity and writes.
"""
import asyncio
import hashlib
import json
import os
import secrets
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .private_files import protect_private_fd
from .runtime_paths import CODE_ROOT, DATA_ROOT

router = APIRouter(prefix="/api/connector", tags=["connector"])
LEASE_SECONDS = 45


def _key(path: Path, replace: bool = False) -> str:
    flags = os.O_NOFOLLOW if hasattr(os, "O_NOFOLLOW") else 0
    if path.exists() and not replace:
        with os.fdopen(os.open(path, os.O_RDONLY | flags), "r") as f:
            value = f.read(256).strip()
        if len(value) < 32:
            raise RuntimeError("Invalid connector credential")
        return value
    value = secrets.token_urlsafe(48)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        protect_private_fd(f.fileno())
        f.write(value)
    return value


@dataclass
class Window:
    touched: float
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)


class Broker:
    def __init__(self):
        self.window_key = ""
        self.client_key = ""
        self.windows: dict[str, Window] = {}
        self.pending: dict[str, tuple[str, asyncio.Future]] = {}
        self.calls: OrderedDict[str, tuple[str, str, asyncio.Task]] = OrderedDict()

    def initialize(self):
        if self.window_key:
            return
        if DATA_ROOT == CODE_ROOT:
            raise HTTPException(503, "Connector requires an external RIPPLE_DATA_DIR")
        directory = DATA_ROOT / "connector"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if directory.is_symlink():
            raise RuntimeError("Invalid connector directory")
        os.chmod(directory, 0o700)
        self.window_key = _key(directory / "window.key", replace=True)
        self.client_key = _key(directory / "client.key")
        _key(directory / "claude.key")
        _key(directory / "workbuddy.key")

    def authorize(self, authorization: str | None, role: str):
        self.initialize()
        if role == "window":
            expected = [self.window_key]
        else:
            # Configuration selection is a view preference, not a connection gate.
            # Each owner-local client retains its own credential and shares the
            # same consent lease and snapshot/concurrent-publish protection.
            expected = [self.client_key]
            for client in ("claude", "workbuddy"):
                path = DATA_ROOT / "connector" / f"{client}.key"
                try:
                    if path.is_file() and not path.is_symlink():
                        expected.append(path.read_text().strip())
                except OSError:
                    continue
        matches = [secrets.compare_digest(authorization or "", f"Bearer {key}") for key in expected if key]
        if not any(matches):
            raise HTTPException(401, "Connector authorization required")

    def disable(self, session: str):
        self.windows.pop(session, None)
        for request_id, (_, owner, _task) in list(self.calls.items()):
            if owner == session:
                self.calls.pop(request_id, None)
        for request, (owner, future) in list(self.pending.items()):
            if owner == session:
                if not future.done():
                    future.set_result({"ok": False, "error": "connection_disabled"})
                self.pending.pop(request, None)

    def current(self):
        expired = False
        for session, window in list(self.windows.items()):
            if time.monotonic() - window.touched > LEASE_SECONDS:
                expired = True
                self.disable(session)
        if not self.windows:
            raise HTTPException(409, "connection_expired_wait_for_ripple_recovery" if expired else "no_enabled_ripple_window")
        if len(self.windows) != 1:
            raise HTTPException(409, "multiple_enabled_ripple_windows")
        return next(iter(self.windows.items()))

    async def dispatch(self, operation: str, arguments: dict):
        session, window = self.current()
        request_id = secrets.token_urlsafe(24)
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = (session, future)
        await window.queue.put({"request_id": request_id, "operation": operation,
                                "arguments": arguments})
        try:
            # Timeout is an unknown outcome for writes; the same request id recovers it.
            return await asyncio.wait_for(asyncio.shield(future), timeout=120)
        except TimeoutError:
            return {"ok": False, "error": "editor_timeout_check_result_before_retry"}
        finally:
            self.pending.pop(request_id, None)

    async def call(self, request_id: str, operation: str, arguments: dict):
        digest = hashlib.sha256(json.dumps([operation, arguments], sort_keys=True,
                                           ensure_ascii=False).encode()).hexdigest()
        owner, _window = self.current()
        prior = self.calls.get(request_id)
        if prior and prior[1] != owner:
            raise HTTPException(409, "Request belongs to another window")
        if prior and prior[0] != digest:
            raise HTTPException(409, "Request id reused with different input")
        if not prior:
            self.current()
            if len(self.calls) >= 256:
                removable = next((key for key, (_, _, task) in self.calls.items() if task.done()), None)
                if removable is None:
                    raise HTTPException(429, "Too many pending connector requests")
                self.calls.pop(removable)
            task = asyncio.create_task(self.dispatch(operation, arguments))
            self.calls[request_id] = (digest, owner, task)
        task = self.calls[request_id][2]
        return await asyncio.shield(task)


broker = Broker()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Session(StrictModel):
    session: str = Field(min_length=8, max_length=100)
    enabled: bool


class Reply(StrictModel):
    session: str = Field(min_length=8, max_length=100)
    request_id: str = Field(max_length=100)
    result: dict


class Call(StrictModel):
    request_id: str = Field(min_length=8, max_length=100)
    operation: str = Field(pattern=r"^(read_current|read_page|read_examples|prepare|stage|publish|cancel|status|tasks|batch|checkpoint|pause|resume|prepare_marks|stage_marks|apply_marks|marks_status|cancel_marks)$")
    arguments: dict = Field(default_factory=dict)


@router.post("/session")
def session(body: Session, authorization: str | None = Header(default=None)):
    broker.authorize(authorization, "window")
    if body.enabled:
        if body.session not in broker.windows:
            broker.windows[body.session] = Window(time.monotonic())
        broker.windows[body.session].touched = time.monotonic()
    else:
        broker.disable(body.session)
    return {"enabled": body.enabled}


@router.get("/poll")
async def poll(session: str, authorization: str | None = Header(default=None)):
    broker.authorize(authorization, "window")
    window = broker.windows.get(session)
    if not window:
        raise HTTPException(409, "Connection disabled")
    window.touched = time.monotonic()
    try:
        return await asyncio.wait_for(window.queue.get(), timeout=2)
    except TimeoutError:
        return None


@router.post("/reply")
def reply(body: Reply, authorization: str | None = Header(default=None)):
    broker.authorize(authorization, "window")
    pending = broker.pending.get(body.request_id)
    if not pending or pending[0] != body.session or body.session not in broker.windows:
        raise HTTPException(409, "Request expired")
    if not pending[1].done():
        pending[1].set_result(body.result)
    return {"accepted": True}


@router.post("/call")
async def call(body: Call, authorization: str | None = Header(default=None)):
    broker.authorize(authorization, "client")
    if len(json.dumps(body.arguments, ensure_ascii=False)) > 150_000:
        raise HTTPException(413, "Connector input too large")
    return await broker.call(body.request_id, body.operation, body.arguments)
