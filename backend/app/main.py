import asyncio
import mimetypes
import tempfile
from dataclasses import asdict
from pathlib import Path as FilePath
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Path, Query, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import diagnostics, manuscripts, progress, transcription_jobs
from .ai_editing import router as ai_editing_router
from .ai_engines import router as ai_engines_router
from .models import (
    AudioStatus,
    CredentialUpsert,
    InterviewDraft,
    InterviewMetadata,
    Transcript,
    TranscriptionOptions,
)
from .providers.base import ProviderError, ProviderInfo
from .providers.diagnostics import human_bytes, provider_call
from .providers.registry import PROVIDERS, get_provider, list_providers
from .public_errors import error_fields
from .settings import (
    PROFILES_PATH,
    _load_profile_store,
    _save_profile_store,
    activate_profile,
    add_profile,
    delete_profile,
    get_credential,
    get_default_profile,
    list_profiles_view,
    locked_store,
    reconcile_env_from_profiles,
    reveal_profile,
    set_default_profile,
    update_profile,
    upsert_active,
)
from .storage import (
    audio_path,
    create_interview,
    list_interviews,
    load_metadata,
    load_transcript,
    save_normalized_transcript,
    save_original_response,
    save_transcript,
    update_metadata,
)

app = FastAPI(title="Ripple", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(ai_editing_router)
app.include_router(ai_engines_router)
app.include_router(diagnostics.router)
app.include_router(manuscripts.router)


@app.middleware("http")
async def collect_diagnostics(request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        route = getattr(request.scope.get("route"), "path", "")
        if not route.startswith("/api/diagnostics"):
            diagnostics.record_failure(diagnostics.request_operation(route), 500)
        raise
    route = getattr(request.scope.get("route"), "path", "")
    if response.status_code >= 400 and not route.startswith("/api/diagnostics"):
        diagnostics.record_failure(diagnostics.request_operation(route), response.status_code, response.headers.get("X-Ripple-Failure"), response.headers.get("X-Ripple-Error-Code"))
    return response


@app.exception_handler(StarletteHTTPException)
async def public_http_error(request, exc):
    fields = error_fields(exc.detail, exc.status_code, (exc.headers or {}).get("X-Ripple-Failure"))
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, **fields},
                        headers={**(exc.headers or {}), "X-Ripple-Error-Code": fields["code"]})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    # Do not echo API keys, file paths, or manuscript excerpts from validation input.
    detail = "输入内容过长或格式不正确，请检查服务地址、名称、示范及段落范围。"
    return JSONResponse(status_code=422, content={"detail": detail, "code": "validation_error",
                        "message_code": "ripple_validation_error", "params": {}},
                        headers={"X-Ripple-Error-Code": "validation_error"})


@app.exception_handler(Exception)
async def debug_exception_handler(request, exc):
    # Unexpected exception messages may contain credentials or transcript text.
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error",
                        "code": "internal_error", "message_code": "ripple_internal_error", "params": {}},
                        headers={"X-Ripple-Error-Code": "internal_error"})


InterviewId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]+$")]


def provider_http_error(error: ProviderError) -> HTTPException:
    """把引擎的失败包成结构化 4xx/5xx。

    detail 里带 code（前端据它选文案和动作）与 raw（服务商英文原文，供复制排查），
    不再把英文原话直接丢给用户。
    """
    status_code = error.status_code if 400 <= error.status_code < 500 else 502
    return HTTPException(
        status_code=status_code,
        detail={"message": str(error), "code": error.code, "raw": error.raw},
    )

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/shutdown")
async def shutdown() -> dict[str, str]:
    """给前端一个「可以关窗了」的确认信号。

    真正的进程清理统一由 launcher（scripts/launcher.mjs）的 watch 执行：前端
    收到本响应后关闭应用窗口，watch 检测到窗口关闭即清理前后端服务。这里不再
    用 lsof / pkill 杀进程——那是 macOS 专属命令，且与本项目跨平台目标冲突。
    """
    return {"status": "shutting_down"}


@app.get("/api/providers", response_model=list[ProviderInfo])
def get_providers() -> list[ProviderInfo]:
    """列出所有引擎及其能力、凭据字段与是否已配置。不含任何密钥。"""
    return list_providers()


