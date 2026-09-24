from fastapi.testclient import TestClient

from app.main import app
from app.public_errors import error_fields, identify_message


def test_error_codes_separate_dynamic_values_and_keep_provider_code():
    fields = error_fields({"message": "讯飞返回错误：原始服务错误", "code": "upstream_error"}, 502)
    assert fields["code"] == "upstream_error"
    assert fields["message_code"].startswith("ripple_")
    assert fields["params"] == {"v0": "原始服务错误"}


def test_unknown_details_do_not_become_localization_keys():
    assert identify_message("password or arbitrary private text") == (None, {})
    assert error_fields("unknown", 502)["code"] == "http_502"


def test_api_returns_stable_code_without_exposing_validation_input():
    response = TestClient(app).post("/api/ai/edit", json={"api_key": "secret-test-value", "segments": "private manuscript"})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["message_code"] == "ripple_validation_error"
    assert "secret-test-value" not in response.text
    assert "private manuscript" not in response.text


def test_http_errors_include_code_and_legacy_detail():
    response = TestClient(app).get("/api/providers/nonexistent/credentials")
    assert response.status_code == 404
    assert response.json()["code"] == "unknown_provider"
    assert response.json()["detail"]["code"] == "unknown_provider"
