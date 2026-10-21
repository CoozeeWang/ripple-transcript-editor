"""Synthetic credentials and paths; no installed client or real data is used."""
import asyncio
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import connector
from app.connector_config import (
    CLIENT_FILES,
    KEY_FILES,
    delete_client,
    disabled_clients,
    enable_client,
)


def fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(connector, "DATA_ROOT", tmp_path)
    broker = connector.Broker()
    broker.initialize()
    monkeypatch.setattr(connector, "broker", broker)
    originals = {}
    for names in CLIENT_FILES.values():
        for name in names:
            path = tmp_path / "connector" / name
            if not path.exists():
                path.write_bytes(b"synthetic configuration")
            originals[name] = path.read_bytes()
    (tmp_path / "synthetic-transcript.json").write_bytes(b"synthetic transcript remains untouched")
    return broker, originals


@pytest.mark.parametrize("client", CLIENT_FILES)
def test_delete_revokes_only_selected_client_and_survives_restart(tmp_path, monkeypatch, client):
    broker, originals = fixture(tmp_path, monkeypatch)
    window_key = broker.window_key
    tokens = {c: (tmp_path / "connector" / name).read_text() for c, name in KEY_FILES.items()}
    delete_client(tmp_path, client)
    assert disabled_clients(tmp_path) == {client}
    for name in CLIENT_FILES[client]:
        assert not (tmp_path / "connector" / name).exists()
    for other in set(CLIENT_FILES) - {client}:
        broker.authorize("Bearer " + tokens[other], "client")
        for name in CLIENT_FILES[other]:
            assert (tmp_path / "connector" / name).read_bytes() == originals[name]
    broker.authorize("Bearer " + window_key, "window")
    with pytest.raises(HTTPException) as error:
        broker.authorize("Bearer " + tokens[client], "client")
    assert error.value.status_code == 401
    restarted = connector.Broker()
    restarted.initialize()
    assert not (tmp_path / "connector" / KEY_FILES[client]).exists()
    with pytest.raises(HTTPException):
        restarted.authorize("Bearer " + tokens[client], "client")
    assert (tmp_path / "synthetic-transcript.json").read_bytes() == b"synthetic transcript remains untouched"
    # Idempotent removal and explicit re-add do not restore the revoked value.
    delete_client(tmp_path, client)
    enable_client(tmp_path, client)
    fresh = (tmp_path / "connector" / KEY_FILES[client]).read_text()
    assert fresh != tokens[client] and client not in disabled_clients(tmp_path)
    restarted.authorize("Bearer " + fresh, "client")
    with pytest.raises(HTTPException):
        restarted.authorize("Bearer " + tokens[client], "client")


