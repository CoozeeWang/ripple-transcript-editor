"""Verify exported MCP commands against an isolated synthetic loopback backend.

Use an actual staged/installed resources/backend directory, never a daily data root.
This verifies packaged transports, not third-party GUI installation or cloud access.
Only the standard library is used by this controller; children use bundled Python.
"""
import argparse
import json
import os
import queue
import shlex
import shutil
import subprocess
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SECRET = "synthetic-public-connector-runtime-test-key-123456"
TEXT = "Synthetic 合成片段：中文路径与空格。"
EXPECTED_TOOLS = {
    "connection_capabilities",
    "set_interview_rules",
    "list_project_interviews",
    "read_project_interview",
    "list_project_continuations",
    "read_current_interview",
    "read_interview_page",
    "read_editing_examples",
    "prepare_continuation",
    "stage_continuation",
    "list_continuations",
    "read_continuation_batch",
    "save_continuation_batch",
    "resume_continuation",
    "publish_continuation",
    "continuation_status",
    "cancel_continuation",
    "prepare_interview_marks",
    "stage_interview_marks",
    "apply_interview_marks",
    "interview_marks_status",
    "cancel_interview_marks",
}


class SyntheticBackend(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        assert self.path == "/api/connector/call"
        assert self.headers.get("Authorization") == "Bearer " + SECRET
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert request["operation"] == "read_current"
        data = {"title": "Synthetic 中文稿", "version": "Synthetic v1", "text": TEXT}
        body = json.dumps({"ok": True, "data": data}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def execute(command, env, *, payload=None):
    result = subprocess.run(command, input=payload, env=env, capture_output=True,
                            check=False, timeout=30)
    if result.returncode:
        # Disposable synthetic paths only; no user configuration is read by this probe.
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace")[:4000])
    return result


def handshake(command, env):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=env)
    replies = queue.Queue()
    errors = []

    def read_output():
        for line in process.stdout:
            try:
                replies.put(json.loads(line))
            except ValueError:
                replies.put({"error": "non-JSON stdout"})
        replies.put({"error": "stdout closed"})

    def read_errors():
        for line in process.stderr:
            if len(errors) < 30:
                errors.append(line.decode("utf-8", errors="replace"))

    output_thread = threading.Thread(target=read_output, daemon=True)
    error_thread = threading.Thread(target=read_errors, daemon=True)
    output_thread.start()
    error_thread.start()

    def send(method, params, request_id=None):
        message = {"jsonrpc": "2.0", "method": method, "params": params}
        if request_id is not None:
            message["id"] = request_id
        process.stdin.write(json.dumps(message).encode("utf-8") + b"\n")
        process.stdin.flush()
        if request_id is None:
            return None
        for _ in range(20):
            reply = replies.get(timeout=20)
            if "error" in reply:
                raise AssertionError(str(reply) + "".join(errors))
            if reply.get("id") == request_id:
                return reply["result"]
        raise AssertionError("MCP response missing")

    try:
        result = send("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                                     "clientInfo": {"name": "Ripple synthetic package probe", "version": "1"}}, 1)
        assert result["serverInfo"]["name"] == "Ripple"
        send("notifications/initialized", {})
        tools = send("tools/list", {}, 2)["tools"]
        names = [tool["name"] for tool in tools]
        assert len(names) == len(EXPECTED_TOOLS) and set(names) == EXPECTED_TOOLS, (
            f"MCP tool mismatch: missing={sorted(EXPECTED_TOOLS - set(names))}, "
            f"unexpected={sorted(set(names) - EXPECTED_TOOLS)}")
        read = send("tools/call", {"name": "read_current_interview", "arguments": {}}, 3)
        assert not read.get("isError"), read
        assert read["structuredContent"]["text"] == TEXT
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
        output_thread.join(timeout=2)
        error_thread.join(timeout=2)
        process.stdout.close()
        process.stderr.close()


def verify(resources: Path, tunnel_client: Path | None = None):
    resources = resources.resolve()
    python = resources / ("python/python.exe" if os.name == "nt" else "python/bin/python3.12")
    node = shutil.which("node")
    if not python.is_file() or not node:
        raise RuntimeError("Bundled Python and Node (Claude host surrogate) are required")
    server = ThreadingHTTPServer(("127.0.0.1", 0), SyntheticBackend)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="Ripple Synthetic 中文 空格 ") as temp:
            root = Path(temp)
            data = root / "data"
            directory = data / "connector"
            directory.mkdir(parents=True)
            for name in ("client.key", "claude.key", "workbuddy.key"):
                (directory / name).write_text(SECRET, encoding="utf-8")
            env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(resources / "backend"), str(resources / "site-packages")]),
                   "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1",
                   "PYTHONIOENCODING": "gbk", "PYTHONUTF8": "0", "RIPPLE_DATA_DIR": str(data),
                   "RIPPLE_CONNECTOR_URL": f"http://127.0.0.1:{server.server_port}"}
            imports = "import app; from mcp.server import MCPServer"
            if os.name == "nt":
                imports += "; import pywintypes, win32api, win32con, win32job, pythoncom"
            execute([str(python), "-c", imports], env)
            for client in ("workbuddy", "claude"):
                target = root / ("Ripple.json" if client == "workbuddy" else "Ripple.mcpb")
                execute([str(python), "-m", "app.connector_local", "export", "--data", str(data),
                         "--resources", str(resources), "--client", client, "--target", str(target)], env)
                if client == "workbuddy":
                    config = json.loads(target.read_text(encoding="utf-8"))["mcpServers"]["Ripple"]
                    command = [config["command"], *config["args"]]
                    child_env = {**env, **config["env"]}
                else:
                    with zipfile.ZipFile(target) as package:
                        launcher = root / "claude-launcher.cjs"
                        launcher.write_bytes(package.read("server/index.js"))
                    command, child_env = [node, str(launcher)], env
                # Repeat fresh processes to cover reconnect/restart, without real client settings.
                for _ in range(2):
                    handshake(command, child_env)
            tunnel = root / ("tunnel-client.exe" if os.name == "nt" else "tunnel-client")
            tunnel.touch(mode=0o700)  # Never executed: only the generated MCP command is exercised.
            values = {"client_path": str(tunnel), "tunnel_id": "tunnel_synthetic", "runtime_key": SECRET}
            execute([str(python), "-m", "app.connector_setup", str(data), str(resources)], env,
                    payload=json.dumps(values, ensure_ascii=False).encode("utf-8"))
            profile = (directory / "tunnel.yaml").read_text(encoding="utf-8")
            if tunnel_client is not None:
                # Offline validation with the vendor's parser; no real tunnel/key,
                # OpenAI request or dependency on machine-specific registrations.
                diagnostic = root / "synthetic-doctor.yaml"
                diagnostic.write_text(profile.replace('"https://api.openai.com"',
                    f'"http://127.0.0.1:{server.server_port}"').replace('tunnel_synthetic',
                    'tunnel_' + '0' * 32), encoding="utf-8")
                execute([str(tunnel_client.resolve()), "doctor", "--config", str(diagnostic)], env)
            command = json.loads(next(line.split("command: ", 1)[1] for line in profile.splitlines()
                                      if line.startswith("      command: ")))
            for _ in range(2):
                handshake(shlex.split(command), env)
            assert (directory / "runtime.key").read_text(encoding="utf-8") == SECRET
        return {"packagedImports": True, "utf8InputWithGbkStdin": True,
                "initialize": True, "toolCount": len(EXPECTED_TOOLS), "syntheticUtf8Read": True,
                "freshStartsPerClient": 2, "adapterEntrypoints": ["chatgpt", "claude", "workbuddy"],
                "vendorTunnelCommandParser": tunnel_client is not None,
                "externalClientGuiAcceptance": "pending", "cloudTunnelAcceptance": "pending"}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("resources", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--tunnel-client", type=Path)
    args = parser.parse_args()
    evidence = verify(args.resources, args.tunnel_client)
    if args.output:
        args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence))
