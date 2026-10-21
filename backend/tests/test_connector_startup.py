"""Process-boundary regressions using public synthetic paths and keys only."""
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path, PureWindowsPath


def test_setup_reads_utf8_bytes_independently_of_stdin_codepage(tmp_path):
    client = tmp_path / "Synthetic 测试用户 空格" / "tunnel-client.exe"
    client.parent.mkdir()
    client.touch(mode=0o700)
    data = tmp_path / "Synthetic 配置"
    values = {"client_path": str(client), "tunnel_id": "tunnel_synthetic",
              "runtime_key": "synthetic-runtime-key-for-public-tests-123456"}
    env = {**os.environ, "PYTHONIOENCODING": "gbk", "PYTHONUTF8": "0"}
    result = subprocess.run([sys.executable, "-m", "app.connector_setup", str(data),
                             str(tmp_path / "Synthetic App")],
                            input=json.dumps(values, ensure_ascii=False).encode("utf-8"),
                            env=env, capture_output=True, timeout=15, check=False)
    assert result.returncode == 0, result.stderr.decode("ascii", errors="replace")
    setup = json.loads((data / "connector/setup.json").read_text(encoding="utf-8"))
    assert Path(setup["client_path"]).is_relative_to(data / "connector/runtimes")
    assert Path(setup["client_path"]).read_bytes() == client.read_bytes()
    assert (data / "connector/runtime.key").read_text(encoding="utf-8") == values["runtime_key"]


def test_setup_reports_safe_stage_code_without_echoing_input(tmp_path):
    secret = "synthetic-secret-that-must-not-be-echoed-123456"
    result = subprocess.run([sys.executable, "-m", "app.connector_setup", str(tmp_path), str(tmp_path)],
                            input=json.dumps({"client_path": str(tmp_path / "missing/tunnel-client.exe"),
                                              "tunnel_id": "tunnel_synthetic", "runtime_key": secret}).encode(),
                            capture_output=True, timeout=15, check=False)
    assert result.returncode == 1
    assert json.loads(result.stdout) == {"error": "setup_client_invalid"}
    assert secret.encode() not in result.stdout + result.stderr
    assert str(tmp_path).encode() not in result.stdout + result.stderr


def test_tunnel_profile_preserves_windows_backslashes_with_shell_word_parser(tmp_path, monkeypatch):
    from app import connector_setup
    python = PureWindowsPath("C:/Synthetic 中文 App/python/python.exe")
    monkeypatch.setattr(connector_setup, "bundled_python", lambda _resources: python)
    client = tmp_path / "tunnel-client.exe"
    client.touch(mode=0o700)
    data = tmp_path / "Synthetic 中文 Data"
    connector_setup.save_setup(data, tmp_path, {"client_path": str(client),
        "tunnel_id": "tunnel_synthetic", "runtime_key": "synthetic-key-for-public-quoting-test-123456"})
    lines = (data / "connector/tunnel.yaml").read_text(encoding="utf-8").splitlines()
    command = json.loads(next(line.split("command: ", 1)[1] for line in lines if line.startswith("      command: ")))
    args = shlex.split(command)
    assert args[0] == str(python)
    assert args[-1] == str(data / "connector/client.key")


def test_packaged_mcp_initializes_pth_before_importing_dependencies(tmp_path):
    """A relocated distribution must process .pth, even when already on PYTHONPATH."""
    import shutil

    root = tmp_path / "Synthetic App 中文 空格"
    app = root / "backend/app"
    shutil.copytree(Path(__file__).parents[1] / "app", app,
                    ignore=shutil.ignore_patterns("__pycache__"))
    packages = root / "site-packages"
    packages.mkdir()
    marker = tmp_path / "synthetic-pth-ready"
    (packages / "synthetic_bootstrap.py").write_text(
        "import sys\nfrom pathlib import Path\nassert 'mcp' not in sys.modules\n"
        f"Path({str(marker)!r}).touch()", encoding="utf-8")
    (packages / "synthetic.pth").write_text("import synthetic_bootstrap\n", encoding="utf-8")
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(root / "backend"), str(packages)])}
    result = subprocess.run([sys.executable, "-m", "app.connector_mcp", "--help"],
                            cwd=tmp_path, env=env, capture_output=True, timeout=20, check=False)
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    assert b"--credential-file" in result.stdout
    assert marker.is_file()


def test_upgrade_rebinds_bundle_without_downloads_or_key_rotation(tmp_path):
    from app.connector_setup import save_setup
    import shutil
    downloaded = tmp_path / 'Synthetic Downloads'
    downloaded.mkdir()
    client = downloaded / 'tunnel-client'
    client.write_bytes(b'synthetic client')
    client.chmod(0o700)
    (downloaded / 'cloudflared').write_bytes(b'synthetic companion')
    (downloaded / 'LICENSE').write_text('synthetic license')
    (downloaded / 'unrelated-secret.txt').write_text('synthetic excluded value')
    data = tmp_path / 'Synthetic Data'
    key = 'synthetic-runtime-key-for-upgrade-test-123456'
    save_setup(data, tmp_path / 'Old App', {'client_path': str(client), 'tunnel_id': 'tunnel_synthetic', 'runtime_key': key})
    directory = data / 'connector'
    before = (directory / 'runtime.key').read_bytes()
    managed = Path(json.loads((directory / 'setup.json').read_text())['client_path'])
    assert managed.read_bytes() == b'synthetic client'
    assert (managed.parent / 'cloudflared').read_bytes() == b'synthetic companion'
    assert not (managed.parent / 'unrelated-secret.txt').exists()
    shutil.rmtree(downloaded)
    save_setup(data, tmp_path / 'New App 中文', {'client_path': str(managed), 'tunnel_id': 'tunnel_synthetic', 'runtime_key': ''})
    assert (directory / 'runtime.key').read_bytes() == before
    profile = (directory / 'tunnel.yaml').read_text()
    assert 'Old App' not in profile and 'New App' in profile
    assert key not in profile
    assert len(list((directory / 'runtimes').iterdir())) == 1


def test_failed_config_publish_keeps_previous_complete_file(tmp_path, monkeypatch):
    from app import connector_setup
    from pathlib import Path
    target = tmp_path / 'setup.json'
    target.write_text('{"synthetic":"previous"}')
    original = Path.replace
    def fail(source, dest):
        if dest == target:
            raise OSError('synthetic publish failure')
        return original(source, dest)
    monkeypatch.setattr(Path, 'replace', fail)
    import pytest
    with pytest.raises(OSError):
        connector_setup.write_private(target, '{"synthetic":"next"}')
    assert json.loads(target.read_text()) == {'synthetic': 'previous'}
    assert list(tmp_path.iterdir()) == [target]
