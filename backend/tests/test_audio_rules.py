"""Synthetic official-document checks; no audio or provider calls."""
from unittest.mock import patch

import httpx
import pytest
from fastapi import HTTPException

from app import audio_rules as rules
from app.audio_routes import router


def test_document_refresh_is_read_only_allowlisted_and_never_updates_rules(tmp_path, monkeypatch):
    monkeypatch.setattr(rules, 'DATA_ROOT', tmp_path)
    before = rules.rules('tencent_flash')
    seen = []
    real_client = httpx.Client
    def mock_client(**kwargs):
        assert kwargs['trust_env'] is False and kwargs['follow_redirects'] is False
        def handler(request):
            seen.append(request)
            return httpx.Response(200, text='<html>Official document changed</html>')
        return real_client(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(rules.httpx, 'Client', mock_client)
    after = rules.refresh('tencent_flash')
    assert after['formats'] == before['formats'] and after['version'] == before['version']
    assert after['review_required'] and not after['rule_updated'] and after['checked_at']
    assert str(seen[0].url) == rules.RULES['tencent_flash'][3]
    assert seen[0].method == 'GET' and not seen[0].content and 'authorization' not in seen[0].headers
    with pytest.raises(HTTPException):
        rules.refresh('https://synthetic.invalid/private')
    assert len(seen) == 1


def test_failed_refresh_preserves_previous_verified_rules(tmp_path, monkeypatch):
    monkeypatch.setattr(rules, 'DATA_ROOT', tmp_path)
    cache = tmp_path / 'audio-rule-checks.json'
    cache.write_text('{"tencent_flash":{"checked_at":"earlier","review_required":true}}')
    with (patch.object(rules.httpx, 'Client', side_effect=httpx.ConnectError('synthetic')),
          pytest.raises(HTTPException)):
        rules.refresh('tencent_flash')
    assert rules.rules('tencent_flash')['checked_at'] == 'earlier'



def test_conversion_and_repair_routes_are_not_available():
    routes={(route.path,method) for route in router.routes for method in route.methods}
    assert routes == {('/api/audio/rules/{provider}','GET'),('/api/audio/rules/{provider}/refresh','POST')}
