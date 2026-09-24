import json
import os
import threading
import uuid
from functools import wraps
from pathlib import Path

from dotenv import dotenv_values

from .runtime_paths import DATA_ROOT

PROJECT_ROOT = DATA_ROOT
ENV_PATH = PROJECT_ROOT / ".env"
# 命名凭据档案库：每个引擎可存多套带备忘名的密钥，其中一套为「启用中」。
# .env 的读-改-写必须串行：前端并发拉多个引擎凭据时会有多个 GET 同时触发
# reconcile 写 .env（FastAPI 同步路由跑在线程池），不加锁会互相覆盖丢密钥。
_ENV_LOCK = threading.RLock()

def locked_store(function):
    """Serialize complete credential transactions, including nested reconciliation."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        with _ENV_LOCK:
            return function(*args, **kwargs)
    return wrapped

# 启用中的那套始终镜像进 .env（见 _sync_env），因此所有 provider 的运行时读取
# 代码（get_credential）完全不用改。
PROFILES_PATH = PROJECT_ROOT / "credentials.json"

# 历史遗留：早期只有 ElevenLabs，写死了这个变量名。它与新的命名规则
# （<PROVIDER_ID>_<FIELD_KEY> = ELEVENLABS_API_KEY）恰好一致，所以老配置无需迁移。
ELEVENLABS_KEY_NAME = "ELEVENLABS_API_KEY"


def credential_env_name(provider_id: str, field_key: str) -> str:
    return f"{provider_id.upper()}_{field_key.upper()}"


@locked_store
def get_credential(provider_id: str, field_key: str) -> str | None:
    """读取某个引擎的某项凭据。.env 优先，回落环境变量。"""
    name = credential_env_name(provider_id, field_key)
    file_value = dotenv_values(ENV_PATH).get(name)
    if file_value:
        return str(file_value)
    env_value = os.getenv(name)
    return str(env_value) if env_value else None


@locked_store
def save_credentials(provider_id: str, values: dict[str, str]) -> None:
    """把某个引擎的凭据写回 .env。同名的旧值会被替换，其余行原样保留。"""
    replacements = {
        credential_env_name(provider_id, key): f"{credential_env_name(provider_id, key)}={value.strip()}"
        for key, value in values.items()
    }
    with _ENV_LOCK:
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []

        updated: list[str] = []
        seen: set[str] = set()
        for line in lines:
            name = line.split("=", 1)[0]
            if name in replacements:
                updated.append(replacements[name])
                seen.add(name)
            else:
                updated.append(line)
        for name, replacement in replacements.items():
            if name not in seen:
                updated.append(replacement)

        # 注意：不要用 ENV_PATH.with_suffix(".env.tmp")——`.env` 是隐藏文件，
        # Python 视整个 `.env` 为文件名（无标准后缀），with_suffix 会拼成
        # `.env.env.tmp`，导致后续 replace 时源文件不存在（FileNotFoundError）。
        # 用唯一文件名 + 原子替换：即使没有锁保护（如跨进程），并发写者各自落盘、
        # 最后一次 replace 生效（值幂等，无副作用）。
        temporary = Path(f"{ENV_PATH}.{os.getpid()}.{uuid.uuid4().hex[:6]}.tmp")
        temporary.write_text("\n".join(updated) + "\n", encoding="utf-8")
        temporary.replace(ENV_PATH)


def get_elevenlabs_api_key() -> str | None:
    return get_credential("elevenlabs", "api_key")


# ---------------------------------------------------------------------------
# 命名凭据档案（多套 / 备忘名 / 启用切换）
# ---------------------------------------------------------------------------

def _load_profile_store() -> dict:
    """Read the store; report corruption rather than replacing credentials."""
    if not PROFILES_PATH.exists():
        return {}
    try:
        return json.loads(PROFILES_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError("凭据配置文件损坏，请恢复备份后重试") from error


def _save_profile_store(data: dict) -> None:
    temporary = Path(f"{PROFILES_PATH}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary.replace(PROFILES_PATH)


def _provider_entry(data: dict, provider_id: str) -> dict:
    entry = data.get(provider_id)
    if entry is None:
        entry = {"profiles": [], "active_id": None}
        data[provider_id] = entry
    entry.setdefault("profiles", [])
    entry.setdefault("active_id", None)
    return entry


def _active_profile(data: dict, provider_id: str) -> dict | None:
    entry = _provider_entry(data, provider_id)
    return next(
        (p for p in entry["profiles"] if p["id"] == entry["active_id"]), None
    )


@locked_store
def clear_credentials(provider_id: str, field_keys: list[str] | None = None) -> None:
    """从 .env 中删除该引擎的密钥行（用于停用/删除启用档案时清理）。

    传入 ``field_keys`` 时按精确键名删除，避免「iflytek」与「iflytek_llm」这类
    共享前缀的引擎互相误删；不传则回退到前缀匹配（兼容旧调用）。
    """
    exact = (
        {credential_env_name(provider_id, key) for key in field_keys}
        if field_keys is not None
        else None
    )
    prefix = f"{provider_id.upper()}_"
    with _ENV_LOCK:
        lines = (
            ENV_PATH.read_text(encoding="utf-8").splitlines()
            if ENV_PATH.exists()
            else []
        )

        def _keep(line: str) -> bool:
            name = line.split("=", 1)[0]
            if exact is not None:
                return name not in exact
            return not name.startswith(prefix)

        kept = [line for line in lines if _keep(line)]
        ENV_PATH.write_text(
            ("\n".join(kept) + "\n") if kept else "", encoding="utf-8"
        )


@locked_store
def _sync_env(provider_id: str, values: dict[str, str]) -> None:
    """把某套档案的密钥镜像进 .env（先清后写，保证启用切换干净）。"""
    clear_credentials(provider_id, list(values.keys()))
    if values:
        save_credentials(provider_id, values)


@locked_store
def reconcile_env_from_profiles() -> None:
    """把每个引擎「启用中」档案的密钥镜像回 .env。

    修复 .env 与档案库（credentials.json）不一致的情况：档案库才是用户意图的
    真源，.env 仅供 provider 运行时读取。无启用档案的引擎跳过，不动遗留行。
    """
    data = _load_profile_store()
    for provider_id, entry in data.items():
        if provider_id == "default_profile" or not isinstance(entry, dict):
            continue
        active = _active_profile(data, provider_id)
        if active:
            _sync_env(provider_id, active.get("values", {}))


@locked_store
def list_profiles_view(provider_id: str, fields: list) -> dict:
    """构造前端用的档案列表视图（不含任何密钥值，只给已填字段名）。

    全局「默认」是跨引擎唯一的：由顶层 default_profile 标记，而非每个引擎各一个。
    """
    data = _load_profile_store()
    entry = _provider_entry(data, provider_id)
    default = data.get("default_profile")
    field_keys = [f.key for f in fields]
    profiles = []
    for p in entry["profiles"]:
        present = [k for k in field_keys if p.get("values", {}).get(k)]
        is_default = bool(
            default
            and default.get("provider_id") == provider_id
            and default.get("profile_id") == p["id"]
        )
        profiles.append(
            {
                "id": p["id"],
                "name": p.get("name", "未命名"),
                "active": p["id"] == entry["active_id"],
                "is_default": is_default,
                "field_keys_present": present,
            }
        )
    return {
        "provider_id": provider_id,
        "profiles": profiles,
        "active_profile_id": entry["active_id"],
        "default_profile": default,
    }


@locked_store
def get_default_profile() -> dict | None:
    """返回全局默认档案标记 {provider_id, profile_id}，没有则返回 None。"""
    data = _load_profile_store()
    return data.get("default_profile")


@locked_store
def set_default_profile(provider_id: str, profile_id: str) -> bool:
    """把某套档案设为「全局默认」（跨引擎唯一）。

    同时把该引擎的「启用」档案切到这一套并镜像进 .env，保证转录默认走它。
    其余引擎的启用档案保持不变，仍可正常选用。
    """
    data = _load_profile_store()
    entry = _provider_entry(data, provider_id)
    target = next((p for p in entry["profiles"] if p["id"] == profile_id), None)
    if not target:
        return False
    data["default_profile"] = {"provider_id": provider_id, "profile_id": profile_id}
    if entry["active_id"] != profile_id:
        entry["active_id"] = profile_id
        _sync_env(provider_id, target.get("values", {}))
    _save_profile_store(data)
    return True


@locked_store
def add_profile(
    provider_id: str, name: str, values: dict[str, str], default_name: str = "未命名"
) -> str:
    """新增一套档案；若此前没有任何启用档案，则自动启用并写入 .env。

    当这是该引擎的第一套密钥且用户未指定名称时，使用 ``default_name``
    （调用方应传入 provider 的显示名称，例如 "ElevenLabs Scribe v2"），
    避免使用容易与“启用中”状态混淆的"默认配置"。
    """
    data = _load_profile_store()
    entry = _provider_entry(data, provider_id)
    profile_id = str(uuid.uuid4())[:8]
    chosen_name = name or " · ".join(filter(None, [default_name, values.get("model")]))
    entry["profiles"].append(
        {"id": profile_id, "name": chosen_name, "values": dict(values)}
    )
    if not entry["active_id"]:
        entry["active_id"] = profile_id
        _sync_env(provider_id, values)
    if not data.get("default_profile"):
        data["default_profile"] = {"provider_id": provider_id, "profile_id": profile_id}
    _save_profile_store(data)
    return profile_id


@locked_store
def update_profile(
    provider_id: str, profile_id: str, name: str | None, values: dict[str, str]
) -> bool:
    """更新档案名与密钥；留空的字段不参与覆盖（保留原值）。若它是启用档案则同步 .env。"""
    data = _load_profile_store()
    entry = _provider_entry(data, provider_id)
    for p in entry["profiles"]:
        if p["id"] != profile_id:
            continue
        if name is not None:
            p["name"] = name
        merged = dict(p.get("values", {}))
        for key, value in values.items():
            if value not in (None, ""):
                merged[key] = value
        p["values"] = merged
        if entry["active_id"] == profile_id:
            _sync_env(provider_id, merged)
        _save_profile_store(data)
        return True
    return False


@locked_store
def delete_profile(provider_id: str, profile_id: str) -> None:
    """删除一套档案；若它正是启用档案，则清空 .env 并解除启用。"""
    data = _load_profile_store()
    entry = _provider_entry(data, provider_id)
    if data.get("default_profile") == {"provider_id": provider_id, "profile_id": profile_id}:
        data.pop("default_profile")
    removed = next((p for p in entry["profiles"] if p["id"] == profile_id), None)
    entry["profiles"] = [p for p in entry["profiles"] if p["id"] != profile_id]
    if entry["active_id"] == profile_id:
        entry["active_id"] = None
        clear_credentials(
            provider_id, list((removed or {}).get("values", {}).keys())
        )
    _save_profile_store(data)


@locked_store
def activate_profile(provider_id: str, profile_id: str) -> bool:
    """把某套档案设为启用，并将其密钥镜像进 .env。"""
    data = _load_profile_store()
    entry = _provider_entry(data, provider_id)
    target = next((p for p in entry["profiles"] if p["id"] == profile_id), None)
    if not target:
        return False
    entry["active_id"] = profile_id
    _sync_env(provider_id, target.get("values", {}))
    _save_profile_store(data)
    return True


@locked_store
def reveal_profile(provider_id: str, profile_id: str) -> dict | None:
    """返回某套档案的完整密钥值（仅供前端「眼睛」图标按需查看，不进入列表视图）。"""
    data = _load_profile_store()
    entry = _provider_entry(data, provider_id)
    target = next((p for p in entry["profiles"] if p["id"] == profile_id), None)
    if not target:
        return None
    return dict(target.get("values", {}))


@locked_store
def upsert_active(
    provider_id: str, values: dict[str, str], default_name: str = "默认配置"
) -> str:
    """兼容旧的单套写入：更新「启用中」档案的密钥（或不存在时新建并启用）。"""
    cleaned = {k: v for k, v in values.items() if v not in (None, "")}
    data = _load_profile_store()
    entry = _provider_entry(data, provider_id)
    if entry["active_id"]:
        for p in entry["profiles"]:
            if p["id"] == entry["active_id"]:
                merged = dict(p.get("values", {}))
                merged.update(cleaned)
                p["values"] = merged
    else:
        new_id = str(uuid.uuid4())[:8]
        entry["profiles"].append(
            {"id": new_id, "name": default_name, "values": dict(cleaned)}
        )
        entry["active_id"] = new_id
    active = _active_profile(data, provider_id)
    _sync_env(provider_id, active["values"] if active else {})
    _save_profile_store(data)
    return entry["active_id"]
