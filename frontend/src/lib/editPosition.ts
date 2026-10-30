import type { Transcript } from "../types";

export const RESTORE_EDIT_POSITION_KEY = "te-restore-edit-position";

export function openingSegmentId(transcript: Transcript): string {
  // Selection and reading position are independent. Never infer a viewport from the editing cursor.
  return transcript.segments[0]?.id ?? "";
}
