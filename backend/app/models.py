from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AudioInfo(BaseModel):
    filename: str
    duration: float = Field(ge=0)


class Speaker(BaseModel):
    id: str
    name: str


class Word(BaseModel):
    text: str
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    speaker_id: str | None = None


class Segment(BaseModel):
    id: str
    speaker_id: str
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str
    words: list[Word] | None = None

    @model_validator(mode="after")
    def end_must_follow_start(self) -> "Segment":
        if self.end < self.start:
            raise ValueError("segment end must be greater than or equal to start")
        return self


class Transcript(BaseModel):
    audio: AudioInfo
    speakers: list[Speaker]
    segments: list[Segment]

    @model_validator(mode="after")
    def references_must_be_valid(self) -> "Transcript":
        speaker_ids = [speaker.id for speaker in self.speakers]
        if len(speaker_ids) != len(set(speaker_ids)):
            raise ValueError("speaker ids must be unique")

        segment_ids = [segment.id for segment in self.segments]
        if len(segment_ids) != len(set(segment_ids)):
            raise ValueError("segment ids must be unique")

        unknown_ids = {segment.speaker_id for segment in self.segments} - set(speaker_ids)
        if unknown_ids:
            raise ValueError(f"segments reference unknown speakers: {sorted(unknown_ids)}")

        return self


class Participant(BaseModel):
    name: str = Field(min_length=1)
    role: str = Field(min_length=1)


class InterviewDraft(BaseModel):
    title: str = Field(min_length=1)
    recorded_at: str | None = None
    location: str = ""
    participants: list[Participant] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    notes: str = ""


class InterviewMetadata(InterviewDraft):
    id: str
    created_at: str
    updated_at: str


class CredentialUpsert(BaseModel):
    """新增/更新一套命名凭据档案时的请求体。name 可空（后端回退默认名）。"""

    name: str | None = None
    values: dict[str, str] = Field(default_factory=dict)


class AudioStatus(BaseModel):
    exists: bool
    filename: str | None = None


class TranscriptionOptions(BaseModel):
    language_code: str | None = "zho"
    num_speakers: int | None = Field(default=None, ge=1, le=32)
    diarize: bool = True
    tag_audio_events: bool = True
    timestamps_granularity: Literal["word", "character"] = "word"
