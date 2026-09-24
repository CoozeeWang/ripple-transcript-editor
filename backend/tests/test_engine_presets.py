import httpx
import pytest
from fastapi.testclient import TestClient

from app import ai_editing, ai_engines
from app.engine_catalog import PRESETS
from app.main import app

client = TestClient(app)


def values(provider):
    preset = PRESETS[provider]
    return {"base_url": preset.base_url or "https://example.test/v1", "model": (preset.models or ("custom-model",))[0], "api_key": "private-key" if preset.key_required else ""}


def test_old_store_gains_catalog_without_changing_defaults_or_secrets():
    original = {"config": values("deepseek"), "profiles": [], "engines": {
        "deepseek": {"profiles": [{"id": "old", "name": "My engine", "values": values("deepseek")}], "active_id": "old"},
        "compatible": {"profiles": [], "active_id": None}},
        "default_engine": {"provider_id": "deepseek", "profile_id": "old"}}
    ai_editing.write_store(original)
    before = ai_engines.config_revision(original["config"])
    response = client.get("/api/ai/providers")
    assert response.status_code == 200
    assert len(response.json()) == 11
    assert "private-key" not in response.text
    assert client.get("/api/ai/config").json()["revision"] == before
    added = client.post("/api/ai/providers/claude/credentials", json={"values": values("claude")})
    assert added.status_code == 200
    config = client.get("/api/ai/config").json()
    assert config["selected_engine_id"] == "old"
    assert len(config["engines"]) == 2
    assert ai_editing.read_store()["engines"]["deepseek"] == original["engines"]["deepseek"]


@pytest.mark.parametrize("provider", PRESETS)
def test_all_presets_request_the_right_protocol_and_validate_results(provider, monkeypatch):
    config = values(provider)
    calls = []
    async def post(self, url, **kwargs):
        calls.append((url, kwargs))
        if provider == "claude":
            return httpx.Response(200, json={"stop_reason": "tool_use", "content": [{"type": "tool_use", "name": "ripple_result", "input": {"ok": True}}]})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": '{"ok":true}'}}]})
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    response = client.post(f"/api/ai/providers/{provider}/test", json={"values": config})
    assert response.status_code == 200, response.text
    url, request = calls[0]
    assert url == config["base_url"] + ("/messages" if provider == "claude" else "/chat/completions")
    assert request["json"]["model"] == config["model"]
    if provider == "claude":
        assert request["headers"]["x-api-key"] == "private-key"
        assert "Authorization" not in request["headers"]
        assert request["json"]["tool_choice"]["name"] == "ripple_result"
    elif provider == "gemini":
        assert request["json"]["response_format"]["type"] == "json_schema"
    assert not ai_editing.STORE_PATH.exists()  # Probing never changes saved credentials.


@pytest.mark.parametrize("payload,category", [
    ({"stop_reason": "max_tokens"}, "output_limit"),
    ({"stop_reason": "end_turn", "content": []}, "format"),
    ({"stop_reason": "tool_use", "content": [{"type": "tool_use", "name": "other", "input": {"ok": True}}]}, "format"),
    ({"stop_reason": "tool_use", "content": [{"type": "tool_use", "name": "ripple_result", "input": {"unknown": True}}]}, "format"),
])
def test_claude_incomplete_or_invalid_results_never_pass(payload, category, monkeypatch):
    async def post(*args, **kwargs): return httpx.Response(200, json=payload)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    response = client.post("/api/ai/providers/claude/test", json={"values": values("claude")})
    assert response.status_code == 502
    assert response.headers["X-Ripple-Failure"] == category


def test_claude_selection_and_revision_follow_saved_provider():
    result = client.post("/api/ai/providers/claude/credentials", json={"values": values("claude")}).json()
    profile_id = result["profiles"][0]["id"]
    runtime = ai_engines.resolve_config(profile_id)
    assert runtime["protocol"] == "anthropic"
    config = client.get("/api/ai/config").json()
    assert config["revision"] == config["engines"][0]["revision"] == ai_engines.config_revision(runtime)
    assert "protocol" not in client.get(f"/api/ai/providers/claude/credentials/{profile_id}/reveal").json()["values"]


def test_official_key_not_sent_to_other_host(monkeypatch):
    async def get(*args, **kwargs): pytest.fail("must not send key")
    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    response = client.post("/api/ai/providers/kimi/models", json={"values": {**values("kimi"), "base_url": "https://other.test/v1"}})
    assert response.status_code == 422
    assert "private-key" not in response.text


def test_models_support_empty_model_and_never_store_key(monkeypatch):
    async def get(self, url, **kwargs):
        assert url == "https://api.anthropic.com/v1/models"
        assert kwargs["headers"]["x-api-key"] == "private-key"
        return httpx.Response(200, json={"data": [{"id": "new-model"}, {"id": "new-model"}, {"id": 8}]})
    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    response = client.post("/api/ai/providers/claude/models", json={"values": {**values("claude"), "model": ""}})
    assert response.json() == {"models": ["new-model"]}
    assert not ai_editing.STORE_PATH.exists()


def test_model_list_failure_is_sanitized(monkeypatch):
    async def get(*args, **kwargs): return httpx.Response(401, text="private-key")
    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    response = client.post("/api/ai/providers/openai/models", json={"values": values("openai")})
    assert response.status_code == 502
    assert "private-key" not in response.text
