import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import manuscripts
from app.main import app


def test_legacy_word_roundtrip_stays_local(tmp_path):
    if not manuscripts.TEXTUTIL.is_file():
        pytest.skip('macOS textutil required')
    source = tmp_path / '访谈.txt'
    source.write_text('受访者：第一段原话。\n采访者：第二段问题。', encoding='utf-8')
    target = tmp_path / '访谈.doc'
    subprocess.run([str(manuscripts.TEXTUTIL), '-convert', 'doc', '-output', str(target), str(source)], check=True, capture_output=True)
    content = target.read_bytes()
    result = TestClient(app).post('/api/manuscripts/legacy-word', files={'file': ('访谈.doc', content, 'application/msword')})
    assert result.status_code == 200, result.text
    assert '第一段原话' in result.json()['text']
    assert '第二段问题' in result.json()['text']
    assert target.read_bytes() == content


def test_legacy_word_errors_are_actionable(monkeypatch):
    client = TestClient(app)
    assert client.post('/api/manuscripts/legacy-word', files={'file': ('bad.doc', b'')}).status_code == 422
    assert client.post('/api/manuscripts/legacy-word', files={'file': ('bad.exe', b'anything')}).status_code == 422
    monkeypatch.setattr(manuscripts, 'TEXTUTIL', Path('/no-such-tool'))
    result = client.post('/api/manuscripts/legacy-word', files={'file': ('old.doc', b'data')})
    assert result.status_code == 422
    assert '.docx' in result.json()['detail']


def test_legacy_word_size_and_timeout(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(manuscripts, 'MAX_BYTES', 3)
    assert client.post('/api/manuscripts/legacy-word', files={'file': ('old.doc', b'abcd')}).status_code == 413
    monkeypatch.setattr(manuscripts, 'TEXTUTIL', Path(__file__))
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('textutil', 30)
    monkeypatch.setattr(manuscripts.subprocess, 'run', timeout)
    result = client.post('/api/manuscripts/legacy-word', files={'file': ('old.doc', b'abc')})
    assert result.status_code == 422
    assert '超时' in result.json()['detail']