@locked_store
def _ensure_profiles_migrated() -> None:
    """把 .env 里已有的密钥搬进 credentials.json（幂等、可补全），并维护全局默认。

    - 文件不存在时：从 .env 一次性播种所有有密钥的引擎（每引擎首套用 provider 名命名）。
    - 文件已存在时：仅为「当前还没有任何档案」的引擎补一套，不覆盖用户已建立的档案。
    - 把历史上自动生成的「默认配置」占位名改成该引擎的显示名（例如
      「腾讯录音文件识别（标准版）」），避免误导。
    - 若还没有全局默认档案，则取第一个有启用档案的引擎作为默认。
    """
    import uuid

    data = _load_profile_store()
    changed = False
    for provider in list_providers():
        entry = data.setdefault(provider.id, {"profiles": [], "active_id": None})
        entry.setdefault("profiles", [])
        entry.setdefault("active_id", None)
        if not entry["profiles"]:
            values = {
                field.key: get_credential(provider.id, field.key)
                for field in provider.credential_fields
            }
            values = {key: value for key, value in values.items() if value}
            if values:
                profile_id = str(uuid.uuid4())[:8]
                entry["profiles"].append(
                    {"id": profile_id, "name": provider.name, "values": values}
                )
                entry["active_id"] = profile_id
                changed = True
        # 把历史占位名「默认配置」纠正为引擎显示名
        for p in entry["profiles"]:
            if p.get("name") == "默认配置":
                p["name"] = provider.name
                changed = True
    # 维护全局唯一默认：取第一个有启用档案的引擎
    if "default_profile" not in data:
        for provider in list_providers():
            entry = data.get(provider.id)
            if entry and entry.get("active_id"):
                data["default_profile"] = {
                    "provider_id": provider.id,
                    "profile_id": entry["active_id"],
                }
                changed = True
                break
    if changed or not PROFILES_PATH.exists():
        _save_profile_store(data)
    # 反向对账：把每个引擎「启用中」档案的密钥镜像回 .env，修复脱节。
    reconcile_env_from_profiles()


def _credential_list_view(provider_id: str) -> dict:
    """组装某个引擎的档案列表视图（含字段定义与实验标记，不含密钥值）。"""
    provider = get_provider(provider_id)
    view = list_profiles_view(provider_id, provider.credential_fields)
    view["provider_name"] = provider.name
    view["experimental"] = bool(provider.experimental)
    view["fields"] = [asdict(field) for field in provider.credential_fields]
    return view


@app.get("/api/providers/{provider_id}/credentials")
def get_credentials(provider_id: str) -> dict:
    """列出某引擎的全部命名凭据档案（仅字段名与启用状态，不含密钥值）。"""
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail={"message": f"没有这个转录引擎：{provider_id}", "code": "unknown_provider"})
    _ensure_profiles_migrated()
    return _credential_list_view(provider_id)


@app.post("/api/providers/{provider_id}/credentials")
def post_credentials(provider_id: str, body: CredentialUpsert) -> dict:
    """新增一套命名凭据档案。若此前无启用档案则自动启用。"""
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail={"message": f"没有这个转录引擎：{provider_id}", "code": "unknown_provider"})
    provider = get_provider(provider_id)
    allowed = {field.key for field in provider.credential_fields}
    cleaned = {k: v for k, v in body.values.items() if k in allowed and v not in (None, "")}
    if not cleaned:
        raise HTTPException(status_code=422, detail={"message": "没有可保存的凭据字段", "code": "bad_request"})
    _ensure_profiles_migrated()
    add_profile(provider_id, body.name, cleaned, default_name=provider.name)
    return _credential_list_view(provider_id)


@app.put("/api/providers/{provider_id}/credentials/{profile_id}")
def put_credentials(provider_id: str, profile_id: str, body: CredentialUpsert) -> dict:
    """更新某套档案的名称或密钥（留空字段不覆盖原值）。"""
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail={"message": f"没有这个转录引擎：{provider_id}", "code": "unknown_provider"})
    _ensure_profiles_migrated()
    ok = update_profile(provider_id, profile_id, body.name, body.values)
    if not ok:
        raise HTTPException(status_code=404, detail={"message": "找不到这套凭据档案", "code": "unknown_profile"})
    return _credential_list_view(provider_id)


@app.delete("/api/providers/{provider_id}/credentials/{profile_id}")
def delete_credentials(provider_id: str, profile_id: str) -> dict:
    """删除某套凭据档案；若它正启用则同步清空 .env。"""
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail={"message": f"没有这个转录引擎：{provider_id}", "code": "unknown_provider"})
    _ensure_profiles_migrated()
    delete_profile(provider_id, profile_id)
    return _credential_list_view(provider_id)


@app.post("/api/providers/{provider_id}/credentials/{profile_id}/activate")
def activate_credentials(provider_id: str, profile_id: str) -> dict:
    """把某套档案设为该引擎的「启用」档案（镜像进 .env），但不改变全局默认。"""
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail={"message": f"没有这个转录引擎：{provider_id}", "code": "unknown_provider"})
    _ensure_profiles_migrated()
    ok = activate_profile(provider_id, profile_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"message": "找不到这套凭据档案", "code": "unknown_profile"})
    return _credential_list_view(provider_id)


