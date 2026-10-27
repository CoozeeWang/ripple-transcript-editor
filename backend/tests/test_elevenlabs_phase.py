"""Synthetic HTTP transport: no real audio, credentials, or provider calls."""
import httpx
import pytest

from app import progress
from app.models import TranscriptionOptions
from app.providers.elevenlabs import ElevenLabsError, transcribe_audio


def test_upload_stays_current_until_the_entire_multipart_body_is_consumed(tmp_path, monkeypatch):
    audio = tmp_path / "synthetic.m4a"
    content = b"synthetic-audio" * 20000
    audio.write_bytes(content)
    real_client = httpx.Client
    chunks = []

    class Transport(httpx.BaseTransport):
        def handle_request(self, request):
            assert request.url.path == "/v1/speech-to-text"
            for chunk in request.stream:
                snapshot = progress.REGISTRY.snapshot("synthetic-job")
                assert snapshot["phase"] == progress.PHASE_SENDING
                assert snapshot["total_bytes"] == 0
                chunks.append(chunk)
            assert progress.REGISTRY.snapshot("synthetic-job")["phase"] == progress.PHASE_PROCESSING
            body = b"".join(chunks)
            assert len(body) == int(request.headers["content-length"])
            assert content in body and b"scribe_v2" in body
            return httpx.Response(200, json={"words": []})

    monkeypatch.setattr(httpx, "Client", lambda **kw: real_client(transport=Transport(), **kw))
    try:
        with progress.job_context("synthetic-job"):
            assert transcribe_audio(audio, audio.name, TranscriptionOptions(), "synthetic-key") == {"words": []}
        assert len(chunks) > 2
    finally:
        progress.REGISTRY.end("synthetic-job")


@pytest.mark.parametrize("consume_partial", [False, True])
def test_failed_upload_is_not_reported_as_processing(tmp_path, monkeypatch, consume_partial):
    audio = tmp_path / "synthetic.m4a"
    audio.write_bytes(b"synthetic" * 20000)
    real_client = httpx.Client

    class Transport(httpx.BaseTransport):
        def handle_request(self, request):
            if consume_partial:
                body = iter(request.stream)
                next(body)
                next(body)
            assert progress.REGISTRY.snapshot("failed-job")["phase"] == progress.PHASE_SENDING
            raise httpx.WriteError("synthetic write failure")

    monkeypatch.setattr(httpx, "Client", lambda **kw: real_client(transport=Transport(), **kw))
    with progress.job_context("failed-job"), pytest.raises(ElevenLabsError):
        transcribe_audio(audio, audio.name, TranscriptionOptions(), "synthetic-key")
    assert progress.REGISTRY.snapshot("failed-job") == {"active": False}
