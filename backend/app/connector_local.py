"""Owner-local client selection and installation exports; never export secret values."""
import argparse
import json
import os
import stat
import tempfile
import zipfile
from pathlib import Path

from .bundled_runtime import bundled_python
from .connector_config import enable_client
from .connector_setup import write_private
from .private_files import protect_private_fd

CLIENTS = ("chatgpt", "claude", "workbuddy")


def selected_client(data: Path) -> str:
    path = data / "connector/client-mode.json"
    if not path.exists():
        return "chatgpt"
    value = json.loads(path.read_text(encoding="utf-8"))["client"]
    if value not in CLIENTS:
        raise ValueError("Invalid client")
    return value


def select_client(data: Path, client: str):
    if client not in CLIENTS:
        raise ValueError("Invalid client")
    directory = data / "connector"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink():
        raise ValueError("Invalid connector directory")
    os.chmod(directory, 0o700)
    fd, name = tempfile.mkstemp(prefix=".client-mode-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(json.dumps({"client": client}))
        os.replace(name, directory / "client-mode.json")
    finally:
        if os.path.exists(name):
            os.unlink(name)


def installation(data: Path, resources: Path, client: str) -> dict:
    if client not in ("claude", "workbuddy"):
        raise ValueError("Invalid local client")
    return {"command": str(bundled_python(resources)),
            "args": ["-m", "app.connector_mcp", "--url", os.environ.get("RIPPLE_CONNECTOR_URL", "http://127.0.0.1:18701"), "--credential-file", str(data / "connector" / f"{client}.key")],
            "env": {"PYTHONPATH": os.pathsep.join(map(str, [resources / "backend", resources / "site-packages"])),
                    "PYTHONDONTWRITEBYTECODE": "1"}}


def export_installation(data: Path, resources: Path, client: str, target: Path):
    config = installation(data, resources, client)
    if not Path(config["command"]).is_file():
        raise ValueError("Bundled runtime unavailable")
    if client == "workbuddy":
        write_private(target, json.dumps({"mcpServers": {"Ripple": {"type": "stdio", **config}}}, ensure_ascii=False, indent=2))
        enable_client(data, client)
        return
    manifest = {"manifest_version": "0.3", "name": "ripple", "display_name": "Ripple", "version": "1.0.0",
                "description": "Read, analyze and edit the current Ripple interview. 读取、分析与编辑 Ripple 当前访谈。",
                "author": {"name": "Ripple"}, "compatibility": {"platforms": ["win32" if os.name == "nt" else "darwin"]},
                "server": {"type": "node", "entry_point": "server/index.js",
                           "mcp_config": {"command": "node", "args": ["${__dirname}/server/index.js"]}}}
    # Node is supplied by Claude Desktop. Python and dependencies stay in the Ripple bundle.
    script = ("const {spawn}=require('node:child_process');\nconst c=" + json.dumps(config) + ";\n"
              "const p=spawn(c.command,c.args,{env:{...process.env,...c.env},stdio:'inherit'});\n"
              "p.on('error',()=>{console.error('Open Ripple and re-export its extension.');process.exit(1)});\n"
              "p.on('exit',code=>process.exit(code??1));\n"
              "for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>p.kill(s));\n")
    # Private export contains this user's executable paths, never credentials or documents.
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as output:
        protect_private_fd(output.fileno())
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            bundle.writestr("server/index.js", script)
    enable_client(data, client)


def install_workbuddy(data: Path, resources: Path, target: Path) -> bool:
    """Merge only Ripple into a fixed native-selected config, backing up exact bytes."""
    config = {"type": "stdio", **installation(data, resources, "workbuddy")}
    if not Path(config["command"]).is_file():
        raise ValueError("Missing bundled runtime")
    parent = target.parent
    if parent.is_symlink():
        raise ValueError("Invalid config directory")
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = parent / ".ripple-install.lock"
    lock_fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    temp_name = None
    try:
        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("Duplicate configuration key")
                result[key] = value
            return result

        raw = None
        if target.is_symlink():
            raise ValueError("Invalid config file")
        if target.exists():
            fd = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                         | getattr(os, "O_NONBLOCK", 0))
            with os.fdopen(fd, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise ValueError("Invalid config file")
                raw = stream.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError("Config too large")
            current = json.loads(raw, object_pairs_hook=unique_object)
        else:
            current = {}
        if not isinstance(current, dict):
            raise TypeError("Invalid configuration")
        servers = current.get("mcpServers", {})
        if not isinstance(servers, dict):
            raise TypeError("Invalid server configuration")
        if servers.get("Ripple") == config:
            enable_client(data, "workbuddy")
            return False
        current["mcpServers"] = {**servers, "Ripple": config}
        payload = json.dumps(current, ensure_ascii=False, indent=2).encode() + b"\n"
        fd, temp_name = tempfile.mkstemp(prefix=".ripple-config-", dir=parent)
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        # Recheck before replacing, including edits by the host application.
        if (target.is_symlink() or target.exists() != (raw is not None)
                or (target.exists() and target.read_bytes() != raw)):
            raise ValueError("Config changed during installation")
        if raw is not None:
            backup_fd, _backup_name = tempfile.mkstemp(prefix="mcp.json.ripple-backup-", dir=parent)
            with os.fdopen(backup_fd, "wb") as backup:
                backup.write(raw)
                backup.flush()
                os.fsync(backup.fileno())
        os.replace(temp_name, target)
        temp_name = None
        enable_client(data, "workbuddy")
        return True
    finally:
        os.close(lock_fd)
        lock.unlink()
        if temp_name is not None:
            Path(temp_name).unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("status", "select", "export", "install-workbuddy"))
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--resources", type=Path)
    parser.add_argument("--client", choices=CLIENTS)
    parser.add_argument("--target", type=Path)
    args = parser.parse_args()
    if args.action == "select":
        select_client(args.data, args.client)
    elif args.action == "export":
        export_installation(args.data, args.resources, args.client, args.target)
    elif args.action == "install-workbuddy":
        install_workbuddy(args.data, args.resources, args.target)
    print(json.dumps({"client": selected_client(args.data)}))