@app.post("/api/providers/{provider_id}/credentials/{profile_id}/default")
def set_default_credentials(provider_id: str, profile_id: str) -> dict:
    """把某套档案设为「全局默认」（跨引擎唯一）；同时把它设为该引擎的启用档案。"""
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail={"message": f"没有这个转录引擎：{provider_id}", "code": "unknown_provider"})
    _ensure_profiles_migrated()
    ok = set_default_profile(provider_id, profile_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"message": "找不到这套凭据档案", "code": "unknown_profile"})
    return _credential_list_view(provider_id)


@app.get("/api/credentials/default")
def get_default_credentials() -> dict:
    """返回当前全局默认档案标记 {provider_id, profile_id}，没有则为 null。"""
    _ensure_profiles_migrated()
    default = get_default_profile()
    return {"default_profile": default}


@app.get("/api/providers/{provider_id}/credentials/{profile_id}/reveal")
def reveal_credentials(provider_id: str, profile_id: str) -> dict:
    """按需返回某套档案的完整密钥值（仅供前端「眼睛」图标查看，不进入列表视图）。"""
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail={"message": f"没有这个转录引擎：{provider_id}", "code": "unknown_provider"})
    _ensure_profiles_migrated()
    values = reveal_profile(provider_id, profile_id)
    if values is None:
        raise HTTPException(status_code=404, detail={"message": "找不到这套凭据档案", "code": "unknown_profile"})
    return {"values": values}


@app.put("/api/providers/{provider_id}/credentials", response_model=ProviderInfo)
def put_provider_credentials(provider_id: str, values: dict[str, str]) -> ProviderInfo:
    """兼容旧调用：写入某个引擎的「启用中」凭据（更新或新建一套「默认配置」并启用）。

    字段名与 ProviderInfo.credential_fields 对应；仍供转录弹窗内的快速填写使用。
    """
    provider = get_provider(provider_id)
    if provider_id not in PROVIDERS:
        raise HTTPException(status_code=404, detail={"message": f"没有这个转录引擎：{provider_id}", "code": "unknown_provider"})
    allowed = {field.key for field in provider.credential_fields}
    cleaned = {key: value for key, value in values.items() if key in allowed}
    if not cleaned:
        raise HTTPException(status_code=422, detail={"message": "没有可保存的凭据字段", "code": "bad_request"})
    _ensure_profiles_migrated()
    upsert_active(provider.id, cleaned, default_name=provider.name)
    return provider.info()


@app.get("/api/interviews", response_model=list[InterviewMetadata])
def get_interviews() -> list[InterviewMetadata]:
    return list_interviews()


@app.post("/api/interviews", response_model=InterviewMetadata, status_code=201)
def post_interview(draft: InterviewDraft) -> InterviewMetadata:
    return create_interview(draft)


