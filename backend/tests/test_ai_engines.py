import json

import httpx
from fastapi.testclient import TestClient

from app import ai_editing
from app.main import app

client = TestClient(app)


def add(provider="compatible", model="model-one", key="key-one", name="个人账户"):
    response = client.post(f"/api/ai/providers/{provider}/credentials", json={"name": name, "values": {
        "base_url": "https://api.deepseek.com" if provider == "deepseek" else "https://text.example/v1",
        "model": model, "api_key": key}})
    assert response.status_code == 200, response.text
    return response.json()["profiles"][-1]["id"]


def test_migration_preserves_legacy_configuration_and_preferences_once():
    legacy = {"base_url": "https://api.deepseek.com", "model": "existing-model", "api_key": "private-key"}
    ai_editing.STORE_PATH.write_text(json.dumps({"config": legacy, "profiles": [{"id": "style", "name": "旧偏好"}]}))
    first = client.get("/api/ai/providers/deepseek/credentials")
    assert first.status_code == 200
    profile = first.json()["profiles"][0]
    assert profile["name"] == "existing-model"
    assert profile["is_default"] and profile["active"]
    assert "private-key" not in first.text
    assert client.get("/api/ai/providers/deepseek/credentials").json() == first.json()
    assert ai_editing.read_store()["profiles"] == [{"id": "style", "name": "旧偏好"}]
    assert client.get(f"/api/ai/providers/deepseek/credentials/{profile['id']}/reveal").json()["values"] == legacy


def test_multiple_providers_and_keys_default_activation_and_explicit_deletion():
    one = add("deepseek", "flash", "key-first")
    two = add("deepseek", "pro", "key-second")
    other = add()
    assert client.get("/api/ai/config").json()["model"] == "flash"
    client.post(f"/api/ai/providers/deepseek/credentials/{two}/activate")
    assert client.get("/api/ai/config").json()["model"] == "pro"
    client.post(f"/api/ai/providers/compatible/credentials/{other}/default")
    response = client.get("/api/ai/config")
    assert response.json()["model"] == "model-one"
    assert len(response.json()["engines"]) == 3
    for key in ("key-first", "key-second", "key-one"):
        assert key not in response.text
    client.delete(f"/api/ai/providers/deepseek/credentials/{one}")
    assert client.get("/api/ai/config").json()["selected_engine_id"] == other
    client.delete(f"/api/ai/providers/compatible/credentials/{other}")
    assert not client.get("/api/ai/config").json()["configured"]
    assert client.get("/api/ai/providers/deepseek/credentials").json()["profiles"][0]["id"] == two


def test_edit_uses_full_values_and_explicit_key_clear_and_keeps_other_profiles():
    first = add()
    second = add(model="model-two", key="key-two")
    response = client.put(f"/api/ai/providers/compatible/credentials/{first}", json={"name": "已改名", "values": {
        "base_url": "https://text.example/v1", "model": "new-model", "api_key": ""}})
    assert response.status_code == 200
    assert "api_key" not in response.json()["profiles"][0]["field_keys_present"]
    assert client.get(f"/api/ai/providers/compatible/credentials/{second}/reveal").json()["values"]["api_key"] == "key-two"
    assert client.get("/api/ai/config").json()["model"] == "new-model"


def test_explicit_selection_drives_request_model_and_credentials_not_global_default(monkeypatch):
    add(model="default-model", key="default-key")
    selected = add(model="chosen-model", key="chosen-key")
    calls = []
    async def post(self, url, **kwargs):
        calls.append(kwargs)
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"rules": ["保留口语：保留语气和停顿"], "instructions": "保留口语"})}}]})
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    body = {"engine_id": selected, "examples": [{"before": "我我觉得", "after": "我觉得"}]}
    assert client.post("/api/ai/learn", json=body).status_code == 200
    assert calls[0]["json"]["model"] == "chosen-model"
    assert calls[0]["headers"]["Authorization"] == "Bearer chosen-key"
    client.delete(f"/api/ai/providers/compatible/credentials/{selected}")
    assert client.post("/api/ai/learn", json=body).status_code == 409
    assert len(calls) == 1


def test_validation_preserves_store_and_transcription_credentials(tmp_path):
    before = add()
    saved = ai_editing.STORE_PATH.read_text()
    response = client.post("/api/ai/providers/deepseek/credentials", json={"values": {"base_url": "https://evil.example", "model": "x", "api_key": "sensitive"}})
    assert response.status_code == 422
    assert "sensitive" not in response.text
    assert ai_editing.STORE_PATH.read_text() == saved
    assert client.get(f"/api/ai/providers/compatible/credentials/{before}/reveal").status_code == 200
    assert not (tmp_path / "credentials.json").exists()
    assert not (tmp_path / ".env").exists()
