"""Owner-local client selection and installation exports; never export secret values."""
import argparse
import json
import os
import tempfile
import zipfile
from pathlib import Path

from .connector_setup import write_private

CLIENTS = ("chatgpt", "claude", "workbuddy")


def selected_client(data: Path) -> str:
    path = data / "connector/client-mode.json"
    if not path.exists():
        return "chatgpt"
    value = json.loads(path.read_text())["client"]
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
        with os.fdopen(fd, "w") as output:
            output.write(json.dumps({"client": client}))
        os.replace(name, directory / "client-mode.json")
    finally:
        if os.path.exists(name):
            os.unlink(name)


def installation(data: Path, resources: Path, client: str) -> dict:
    if client not in ("claude", "workbuddy"):
        raise ValueError("Invalid local client")
    return {"command": str(resources / "python/bin/python3.12"),
            "args": ["-m", "app.connector_mcp", "--credential-file", str(data / "connector" / f"{client}.key")],
            "env": {"PYTHONPATH": os.pathsep.join(map(str, [resources / "backend", resources / "site-packages"])),
                    "PYTHONDONTWRITEBYTECODE": "1"}}


def export_installation(data: Path, resources: Path, client: str, target: Path):
    config = installation(data, resources, client)
    if not Path(config["command"]).is_file():
        raise ValueError("Bundled runtime unavailable")
    if client == "workbuddy":
        write_private(target, json.dumps({"mcpServers": {"Ripple": {"type": "stdio", **config}}}, ensure_ascii=False, indent=2))
        return
    manifest = {"manifest_version": "0.3", "name": "ripple", "display_name": "Ripple", "version": "1.0.0",
                "description": "Read, analyze and edit the current Ripple interview. 读取、分析与编辑 Ripple 当前访谈。",
                "author": {"name": "Ripple"}, "compatibility": {"platforms": ["darwin"]},
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
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "wb") as output, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        bundle.writestr("server/index.js", script)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("status", "select", "export"))
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--resources", type=Path)
    parser.add_argument("--client", choices=CLIENTS)
    parser.add_argument("--target", type=Path)
    args = parser.parse_args()
    if args.action == "select":
        select_client(args.data, args.client)
    elif args.action == "export":
        export_installation(args.data, args.resources, args.client, args.target)
    print(json.dumps({"client": selected_client(args.data)}))
