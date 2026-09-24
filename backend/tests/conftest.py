"""Pytest fixture: redirect every application-owned path to tmp_path."""
import pytest


@pytest.fixture(autouse=True)
def isolate_application_storage(tmp_path, monkeypatch):
    from app import ai_editing, diagnostics, main, settings, storage
    monkeypatch.setattr(diagnostics, "LOG_PATH", tmp_path / "diagnostics.json")
    monkeypatch.setattr(diagnostics, "_cache", [])
    monkeypatch.setattr(diagnostics, "_storage_available", True)
    monkeypatch.setattr(ai_editing, "STORE_PATH", tmp_path / "ai-editing.json")
    monkeypatch.setattr(settings, "ENV_PATH", tmp_path / ".env")
    monkeypatch.setattr(settings, "PROFILES_PATH", tmp_path / "credentials.json")
    monkeypatch.setattr(main, "PROFILES_PATH", tmp_path / "credentials.json")
    monkeypatch.setattr(storage, "INTERVIEWS_DIR", tmp_path / "interviews")
    for key in list(__import__('os').environ):
        if key.startswith(('ELEVENLABS_', 'IFLYTEK_', 'IFLYTEK_LLM_', 'OPENAI_COMPATIBLE_', 'TENCENT_', 'FUNASR_')):
            monkeypatch.delenv(key, raising=False)
