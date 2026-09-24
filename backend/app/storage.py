import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from .models import AudioInfo, InterviewDraft, InterviewMetadata, Speaker, Transcript
from .runtime_paths import CODE_ROOT, DATA_ROOT

PROJECT_ROOT = CODE_ROOT
MOCK_TRANSCRIPT_PATH = PROJECT_ROOT / "mock-data" / "sample-transcript.json"
MOCK_METADATA_PATH = PROJECT_ROOT / "mock-data" / "sample-metadata.json"
INTERVIEWS_DIR = DATA_ROOT / "interviews"
AUDIO_STORAGE_NAME = "audio_source"


def transcript_path(interview_id: str) -> Path:
    return INTERVIEWS_DIR / interview_id / "transcript.json"


def metadata_path(interview_id: str) -> Path:
    return INTERVIEWS_DIR / interview_id / "metadata.json"


def audio_path(interview_id: str) -> Path:
    return INTERVIEWS_DIR / interview_id / AUDIO_STORAGE_NAME


def original_response_path(interview_id: str) -> Path:
    return INTERVIEWS_DIR / interview_id / "original_api_response.json"


def normalized_transcript_path(interview_id: str) -> Path:
    return INTERVIEWS_DIR / interview_id / "normalized_transcript.json"


def load_transcript(interview_id: str) -> Transcript:
    saved_path = transcript_path(interview_id)
    if saved_path.exists():
        source_path = saved_path
    elif interview_id == "demo":
        source_path = MOCK_TRANSCRIPT_PATH
    else:
        raise FileNotFoundError(interview_id)
    return Transcript.model_validate_json(source_path.read_text(encoding="utf-8"))


def save_transcript(interview_id: str, transcript: Transcript) -> Path:
    destination = transcript_path(interview_id)
    destination.parent.mkdir(parents=True, exist_ok=True)

    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(transcript.model_dump(exclude_none=True), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(destination)
    return destination


def save_original_response(interview_id: str, response: dict) -> Path:
    destination = original_response_path(interview_id)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(response, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(destination)
    return destination


def save_normalized_transcript(interview_id: str, transcript: Transcript) -> Path:
    destination = normalized_transcript_path(interview_id)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(transcript.model_dump(exclude_none=True), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(destination)
    return destination


def load_metadata(interview_id: str) -> InterviewMetadata:
    saved_path = metadata_path(interview_id)
    if saved_path.exists():
        source_path = saved_path
    elif interview_id == "demo":
        source_path = MOCK_METADATA_PATH
    else:
        raise FileNotFoundError(interview_id)
    return InterviewMetadata.model_validate_json(source_path.read_text(encoding="utf-8"))


def save_metadata(metadata: InterviewMetadata) -> Path:
    destination = metadata_path(metadata.id)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(metadata.model_dump(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(destination)
    return destination


def list_interviews() -> list[InterviewMetadata]:
    interviews = [load_metadata("demo")]
    if INTERVIEWS_DIR.exists():
        for path in INTERVIEWS_DIR.glob("*/metadata.json"):
            if path.parent.name == "demo":
                interviews[0] = InterviewMetadata.model_validate_json(
                    path.read_text(encoding="utf-8")
                )
                continue
            interviews.append(
                InterviewMetadata.model_validate_json(path.read_text(encoding="utf-8"))
            )
    return sorted(interviews, key=lambda item: item.updated_at, reverse=True)


def create_interview(draft: InterviewDraft) -> InterviewMetadata:
    now = datetime.now(UTC).isoformat()
    interview_id = f"interview_{datetime.now(UTC).strftime('%Y%m%d')}_{uuid4().hex[:8]}"
    metadata = InterviewMetadata(
        id=interview_id, created_at=now, updated_at=now, **draft.model_dump()
    )
    speakers = [
        Speaker(id=f"speaker_{index}", name=participant.name)
        for index, participant in enumerate(draft.participants)
    ]
    transcript = Transcript(
        audio=AudioInfo(filename="请选择本地音频", duration=0), speakers=speakers, segments=[]
    )
    save_metadata(metadata)
    save_transcript(interview_id, transcript)
    return metadata


def update_metadata(interview_id: str, draft: InterviewDraft) -> InterviewMetadata:
    current = load_metadata(interview_id)
    updated = InterviewMetadata(
        id=current.id,
        created_at=current.created_at,
        updated_at=datetime.now(UTC).isoformat(),
        **draft.model_dump(),
    )
    save_metadata(updated)
    return updated