def test_invalid_target_and_symlink_change_nothing(tmp_path, monkeypatch):
    _broker, originals = fixture(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        delete_client(tmp_path, "../other")
    target = tmp_path / "connector/Ripple.mcpb"
    target.unlink()
    outside = tmp_path / "synthetic-unrelated"
    outside.write_bytes(b"must remain")
    target.symlink_to(outside)
    with pytest.raises(ValueError):
        delete_client(tmp_path, "claude")
    assert outside.read_bytes() == b"must remain"
    assert (tmp_path / "connector/claude.key").read_bytes() == originals["claude.key"]
    assert disabled_clients(tmp_path) == set()


def test_failure_rolls_back_key_and_disabled_state(tmp_path, monkeypatch):
    from pathlib import Path
    broker, originals = fixture(tmp_path, monkeypatch)
    original_unlink = Path.unlink
    def fail_export(path, *args, **kwargs):
        if path.name == "Ripple.mcpb":
            raise PermissionError("synthetic denial")
        return original_unlink(path, *args, **kwargs)
    monkeypatch.setattr(Path, "unlink", fail_export)
    with pytest.raises(PermissionError):
        delete_client(tmp_path, "claude")
    assert disabled_clients(tmp_path) == set()
    for name in CLIENT_FILES["claude"]:
        assert (tmp_path / "connector" / name).read_bytes() == originals[name]
    broker.authorize("Bearer " + originals["claude.key"].decode(), "client")


def test_concurrent_config_change_is_refused_without_removing_its_lock(tmp_path, monkeypatch):
    _broker, originals = fixture(tmp_path, monkeypatch)
    lock = tmp_path / "connector/.client-config.lock"
    lock.write_text("synthetic existing operation")
    with pytest.raises(FileExistsError):
        delete_client(tmp_path, "claude")
    with pytest.raises(FileExistsError):
        enable_client(tmp_path, "workbuddy")
    assert lock.exists()
    assert disabled_clients(tmp_path) == set()
    assert (tmp_path / "connector/claude.key").read_bytes() == originals["claude.key"]


def test_racing_replacement_is_preserved_and_client_stays_disabled(tmp_path, monkeypatch):
    from app import connector_config
    broker, originals = fixture(tmp_path, monkeypatch)
    original_read = connector_config.read_local_file
    reads = 0
    def replace_export(path):
        nonlocal reads
        if path.name == "Ripple.mcpb":
            reads += 1
            if reads == 2:
                path.write_bytes(b"synthetic external replacement")
        return original_read(path)
    monkeypatch.setattr(connector_config, "read_local_file", replace_export)
    with pytest.raises(ValueError):
        delete_client(tmp_path, "claude")
    assert (tmp_path / "connector/Ripple.mcpb").read_bytes() == b"synthetic external replacement"
    assert (tmp_path / "connector/claude.key").read_bytes() == originals["claude.key"]
    assert disabled_clients(tmp_path) == {"claude"}
    with pytest.raises(HTTPException):
        broker.authorize("Bearer " + originals["claude.key"].decode(), "client")


def test_delete_endpoint_requires_window_auth_and_strict_client(tmp_path, monkeypatch):
    broker, _originals = fixture(tmp_path, monkeypatch)
    app = FastAPI()
    app.include_router(connector.router)
    with TestClient(app) as client:
        assert client.post("/api/connector/configuration/delete", json={"client":"claude"}).status_code == 401
        assert client.post("/api/connector/configuration/delete", json={"client":"claude"},
                           headers={"Authorization":"Bearer " + broker.client_key}).status_code == 401
        headers = {"Authorization":"Bearer " + broker.window_key}
        for body in [{"client":"other"}, {"client":"claude", "path":"synthetic-unrelated"}]:
            assert client.post("/api/connector/configuration/delete", json=body, headers=headers).status_code == 422
        assert client.post("/api/connector/configuration/delete", json={"client":"claude"}, headers=headers).json() == {"deleted":"claude"}
        assert client.post("/api/connector/configuration/delete", json={"client":"claude"}, headers=headers).status_code == 200


def test_inflight_selected_request_blocks_delete_but_other_client_does_not(tmp_path, monkeypatch):
    broker, _originals = fixture(tmp_path, monkeypatch)
    async def run():
        pending = asyncio.get_running_loop().create_future()
        broker.calls["synthetic-request"] = ("digest", "window", pending)
        broker.call_clients["synthetic-request"] = "claude"
        with pytest.raises(HTTPException) as error:
            await connector.delete_configuration(connector.DeleteConfiguration(client="claude"), "Bearer " + broker.window_key)
        assert error.value.detail == "connector_client_busy"
        assert disabled_clients(tmp_path) == set()
        broker.call_clients["synthetic-request"] = "workbuddy"
        await connector.delete_configuration(connector.DeleteConfiguration(client="claude"), "Bearer " + broker.window_key)
        assert not pending.done() and "synthetic-request" in broker.calls
    asyncio.run(run())


@pytest.mark.parametrize("value", ["bad json", "{}", '["other"]', '["claude","claude"]'])
def test_invalid_persistent_state_fails_closed(tmp_path, monkeypatch, value):
    broker, originals = fixture(tmp_path, monkeypatch)
    (tmp_path / "connector/disabled-clients.json").write_text(value)
    with pytest.raises((ValueError, json.JSONDecodeError)):
        delete_client(tmp_path, "claude")
    with pytest.raises(HTTPException) as error:
        broker.authorize("Bearer " + originals["claude.key"].decode(), "client")
    assert error.value.status_code == 503
