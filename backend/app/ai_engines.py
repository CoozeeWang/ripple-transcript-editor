"""Named text-engine credentials, isolated from transcription credentials."""
import hashlib
import json
import uuid
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import Field

from . import ai_editing as storage
from .engine_catalog import PRESETS

router = APIRouter(prefix="/api/ai", tags=["Editing engines"])
CATALOG = {key: preset.name for key, preset in PRESETS.items()}


def fields(provider_id):
    preset = PRESETS[provider_id]
    return [
        {"key": "model", "label": "模型", "secret": False, "required": True,
         "placeholder": "选择模型或填写完整模型 ID", "options": list(preset.models),
         "default_value": preset.models[0] if preset.models else "",
         "description": "可手动填写其他模型 ID；模型列表不代表账户权限或兼容性验证。"},
        {"key": "api_key", "label": "API 密钥", "secret": True, "required": preset.key_required,
         "placeholder": "粘贴开放平台创建的 API Key" if preset.key_required else "本机免密服务可不填",
         "description": preset.description},
        {"key": "base_url", "label": "服务地址", "secret": False, "required": True,
         "placeholder": "API 基础地址", "default_value": preset.base_url,
         "options": list(preset.urls), "advanced": bool(preset.base_url) and not preset.urls,
         "read_only": preset.key_required and not preset.urls, "allow_custom": not preset.key_required,
         "description": "已预填服务地址。自定义代理请使用其他编辑引擎入口。" if preset.key_required else "基础地址，不包含 /chat/completions。"},
    ]


class CredentialInput(storage.StrictModel):
    name: str = Field(default="", max_length=100)
    values: dict[str, str] = Field(max_length=3)


def validate_values(provider_id, values):
    try:
        config = storage.Configuration.model_validate(values)
    except ValueError as exc:
        raise HTTPException(422, "请检查服务地址、模型名称和 API 密钥。地址须为 HTTPS，本机服务可使用 HTTP。") from exc
    if not config.model or not config.model.strip():
        raise HTTPException(422, "请填写服务商提供的完整模型名称")
    preset = PRESETS[provider_id]
    allowed_urls = preset.urls or (preset.base_url,)
    # Official entries cannot silently forward a saved key to an unrelated host.
    if preset.key_required and config.base_url not in allowed_urls and not (
        provider_id == "deepseek" and config.base_url == "https://api.deepseek.com/v1"
    ):
        raise HTTPException(422, "请使用所选服务的官方地址；自定义代理请添加到其他编辑引擎。")
    if preset.key_required and not config.api_key:
        raise HTTPException(422, "请填写所选服务开放平台创建的 API 密钥")
    return {**config.model_dump(), "api_key": config.api_key or ""}


def load_store():
    data = storage.read_store()
    if "engines" not in data:
        data["engines"] = {key: {"profiles": [], "active_id": None} for key in CATALOG}
        data["default_engine"] = None
        legacy = data.get("config", {})
        if legacy.get("base_url") and legacy.get("model"):
            provider = "deepseek" if urlsplit(legacy["base_url"]).hostname == "api.deepseek.com" else "compatible"
            profile = {"id": uuid.uuid4().hex, "name": legacy["model"], "values": legacy.copy()}
            data["engines"][provider] = {"profiles": [profile], "active_id": profile["id"]}
            data["default_engine"] = {"provider_id": provider, "profile_id": profile["id"]}
            storage.write_store(data)
    # Existing multi-engine stores also need newly introduced provider groups.
    for key in CATALOG:
        data["engines"].setdefault(key, {"profiles": [], "active_id": None})
    return data


def entry(data, provider):
    if provider not in CATALOG:
        raise HTTPException(404, "没有这个编辑引擎")
    return data["engines"][provider]


def find_profile(data, provider, profile_id):
    value = next((p for p in entry(data, provider)["profiles"] if p["id"] == profile_id), None)
    if value is None:
        raise HTTPException(404, "这套编辑配置已不存在，请重新载入")
    return value


