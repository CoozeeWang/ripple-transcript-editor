"""Public synthetic paths and credentials only."""
import json
import zipfile

import pytest
from fastapi import HTTPException

from app import connector
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
    claude = (tmp_path / "connector/claude.key").read_text()
    workbuddy = (tmp_path / "connector/workbuddy.key").read_text()
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
    python = resources / "python/bin/python3.12"
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
        assert manifest["compatibility"]["platforms"] == ["darwin"]
        script = package.read("server/index.js").decode()
        assert secret not in script
        assert json.dumps(str(python)) in script
        assert "claude.key" in script
    other = tmp_path / "Ripple-WorkBuddy.json"
    export_installation(data, resources, "workbuddy", other)
    config = json.loads(other.read_text())["mcpServers"]["Ripple"]
    assert config["type"] == "stdio"
    assert config["command"] == str(python)
    assert config["args"][-1].endswith("workbuddy.key")
    assert secret not in other.read_text()
    # Repeat export remains one valid artifact and does not alter stored credentials.
    export_installation(data, resources, "claude", target)
    assert (data / "connector/claude.key").read_text() == secret


def test_missing_runtime_creates_no_export(tmp_path):
    target = tmp_path / "Ripple.mcpb"
    with pytest.raises(ValueError):
        export_installation(tmp_path, tmp_path / "missing", "claude", target)
    assert not target.exists()
