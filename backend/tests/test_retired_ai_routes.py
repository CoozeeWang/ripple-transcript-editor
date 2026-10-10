"""The retired in-process AI editing API must stay absent.

MCP remains the only AI editing entry point, so these URLs must not revive through
an accidental router import or a legacy backend process.
"""
from fastapi.testclient import TestClient

from app.main import app


def test_retired_ai_editing_routes_are_not_registered():
    client = TestClient(app)
    routes = [
        ("get", "/api/ai/config", None),
        ("get", "/api/ai/providers", None),
        ("post", "/api/ai/preferences", {"name": "synthetic"}),
        ("post", "/api/ai/plans", {"name": "synthetic"}),
        ("post", "/api/ai/learn", {"examples": []}),
        ("post", "/api/ai/edit", {"segments": []}),
    ]

    for method, path, body in routes:
        request = getattr(client, method)
        response = request(path) if body is None else request(path, json=body)
        assert response.status_code == 404, f"{method.upper()} {path}: {response.status_code}"


def test_provider_and_mcp_routes_remain_available():
    client = TestClient(app)
    assert client.get("/api/providers").status_code == 200
    assert client.post("/api/connector/poll", json={}).status_code != 404