@app.get("/api/interviews/{interview_id}/metadata", response_model=InterviewMetadata)
def get_metadata(interview_id: InterviewId) -> InterviewMetadata:
    try:
        return load_metadata(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error


@app.put("/api/interviews/{interview_id}/metadata", response_model=InterviewMetadata)
def put_metadata(interview_id: InterviewId, draft: InterviewDraft) -> InterviewMetadata:
    try:
        return update_metadata(interview_id, draft)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error


@app.get("/api/interviews/{interview_id}/transcript", response_model=Transcript)
def get_transcript(interview_id: InterviewId) -> Transcript:
    try:
        return load_transcript(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error


@app.put("/api/interviews/{interview_id}/transcript")
def put_transcript(interview_id: InterviewId, transcript: Transcript) -> dict[str, str]:
    try:
        load_metadata(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error
    save_transcript(interview_id, transcript)
    return {"status": "saved"}


@app.get("/api/interviews/{interview_id}/audio-info", response_model=AudioStatus)
def get_audio_info(interview_id: InterviewId) -> AudioStatus:
    try:
        transcript = load_transcript(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error
    exists = audio_path(interview_id).is_file()
    return AudioStatus(exists=exists, filename=transcript.audio.filename if exists else None)


@app.post("/api/interviews/{interview_id}/audio", response_model=AudioStatus)
async def post_audio(
    interview_id: InterviewId, file: Annotated[UploadFile, File()]
) -> AudioStatus:
    try:
        load_metadata(interview_id)
        transcript = load_transcript(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error

    original_filename = FilePath(file.filename or "audio").name
    destination = audio_path(interview_id)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".upload")
    try:
        with temporary.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                output.write(chunk)
        temporary.replace(destination)
    finally:
        await file.close()
        temporary.unlink(missing_ok=True)

    transcript.audio.filename = original_filename
    save_transcript(interview_id, transcript)
    return AudioStatus(exists=True, filename=original_filename)


@app.get("/api/interviews/{interview_id}/audio", response_class=FileResponse)
def get_audio(interview_id: InterviewId) -> FileResponse:
    try:
        transcript = load_transcript(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error
    source = audio_path(interview_id)
    if not source.is_file():
        raise HTTPException(status_code=404, detail="Audio not found")
    media_type = mimetypes.guess_type(transcript.audio.filename)[0]
    return FileResponse(source, media_type=media_type, filename=transcript.audio.filename)


@app.post("/api/interviews/{interview_id}/transcribe", response_model=Transcript)
def post_transcription(
    interview_id: InterviewId,
    options: TranscriptionOptions,
    provider_id: Annotated[str | None, Query()] = None,
) -> Transcript:
    try:
        transcript = load_transcript(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error

    source = audio_path(interview_id)
    if not source.is_file():
        raise HTTPException(status_code=409, detail="请先上传音频")

    provider = get_provider(provider_id)
    reconcile_env_from_profiles()
    if not provider.is_configured():
        raise HTTPException(status_code=409, detail=f"请先设置 {provider.name} 的凭据")

    try:
        with provider_call(
            provider.id,
            "transcribe",
            f"{transcript.audio.filename} {human_bytes(source.stat().st_size)}",
        ):
            normalized = provider.transcribe(
                source,
                transcript.audio.filename,
                options,
                existing_speakers=transcript.speakers,
            )
    except ProviderError as error:
        raise provider_http_error(error) from error

    save_original_response(interview_id, normalized.model_dump())
    save_normalized_transcript(interview_id, normalized)
    save_transcript(interview_id, normalized)
    return normalized


@app.get("/api/transcribe/progress")
def get_transcribe_progress(job_id: Annotated[str | None, Query()] = None) -> dict:
    """只读的进度查询：转录请求还挂着的时候，前端按秒拉一次。

    查不到就返回 `{"active": false}`，前端据此保持原样 —— 不是每个引擎都有「先传到云端」
    这一步，没有进度可报是正常情况，不是错误。
    """
    return progress.REGISTRY.snapshot(progress.safe_job_id(job_id) or "")


@app.get("/api/transcribe/jobs/{job_id}")
def get_transcription_job(job_id: str):
    return transcription_jobs.get(job_id)


@app.delete("/api/transcribe/jobs/{job_id}")
def acknowledge_transcription_job(job_id: str):
    job = transcription_jobs.JOBS.get(job_id)
    if job and job.task.done():
        del transcription_jobs.JOBS[job_id]
    return {"ok": True}


@app.post("/api/transcribe", response_model=Transcript)
async def post_transcribe(
    file: Annotated[UploadFile, File()],
    options: Annotated[str, Form()],
    provider_id: Annotated[str | None, Form()] = None,
    job_id: Annotated[str | None, Form()] = None,
    background: Annotated[bool, Form()] = False,
):
    """Stateless transcription proxy.

    Accepts raw audio bytes + a JSON-serialized TranscriptionOptions string and
    forwards them to the selected provider (default: ElevenLabs). Nothing is
    persisted on the server; the caller saves the transcript next to the audio.
    """
    provider = get_provider(provider_id)
    reconcile_env_from_profiles()
    if not provider.is_configured():
        raise HTTPException(status_code=409, detail=f"请先设置 {provider.name} 的凭据")

    try:
        options_model = TranscriptionOptions.model_validate_json(options)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"转写选项无效: {error}") from error

    original_filename = FilePath(file.filename or "audio").name
    suffix = FilePath(original_filename).suffix or ".tmp"
    valid_job_id = progress.safe_job_id(job_id)
    if background:
        if not valid_job_id:
            raise HTTPException(422, detail="缺少有效的任务编号")
        transcription_jobs.ensure_capacity(valid_job_id)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="te-upload-", suffix=suffix, delete=False) as temporary:
            temp_path = FilePath(temporary.name)
            while chunk := await file.read(1024 * 1024):
                temporary.write(chunk)
    except BaseException:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise

    async def run():
        with progress.job_context(valid_job_id):
            try:
                with provider_call(provider.id, "transcribe", human_bytes(temp_path.stat().st_size)):
                    return await asyncio.to_thread(provider.transcribe, temp_path, original_filename, options_model)
            except ProviderError as error:
                raise provider_http_error(error) from error
            finally:
                progress.finish()
                temp_path.unlink(missing_ok=True)

    if background:
        try:
            transcription_jobs.submit(valid_job_id, run)
        except BaseException:
            temp_path.unlink(missing_ok=True)
            raise
        return JSONResponse({"job_id": valid_job_id}, status_code=202)
    return await run()