def synchronize(data):
    default = data.get("default_engine")
    data["config"] = find_profile(data, default["provider_id"], default["profile_id"])["values"].copy() if default else {}
    storage.write_store(data)


def list_view(data, provider):
    group = entry(data, provider)
    return {"provider_id": provider, "provider_name": CATALOG[provider], "experimental": False,
            "fields": fields(provider), "active_profile_id": group["active_id"], "default_profile": data["default_engine"],
            "profiles": [{"id": p["id"], "name": p["name"], "active": p["id"] == group["active_id"],
                          "is_default": data["default_engine"] == {"provider_id": provider, "profile_id": p["id"]},
                          "field_keys_present": [k for k, v in p["values"].items() if v],
                          "public_values": {k: p["values"].get(k, "") for k in ("base_url", "model")}}
                         for p in group["profiles"]]}


@router.get("/providers")
def providers():
    with storage._lock:
        data = load_store()
        return [{"id": key, "name": name, "configured": bool(data["engines"][key]["active_id"]),
                 "models": list(PRESETS[key].models), "credential_fields": fields(key)} for key, name in CATALOG.items()]


@router.get("/providers/{provider}/credentials")
def credentials(provider: str):
    with storage._lock:
        return list_view(load_store(), provider)


@router.post("/providers/{provider}/credentials")
def add(provider: str, body: CredentialInput):
    with storage._lock:
        data = load_store()
        group = entry(data, provider)
        values = validate_values(provider, body.values)
        profile = {"id": uuid.uuid4().hex, "name": body.name.strip() or values["model"], "values": values}
        group["profiles"].append(profile)
        group["active_id"] = group["active_id"] or profile["id"]
        if not data["default_engine"]:
            data["default_engine"] = {"provider_id": provider, "profile_id": profile["id"]}
        synchronize(data)
        return list_view(data, provider)


@router.get("/providers/{provider}/credentials/{profile_id}/reveal")
def reveal(provider: str, profile_id: str):
    with storage._lock:
        value = find_profile(load_store(), provider, profile_id)
        return {"values": value["values"].copy()}


@router.put("/providers/{provider}/credentials/{profile_id}")
def update(provider: str, profile_id: str, body: CredentialInput):
    with storage._lock:
        data = load_store()
        profile = find_profile(data, provider, profile_id)
        # Editing loads the actual saved key. Empty is an explicit clear, never a sentinel.
        profile["values"] = validate_values(provider, body.values)
        profile["name"] = body.name.strip() or profile["values"]["model"]
        synchronize(data)
        return list_view(data, provider)


@router.post("/providers/{provider}/credentials/{profile_id}/activate")
def activate(provider: str, profile_id: str):
    with storage._lock:
        data = load_store()
        find_profile(data, provider, profile_id)
        entry(data, provider)["active_id"] = profile_id
        # Keep the default pointing at the active credentials within its provider.
        if data["default_engine"] and data["default_engine"]["provider_id"] == provider:
            data["default_engine"]["profile_id"] = profile_id
        synchronize(data)
        return list_view(data, provider)


@router.post("/providers/{provider}/credentials/{profile_id}/default")
def set_default(provider: str, profile_id: str):
    with storage._lock:
        data = load_store()
        find_profile(data, provider, profile_id)
        data["default_engine"] = {"provider_id": provider, "profile_id": profile_id}
        entry(data, provider)["active_id"] = profile_id
        synchronize(data)
        return list_view(data, provider)


@router.delete("/providers/{provider}/credentials/{profile_id}")
def remove(provider: str, profile_id: str):
    with storage._lock:
        data = load_store()
        find_profile(data, provider, profile_id)
        group = entry(data, provider)
        group["profiles"] = [p for p in group["profiles"] if p["id"] != profile_id]
        if group["active_id"] == profile_id:
            group["active_id"] = None
        if data["default_engine"] == {"provider_id": provider, "profile_id": profile_id}:
            data["default_engine"] = None
        synchronize(data)
        return list_view(data, provider)


