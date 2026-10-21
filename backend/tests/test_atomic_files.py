from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.atomic_files import atomic_write_text


def test_concurrent_publishes_use_independent_temporary_files(tmp_path):
    target = tmp_path / "synthetic.json"
    values = [str(i) * 4096 for i in range(12)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda text: atomic_write_text(target, text), values))
    assert target.read_text(encoding="utf-8") in values
    assert list(tmp_path.iterdir()) == [target]


def test_failed_flush_never_replaces_original(tmp_path, monkeypatch):
    from app import atomic_files

    target = tmp_path / "synthetic.json"
    target.write_text("old synthetic content", encoding="utf-8")
    def fail_flush(_fd):
        raise OSError("synthetic disk failure")
    monkeypatch.setattr(atomic_files.os, "fsync", fail_flush)
    with pytest.raises(OSError, match="synthetic disk failure"):
        atomic_write_text(target, "new synthetic content")
    assert target.read_text(encoding="utf-8") == "old synthetic content"
    assert list(tmp_path.iterdir()) == [target]


def test_legacy_store_preserves_original_on_failed_publish(tmp_path, monkeypatch):
    from app import storage
    from app.models import AudioInfo, Transcript

    monkeypatch.setattr(storage, "INTERVIEWS_DIR", tmp_path)
    transcript = Transcript(audio=AudioInfo(filename="synthetic.wav", duration=1), speakers=[], segments=[])
    target = storage.save_transcript("synthetic", transcript)
    before = target.read_bytes()
    replace = Path.replace
    def fail_publish(source, destination):
        if destination == target:
            raise OSError("synthetic publish failure")
        return replace(source, destination)
    monkeypatch.setattr(Path, "replace", fail_publish)
    with pytest.raises(OSError):
        storage.save_transcript("synthetic", transcript)
    assert target.read_bytes() == before
    assert not list(target.parent.glob("*.tmp"))
