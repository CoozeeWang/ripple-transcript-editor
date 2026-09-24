import type { Transcript } from "../types";
import { loadBooleanPreference } from "./preferences";

export const RESTORE_EDIT_POSITION_KEY = "te-restore-edit-position";

export function openingSegmentId(transcript: Transcript): string {
  if (loadBooleanPreference(RESTORE_EDIT_POSITION_KEY, false) &&
      transcript.segments.some(segment => segment.id === transcript.lastEditedSegmentId)) {
    return transcript.lastEditedSegmentId!;
  }
  return transcript.segments[0]?.id ?? "";
}
