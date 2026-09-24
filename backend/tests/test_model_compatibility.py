"""Regression coverage for actual provider wire formats and incomplete responses."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import TranscriptionOptions
from app.providers.base import ProviderError
from app.providers.funasr import FunASRProvider
from app.providers.openai_compatible import normalize_transcript, transcribe_audio


def test_whisper_requests_both_timestamp_levels(tmp_path, monkeypatch):
    captured = []
    def post(self, url, **kwargs):
        request = httpx.Request("POST", url, **kwargs)
        captured.append(request.read())
        return httpx.Response(200, json={"text": "hello"})
    monkeypatch.setattr(httpx.Client, "post", post)
    audio = tmp_path / "sample.wav"
    audio.write_bytes(b"test audio")
    transcribe_audio(audio, audio.name, TranscriptionOptions(), "https://example.test/v1", "whisper-1", None)
    body = captured[0]
    assert body.count(b'name="timestamp_granularities[]"') == 2
    assert b"\r\n\r\nword\r\n" in body
    assert b"\r\n\r\nsegment\r\n" in body


@pytest.mark.parametrize("model", ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "gpt-4o-transcribe-diarize"])
def test_unadapted_model_stops_before_audio_upload(tmp_path, model):
    with pytest.raises(ProviderError, match="尚未适配") as error:
        transcribe_audio(tmp_path / "does-not-exist.wav", "audio.wav", TranscriptionOptions(),
                         "https://api.openai.com/v1", model, None)
    assert error.value.code == "unsupported_model"


WORDS = [{"word": "Hello", "start": 0.2, "end": 0.8},
         {"word": "world", "start": 1.1, "end": 1.6}]


def test_whisper_top_level_words_attach_without_loss_or_duplication():
    result = normalize_transcript({"duration": 3, "text": "Hello world!", "words": WORDS,
        "segments": [{"start": 0, "end": 1, "text": "Hello"},
                     {"start": 1, "end": 2, "text": "world!"}]}, "sample.wav")
    assert [[w.text for w in s.words] for s in result.segments] == [["Hello"], ["world"]]
    assert result.audio.duration == 3


def test_whisper_word_only_response_keeps_text_and_playback_times():
    result = normalize_transcript({"duration": 3, "text": "Hello world!", "words": WORDS}, "sample.wav")
    segment = result.segments[0]
    assert (segment.text, segment.start, segment.end) == ("Hello world!", 0.2, 1.6)
    assert len(segment.words) == 2


@pytest.mark.parametrize("response,code", [
    ({"text": "Hello"}, "missing_timestamps"),
    ({"segments": [{"text": "Hello", "start": "bad", "end": 1}]}, "bad_response"),
    ({"segments": [{"text": "Hello", "start": 2, "end": 1}]}, "bad_response"),
    ({"segments": [{"text": "Hello", "start": 0, "end": float("inf")}]}, "bad_response"),
    ({"text": "Hello", "words": [None]}, "bad_response"),
])
def test_invalid_timestamps_do_not_create_fake_zero_length_transcripts(response, code):
    with pytest.raises(ProviderError) as error:
        normalize_transcript(response, "sample.wav")
    assert error.value.code == code


@pytest.mark.parametrize("choice", [None, [], "invalid"])
def test_malformed_editing_choice_returns_readable_error(monkeypatch, choice):
    client = TestClient(app)
    client.put("/api/ai/config", json={"base_url": "https://example.test/v1", "model": "test"})
    async def post(self, url, **kwargs):
        return httpx.Response(200, json={"choices": [choice]})
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    result = client.post("/api/ai/learn", json={"examples": [{"before": "a", "after": "b"}]})
    assert result.status_code == 502
    assert "未应用任何修改" in result.json()["detail"]


@pytest.mark.parametrize("ending,code", [("timeout", "timeout"),
    ({"is_end": True, "is_final": False}, "incomplete_result"),
    ([], "bad_response")])
def test_funasr_partial_results_are_not_success(monkeypatch, ending, code):
    messages = [{"mode": "2pass-offline", "is_final": True, "text": "只有开头",
                 "timestamp": [[0, 1000]]}, ending]
    class Socket:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def send(self, message):
            pass
        async def recv(self):
            message = messages.pop(0)
            if message == "timeout":
                raise TimeoutError
            return json.dumps(message)
    monkeypatch.setattr("websockets.connect", lambda *args, **kwargs: Socket())
    with pytest.raises(ProviderError) as error:
        asyncio.run(FunASRProvider()._ws_transcribe(b"", "localhost", 10095, "audio.wav"))
    assert error.value.code == code


@pytest.mark.parametrize("status,body,code", [(200, "not json", "bad_response"),
                                             (400, "[]", "bad_request")])
def test_unexpected_http_body_becomes_provider_error(tmp_path, monkeypatch, status, body, code):
    monkeypatch.setattr(httpx.Client, "post", lambda *args, **kwargs: httpx.Response(status, text=body))
    audio = tmp_path / "sample.wav"
    audio.write_bytes(b"test audio")
    with pytest.raises(ProviderError) as error:
        transcribe_audio(audio, audio.name, TranscriptionOptions(),
                         "https://example.test/v1", "whisper-1", None)
    assert error.value.code == code
