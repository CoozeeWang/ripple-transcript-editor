import json

from fastapi.testclient import TestClient

from app.main import app
from app.product_version import PRODUCT_VERSION, product_version
from app.runtime_paths import CODE_ROOT


def test_diagnostics_and_service_use_the_product_version():
    expected = json.loads((CODE_ROOT / "desktop/src-tauri/tauri.conf.json").read_text())["version"]
    assert PRODUCT_VERSION == app.version == expected
    assert TestClient(app).get("/api/diagnostics").json()["version"] == expected


def test_packaged_version_survives_relocation_without_the_repository(tmp_path):
    (tmp_path / "product-version.json").write_text(json.dumps({"version": "9.8.7-beta.2"}))
    assert product_version(tmp_path) == "9.8.7-beta.2"


def test_source_version_uses_the_canonical_product_configuration(tmp_path):
    config = tmp_path / "desktop/src-tauri/tauri.conf.json"
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({"version": "9.8.7"}))
    assert product_version(tmp_path) == "9.8.7"
    (tmp_path / "product-version.json").write_text(json.dumps({"version": "9.8.8"}))
    assert product_version(tmp_path) == "9.8.8"


def test_invalid_or_missing_identity_is_not_reported_as_an_old_version(tmp_path, monkeypatch):
    monkeypatch.setenv("RIPPLE_DATA_DIR", str(tmp_path))
    assert product_version(tmp_path / "separate-code") == "unknown"
    for value in ("not json", "null", "[]", json.dumps({"version": "private payload"}), " " * 65537):
        (tmp_path / "product-version.json").write_text(value)
        assert product_version(tmp_path) == "unknown"
