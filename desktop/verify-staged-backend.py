"""Run inside the staged backend with only bundled Python and packages available."""

import json
from pathlib import Path

from app import diagnostics, settings
from app import main as app_main
from app.main import app
from app.runtime_paths import CODE_ROOT, DATA_ROOT
from app.product_version import PRODUCT_VERSION
from fastapi.testclient import TestClient

stage = Path(__file__).resolve().parent
assert CODE_ROOT == stage
assert DATA_ROOT == stage / "data"
assert Path(app_main.__file__).resolve().is_relative_to(stage)
assert TestClient(app).get("/api/health").status_code == 200
assert PRODUCT_VERSION != "unknown"
assert PRODUCT_VERSION == json.loads((stage / "product-version.json").read_text())["version"]
assert TestClient(app).get("/api/diagnostics").json()["version"] == PRODUCT_VERSION
assert app.version == PRODUCT_VERSION

settings.save_credentials("probe", {"api_key": "fixture-only"})
diagnostics.record_failure("service", 500)
assert settings.ENV_PATH == DATA_ROOT / ".env" and settings.ENV_PATH.exists()
assert settings.PROFILES_PATH == DATA_ROOT / "credentials.json"
assert diagnostics.LOG_PATH == DATA_ROOT / ".logs/diagnostics.json" and diagnostics.LOG_PATH.exists()
assert not (stage / ".env").exists()
assert not (stage / "credentials.json").exists()
print(json.dumps({"health": 200, "productVersion": PRODUCT_VERSION, "codeRoot": str(CODE_ROOT), "dataRoot": str(DATA_ROOT),
                  "configurationInDataRoot": True, "diagnosticsInDataRoot": True}))