def resolve_config(engine_id=None):
    with storage._lock:
        data = load_store()
        if engine_id:
            for provider, group in data["engines"].items():
                for p in group["profiles"]:
                    if p["id"] == engine_id:
                        return runtime_config(provider, p["values"])
            raise HTTPException(409, "所选编辑配置已被删除，请重新选择引擎")
        default = data.get("default_engine")
        return runtime_config(default["provider_id"] if default else "compatible", data["config"])


def runtime_config(provider, values):
    config = values.copy()
    protocol = PRESETS.get(provider, PRESETS["compatible"]).protocol
    if protocol != "openai":
        config["protocol"] = protocol
    return config


def config_revision(config):
    # Fingerprint endpoint/model only; never derive a public digest from credentials.
    public = {k: config.get(k, "") for k in ("base_url", "model")}
    if config.get("protocol"):
        public["protocol"] = config["protocol"]
    return hashlib.sha256(json.dumps(public, sort_keys=True).encode()).hexdigest()


def configuration_view():
    with storage._lock:
        data = load_store()
        result = storage.config_view(data["config"])
        result["revision"] = config_revision(resolve_config())
        result["selected_engine_id"] = data["default_engine"]["profile_id"] if data["default_engine"] else None
        result["engines"] = [{"id": p["id"], "name": p["name"],
                              "model": p["values"]["model"], "revision": config_revision(runtime_config(key, p["values"])), "active": group["active_id"] == p["id"]}
                             for key, group in data["engines"].items() for p in group["profiles"]]
        return result


def update_legacy_config(data, value):
    # Preserve callers of the previous single-engine endpoint without deleting extra engines.
    if "engines" in data and data.get("default_engine"):
        d = data["default_engine"]
        find_profile(data, d["provider_id"], d["profile_id"])["values"] = value.copy()
    elif "engines" in data:
        provider = "deepseek" if urlsplit(value["base_url"]).hostname == "api.deepseek.com" else "compatible"
        p = {"id": uuid.uuid4().hex, "name": value["model"], "values": value.copy()}
        data["engines"][provider]["profiles"].append(p)
        data["engines"][provider]["active_id"] = p["id"]
        data["default_engine"] = {"provider_id": provider, "profile_id": p["id"]}


class ModelQuery(storage.StrictModel):
    values: dict[str, str] = Field(max_length=3)


@router.post("/providers/{provider}/models")
async def available_models(provider: str, body: ModelQuery):
    if provider not in PRESETS:
        raise HTTPException(404, "没有这个编辑引擎")
    config = validate_values(provider, {**body.values, "model": body.values.get("model") or "list-models"})
    protocol = PRESETS[provider].protocol
    headers = {"Authorization": f"Bearer {config['api_key']}"} if config.get("api_key") else {}
    if protocol == "anthropic":
        headers = {"x-api-key": config["api_key"], "anthropic-version": "2023-06-01"}
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.get(config["base_url"] + "/models", headers=headers)
        if response.status_code >= 300:
            raise HTTPException(502, "无法读取模型列表，请检查密钥及地址；也可以手动填写模型 ID。")
        models = response.json()["data"]
        if not isinstance(models, list):
            raise TypeError("invalid model list")
        ids = sorted({item["id"] for item in models if isinstance(item, dict)
                      and isinstance(item.get("id"), str) and 0 < len(item["id"]) <= 200})
        return {"models": ids[:2000]}
    except (httpx.RequestError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(502, "暂时无法读取模型列表；可以使用预设或手动填写模型 ID。") from exc


class ProbeResult(storage.StrictModel):
    ok: bool


@router.post("/providers/{provider}/test")
async def test_connection(provider: str, body: ModelQuery):
    if provider not in PRESETS:
        raise HTTPException(404, "没有这个编辑引擎")
    config = runtime_config(provider, validate_values(provider, body.values))
    result = await storage.request_completion(config, '只返回 JSON 对象 {"ok":true}。', {"test": True}, ProbeResult)
    if not result.ok:
        raise HTTPException(502, "模型未返回预期的测试结果")
    return {"ok": True}
