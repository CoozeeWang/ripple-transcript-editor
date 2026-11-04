"""Versioned reviewed rules. Refresh checks official pages, never executes page instructions.
HTML is not a machine-readable rules contract, so refresh never silently edits rules.
"""
import json
from datetime import UTC, datetime

import httpx
from fastapi import HTTPException

from .atomic_files import atomic_write_text
from .runtime_paths import DATA_ROOT

VERSION = 1
VERIFIED = '2026-11-02'
RULES = {
    'tencent_flash': (['wav', 'pcm', 'ogg-opus', 'speex', 'silk', 'mp3', 'm4a', 'aac', 'amr'], 100_000_000, 7200, 'https://cloud.tencent.com/document/product/1093/52097'),
    'tencent_cloud': (['wav', 'mp3', 'm4a', 'flv', 'mp4', 'wma', '3gp', 'amr', 'aac', 'ogg-opus', 'flac'], 5_000_000, None, 'https://cloud.tencent.com/document/product/1093/37823'),
    'tencent_cloud_url': (['wav', 'mp3', 'm4a', 'flv', 'mp4', 'wma', '3gp', 'amr', 'aac', 'ogg-opus', 'flac'], 1_000_000_000, 18000, 'https://cloud.tencent.com/document/product/1093/37823'),
    'iflytek_lfasr': (['mp3', 'wav', 'pcm', 'aac', 'opus', 'flac', 'ogg', 'm4a', 'amr', 'speex', 'mp4'], 500_000_000, 18000, 'https://www.xfyun.cn/doc/asr/ifasr_new/API.html'),
    'iflytek_lfasr_llm': (['mp3', 'wav', 'pcm', 'opus', 'flac', 'ogg', 'speex'], 500_000_000, 18000, 'https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html'),
    'elevenlabs': (['aac', 'aiff', 'ogg', 'mp3', 'opus', 'wav', 'webm', 'flac', 'm4a', 'mp4'], None, None, 'https://elevenlabs.io/docs/overview/capabilities/speech-to-text'),
}


def rules(provider: str):
    row = RULES.get(provider)
    cached = {}
    try:
        cached = json.loads((DATA_ROOT / 'audio-rule-checks.json').read_text()).get(provider, {})
    except (OSError, ValueError, TypeError):
        pass
    return {'version': VERSION, 'verified': VERIFIED, 'formats': row[0] if row else [],
            'max_bytes': row[1] if row else None, 'max_seconds': row[2] if row else None,
            'url': row[3] if row else None,
            'checked_at': cached.get('checked_at') if isinstance(cached,dict) else None,
            'review_required': isinstance(cached,dict) and cached.get('review_required') is True,
            'rule_updated': False}


def refresh(provider: str):
    row = RULES.get(provider)
    if not row:
        raise HTTPException(422, detail={'code': 'ruleUnknown', 'message_code': 'audioInformation.ruleUnknown'})
    try:
        # Exact source URL from code; no user URL, redirects, credentials, cookies or proxy.
        with (httpx.Client(timeout=8, follow_redirects=False, trust_env=False) as client,
              client.stream('GET', row[3], headers={'Accept': 'text/html'}) as response):
            response.raise_for_status()
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 2_000_000:
                    raise ValueError('document too large')
            if not size:
                raise ValueError('empty document')
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, detail={'code': 'refreshFailed', 'message_code': 'audioInformation.refreshFailed'}) from None
    path = DATA_ROOT / 'audio-rule-checks.json'
    try:
        previous = json.loads(path.read_text()) if path.exists() else {}
    except (OSError, ValueError):
        previous = {}
    previous[provider] = {'checked_at': datetime.now(UTC).isoformat(), 'review_required': True}
    atomic_write_text(path, json.dumps(previous), private=True)
    return rules(provider)
