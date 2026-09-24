"""Run inside the staged backend with only bundled Python and packages available."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app import ai_editing, diagnostics, main as app_main, settings
from app.main import app
from app.runtime_paths import CODE_ROOT, DATA_ROOT

stage = Path(__file__).resolve().parent
assert CODE_ROOT == stage
assert DATA_ROOT == stage / "data"
assert Path(app_main.__file__).resolve().is_relative_to(stage)
assert TestClient(app).get("/api/health").status_code == 200

settings.save_credentials("probe", {"api_key": "fixture-only"})
diagnostics.record_failure("service", 500)
assert settings.ENV_PATH == DATA_ROOT / ".env" and settings.ENV_PATH.exists()
assert settings.PROFILES_PATH == DATA_ROOT / "credentials.json"
assert ai_editing.STORE_PATH == DATA_ROOT / "ai-editing.json"
assert diagnostics.LOG_PATH == DATA_ROOT / ".logs/diagnostics.json" and diagnostics.LOG_PATH.exists()
assert not (stage / ".env").exists()
assert not (stage / "credentials.json").exists()
print(json.dumps({"health": 200, "codeRoot": str(CODE_ROOT), "dataRoot": str(DATA_ROOT),
                  "configurationInDataRoot": True, "diagnosticsInDataRoot": True}))
