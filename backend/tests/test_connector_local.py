"""Public synthetic paths and credentials only."""
import json
import os
import zipfile

import pytest
from fastapi import HTTPException

from app import connector
from app.bundled_runtime import bundled_python
from app.connector_local import export_installation, select_client, selected_client


def test_selection_persists_and_rejects_unknown(tmp_path):
    assert selected_client(tmp_path) == "chatgpt"
    select_client(tmp_path, "claude")
    assert selected_client(tmp_path) == "claude"
    with pytest.raises(ValueError):
        select_client(tmp_path, "unknown")
    assert selected_client(tmp_path) == "claude"


def test_selected_client_credentials_isolate_calls(tmp_path, monkeypatch):
    monkeypatch.setattr(connector, "DATA_ROOT", tmp_path)
    broker = connector.Broker()
    broker.initialize()
    claude = (tmp_path / "connector/claude.key").read_text(encoding="utf-8")
    workbuddy = (tmp_path / "connector/workbuddy.key").read_text(encoding="utf-8")
    select_client(tmp_path, "claude")
    broker.authorize("Bearer " + claude, "client")
    for other in (broker.client_key, workbuddy):
        with pytest.raises(HTTPException) as error:
            broker.authorize("Bearer " + other, "client")
        assert error.value.status_code == 401
    broker.authorize("Bearer " + broker.window_key, "window")
    select_client(tmp_path, "workbuddy")
    with pytest.raises(HTTPException):
        broker.authorize("Bearer " + claude, "client")
    broker.authorize("Bearer " + workbuddy, "client")


def test_exports_use_bundled_runtime_and_exclude_secret_values(tmp_path):
    resources = tmp_path / "Synthetic App 空格" / "backend"
    python = bundled_python(resources)
    python.parent.mkdir(parents=True)
    python.touch()
    data = tmp_path / "synthetic-data"
    (data / "connector").mkdir(parents=True)
    secret = "synthetic-secret-must-not-appear-" * 3
    (data / "connector/claude.key").write_text(secret)
    target = tmp_path / "Ripple.mcpb"
    export_installation(data, resources, "claude", target)
    with zipfile.ZipFile(target) as package:
        assert package.testzip() is None
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["server"]["type"] == "node"
        assert manifest["compatibility"]["platforms"] == ["win32" if os.name == "nt" else "darwin"]
        script = package.read("server/index.js").decode()
        assert secret not in script
        assert json.dumps(str(python)) in script
        assert "claude.key" in script
    other = tmp_path / "Ripple-WorkBuddy.json"
    export_installation(data, resources, "workbuddy", other)
    config = json.loads(other.read_text(encoding="utf-8"))["mcpServers"]["Ripple"]
    assert config["type"] == "stdio"
    assert config["command"] == str(python)
    assert config["args"][-1].endswith("workbuddy.key")
    assert secret not in other.read_text(encoding="utf-8")
    # Repeat export remains one valid artifact and does not alter stored credentials.
    export_installation(data, resources, "claude", target)
    assert (data / "connector/claude.key").read_text(encoding="utf-8") == secret


def test_missing_runtime_creates_no_export(tmp_path):
    target = tmp_path / "Ripple.mcpb"
    with pytest.raises(ValueError):
        export_installation(tmp_path, tmp_path / "missing", "claude", target)
    assert not target.exists()


def test_workbuddy_install_preserves_other_connections_and_exact_backup(tmp_path):
    from app.connector_local import install_workbuddy
    resources = tmp_path / "Synthetic App 空格/backend"
    python = bundled_python(resources)
    python.parent.mkdir(parents=True)
    python.touch()
    target = tmp_path / "synthetic-home/.workbuddy/mcp.json"
    target.parent.mkdir(parents=True)
    raw = b'{"mcpServers":{"Other":{"command":"synthetic"}},"setting":true}\n'
    target.write_bytes(raw)
    assert install_workbuddy(tmp_path / "data", resources, target)
    value = json.loads(target.read_bytes())
    assert value['mcpServers']['Other'] == {'command': 'synthetic'}
    assert value['setting'] is True
    backups = list(target.parent.glob('mcp.json.ripple-backup-*'))
    assert len(backups) == 1 and backups[0].read_bytes() == raw
    if os.name != "nt":
        assert backups[0].stat().st_mode & 0o777 == 0o600
    assert not install_workbuddy(tmp_path / "data", resources, target)
    assert len(list(target.parent.glob('mcp.json.ripple-backup-*'))) == 1


@pytest.mark.parametrize('raw', [b'not json', b'[]', b'{"mcpServers":[]}',
                              b'{"mcpServers":{},"mcpServers":{}}'])
def test_workbuddy_invalid_config_is_untouched(tmp_path, raw):
    from app.connector_local import install_workbuddy
    resources = tmp_path / "runtime"
    python = bundled_python(resources)
    python.parent.mkdir(parents=True)
    python.touch()
    target = tmp_path / "config/mcp.json"
    target.parent.mkdir()
    target.write_bytes(raw)
    with pytest.raises((ValueError, TypeError)):
        install_workbuddy(tmp_path, resources, target)
    assert target.read_bytes() == raw
    assert not list(target.parent.glob('mcp.json.ripple-backup-*'))
    assert not (target.parent / '.ripple-install.lock').exists()


def test_workbuddy_symlink_and_concurrent_install_refused(tmp_path):
    from app.connector_local import install_workbuddy
    resources = tmp_path / "runtime"
    python = bundled_python(resources)
    python.parent.mkdir(parents=True)
    python.touch()
    other = tmp_path / "other.json"
    other.write_text('{}')
    target = tmp_path / "config/mcp.json"
    target.parent.mkdir()
    target.symlink_to(other)
    with pytest.raises(ValueError):
        install_workbuddy(tmp_path, resources, target)
    assert other.read_text(encoding="utf-8") == '{}'
    target.unlink()
    lock = target.parent / '.ripple-install.lock'
    lock.write_text('')
    with pytest.raises(FileExistsError):
        install_workbuddy(tmp_path, resources, target)
    assert lock.exists() and not target.exists()


def test_workbuddy_first_install_creates_config_without_backup(tmp_path):
    from app.connector_local import install_workbuddy
    resources = tmp_path / 'runtime'
    python = bundled_python(resources)
    python.parent.mkdir(parents=True)
    python.touch()
    target = tmp_path / 'new-home/.workbuddy/mcp.json'
    assert install_workbuddy(tmp_path, resources, target)
    assert set(json.loads(target.read_bytes())['mcpServers']) == {'Ripple'}
    assert not list(target.parent.glob('mcp.json.ripple-backup-*'))


def test_workbuddy_refresh_updates_only_existing_ripple_entry(tmp_path):
    from app.connector_local import install_workbuddy
    resources = tmp_path / 'new runtime'
    python = bundled_python(resources)
    python.parent.mkdir(parents=True)
    python.touch()
    target = tmp_path / 'config/mcp.json'
    target.parent.mkdir()
    old = {'mcpServers': {'Ripple': {'command': 'old-app'}, 'Other': {'env': {}}}}
    target.write_text(json.dumps(old))
    assert install_workbuddy(tmp_path, resources, target)
    current = json.loads(target.read_bytes())
    assert current['mcpServers']['Ripple']['command'] == str(python)
    assert current['mcpServers']['Other'] == old['mcpServers']['Other']
