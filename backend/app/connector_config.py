"""Per-client, owner-local configuration removal; never touches documents or host apps."""
import json
import os
import secrets
import stat
import tempfile
from functools import wraps
from pathlib import Path

from .connector_setup import write_private
from .private_files import protect_private_fd

CLIENT_FILES = {
    "chatgpt": ("setup.json", "runtime.key", "tunnel.yaml", "health.url", "client.key"),
    "claude": ("claude.key", "Ripple.mcpb"),
    "workbuddy": ("workbuddy.key", "Ripple-WorkBuddy.json"),
}
KEY_FILES = {"chatgpt": "client.key", "claude": "claude.key", "workbuddy": "workbuddy.key"}
STATE_FILE = "disabled-clients.json"


def client_config_transaction(operation):
    @wraps(operation)
    def guarded(data: Path, client: str):
        if client not in CLIENT_FILES:
            raise ValueError("Invalid client")
        directory = data / "connector"
        if directory.is_symlink():
            raise ValueError("Invalid connector directory")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock = directory / ".client-config.lock"
        fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            protect_private_fd(fd)
            return operation(data, client)
        finally:
            os.close(fd)
            lock.unlink()
    return guarded


def read_local_file(path: Path) -> bytes | None:
    if path.is_symlink():
        raise ValueError("Invalid connector file")
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                     | getattr(os, "O_NONBLOCK", 0))
    except FileNotFoundError:
        return None
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Invalid connector file")
        raw = stream.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("Connector file too large")
    return raw


def disabled_clients(data: Path) -> set[str]:
    directory = data / "connector"
    if directory.is_symlink():
        raise ValueError("Invalid connector directory")
    raw = read_local_file(directory / STATE_FILE)
    if raw is None:
        return set()
    value = json.loads(raw)
    if (not isinstance(value, list) or any(not isinstance(c, str) or c not in CLIENT_FILES for c in value)
            or len(value) != len(set(value))):
        raise ValueError("Invalid connector state")
    return set(value)


def _write_bytes(path: Path, value: bytes):
    fd, name = tempfile.mkstemp(prefix=".connector-config-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            protect_private_fd(stream.fileno())
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        if path.is_symlink():
            raise ValueError("Invalid connector file")
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


@client_config_transaction
def enable_client(data: Path, client: str):
    """Only an explicit add/save re-enables a deleted client with a new credential."""
    if client not in CLIENT_FILES:
        raise ValueError("Invalid client")
    disabled = disabled_clients(data)
    directory = data / "connector"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    path = directory / KEY_FILES[client]
    raw = read_local_file(path)
    if raw is None or client in disabled:
        write_private(path, secrets.token_urlsafe(48))
    disabled.discard(client)
    _write_bytes(directory / STATE_FILE, json.dumps(sorted(disabled)).encode())


@client_config_transaction
def delete_client(data: Path, client: str):
    if client not in CLIENT_FILES:
        raise ValueError("Invalid client")
    disabled = disabled_clients(data)
    directory = data / "connector"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    state = directory / STATE_FILE
    prior_state = read_local_file(state)
    # Validate every fixed target before changing anything. No recursive deletion.
    originals = {directory / name: read_local_file(directory / name) for name in CLIENT_FILES[client]}
    disabled.add(client)
    _write_bytes(state, json.dumps(sorted(disabled)).encode())
    removed = []
    try:
        for path, original in originals.items():
            # A racing replacement must not delete an unexpected object.
            if read_local_file(path) != original:
                raise ValueError("Connector configuration changed")
            if original is not None:
                path.unlink()
                removed.append(path)
    except (OSError, ValueError):
        # Roll back ordinary write failures. If recovery itself fails, retain the
        # disabled marker so stale credentials cannot regain access.
        for path in removed:
            if read_local_file(path) is None:
                _write_bytes(path, originals[path])
        # Never overwrite a replacement written by another process. In that
        # case keep the disabled marker, requiring an explicit retry/re-add.
        if all(read_local_file(path) == raw for path, raw in originals.items()):
            if prior_state is None:
                state.unlink(missing_ok=True)
            else:
                _write_bytes(state, prior_state)
        raise
