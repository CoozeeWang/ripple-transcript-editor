"""Compatibility API for pre-project interviews; current .ripple files use frontend storage.

Keep existing URLs and response contracts isolated from the stateless transcription API.
"""
import mimetypes
from pathlib import Path as FilePath
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Path, Query, UploadFile
from fastapi.responses import FileResponse

from .models import AudioStatus, InterviewDraft, InterviewMetadata, Transcript, TranscriptionOptions
from .provider_errors import provider_http_error
from .providers.base import ProviderError
from .providers.diagnostics import human_bytes, provider_call
from .providers.registry import get_provider
from .settings import reconcile_env_from_profiles
from .storage import (
    audio_path, create_interview, list_interviews, load_metadata, load_transcript,
    save_normalized_transcript, save_original_response, save_transcript, update_metadata,
)

router = APIRouter(tags=["legacy-interviews"])
InterviewId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]+$")]


@router.get("/api/interviews", response_model=list[InterviewMetadata])
def get_interviews() -> list[InterviewMetadata]:
    return list_interviews()


@router.post("/api/interviews", response_model=InterviewMetadata, status_code=201)
def post_interview(draft: InterviewDraft) -> InterviewMetadata:
    return create_interview(draft)


@router.get("/api/interviews/{interview_id}/metadata", response_model=InterviewMetadata)
def get_metadata(interview_id: InterviewId) -> InterviewMetadata:
    try:
        return load_metadata(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error


@router.put("/api/interviews/{interview_id}/metadata", response_model=InterviewMetadata)
def put_metadata(interview_id: InterviewId, draft: InterviewDraft) -> InterviewMetadata:
    try:
        return update_metadata(interview_id, draft)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error


@router.get("/api/interviews/{interview_id}/transcript", response_model=Transcript)
def get_transcript(interview_id: InterviewId) -> Transcript:
    try:
        return load_transcript(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error


@router.put("/api/interviews/{interview_id}/transcript")
def put_transcript(interview_id: InterviewId, transcript: Transcript) -> dict[str, str]:
    try:
        load_metadata(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error
    save_transcript(interview_id, transcript)
    return {"status": "saved"}


@router.get("/api/interviews/{interview_id}/audio-info", response_model=AudioStatus)
def get_audio_info(interview_id: InterviewId) -> AudioStatus:
    try:
        transcript = load_transcript(interview_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Interview not found") from error
    exists = audio_path(interview_id).is_file()
    return AudioStatus(exists=exists, filename=transcript.audio.filename if exists else None)


@router.post("/api/interviews/{interview_id}/audio", response_model=AudioStatus)
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


@router.get("/api/interviews/{interview_id}/audio", response_class=FileResponse)
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


@router.post("/api/interviews/{interview_id}/transcribe", response_model=Transcript)
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


