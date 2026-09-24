from fastapi.testclient import TestClient

from app import storage
from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_get_demo_transcript() -> None:
    response = client.get("/api/interviews/demo/transcript")

    assert response.status_code == 200
    assert len(response.json()["segments"]) > 0


def test_unknown_interview_returns_not_found() -> None:
    response = client.get("/api/interviews/unknown/transcript")

    assert response.status_code == 404


def test_list_interviews_includes_demo(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(storage, "INTERVIEWS_DIR", tmp_path)

    response = client.get("/api/interviews")

    assert response.status_code == 200
    assert response.json()[0]["id"] == "demo"


def test_create_interview_and_load_empty_transcript(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(storage, "INTERVIEWS_DIR", tmp_path)
    draft = {
        "title": "第一次访谈",
        "recorded_at": "2026-08-29T14:00",
        "location": "上海",
        "participants": [
            {"name": "王远", "role": "采访者"},
            {"name": "林老师", "role": "受访者"},
        ],
        "topics": ["城市记忆"],
        "notes": "测试访谈",
    }

    create_response = client.post("/api/interviews", json=draft)

    assert create_response.status_code == 201
    interview_id = create_response.json()["id"]

    transcript_response = client.get(f"/api/interviews/{interview_id}/transcript")
    assert transcript_response.status_code == 200
    assert transcript_response.json()["segments"] == []
    assert [speaker["name"] for speaker in transcript_response.json()["speakers"]] == [
        "王远",
        "林老师",
    ]
