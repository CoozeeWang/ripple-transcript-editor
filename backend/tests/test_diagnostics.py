import json
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app import diagnostics
from app.main import app


def test_records_failed_requests_without_request_content():
    client = TestClient(app)
    response = client.post('/api/ai/edit?private=secret-key', json={'private': '机密访谈全文'})
    assert response.status_code == 422
    result = client.get('/api/diagnostics').json()
    assert result['records'][0]['operation'] == 'editing'
    assert result['records'][0]['status'] == 422
    saved = diagnostics.LOG_PATH.read_text()
    for secret in ['secret-key', '机密访谈全文', 'private', '/api/ai/edit']:
        assert secret not in saved
    assert len(client.get('/api/diagnostics').json()['records']) == 1


def test_bounded_persistent_records_and_expiry(monkeypatch):
    for _ in range(105):
        diagnostics.record_failure('transcription', 502)
    assert len(diagnostics.recent_problems()) == 100
    monkeypatch.setattr(diagnostics, '_cache', [])
    assert len(diagnostics.recent_problems()) == 100
    rows = diagnostics.recent_problems()
    rows[0]['time'] = (datetime.now(UTC) - timedelta(days=8)).isoformat()
    rows[1]['raw'] = 'secret-key'
    diagnostics.LOG_PATH.write_text(json.dumps(rows))
    clean = diagnostics.diagnostics()
    assert len(clean['records']) == 99
    assert 'secret-key' not in json.dumps(clean)
    assert diagnostics.LOG_PATH.stat().st_size < 65536


def test_cannot_write_log_does_not_break_the_operation(tmp_path, monkeypatch):
    blocker = tmp_path / 'file'
    blocker.write_text('x')
    monkeypatch.setattr(diagnostics, 'LOG_PATH', blocker / 'diagnostics.json')
    diagnostics.record_failure('save', 500)
    assert diagnostics.recent_problems()[0]['operation'] == 'save'
