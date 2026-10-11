import type { Segment, Transcript } from "../types";
import type { AISuggestion } from "./aiVersionEdits";
import { mapCharsByDiff } from "./transcriptOps";

export type Choice = "pending" | "accept" | "reject";
export interface RevisionPart { before: string; after: string; changed: boolean; choice: Choice }
export interface RevisionState { parts: RevisionPart[]; operation: Choice; reviewed: boolean }
export function revisionFor(before: string, suggestion: AISuggestion): RevisionState {
  const after = suggestion.action === "delete" ? "" : suggestion.text;
  const mapping = mapCharsByDiff(before, after);
  const parts: RevisionPart[] = [];
  let a = 0, b = 0;
  const add = (old: string, next: string, changed: boolean) => {
    if (!old && !next) return;
    const last = parts.at(-1);
    if(last && last.changed === changed) {last.before += old;last.after += next;}
    else parts.push({before:old,after:next,changed,choice:changed?"pending":"accept"});
  };
  for(let j=0;j<after.length;j++) {
    const i=mapping[j];
    if(i<0 || i<a) continue;
    add(before.slice(a,i),after.slice(b,j),true);
    add(before[i],after[j],false); a=i+1;b=j+1;
  }
  add(before.slice(a),after.slice(b),true);
  return {parts,operation:suggestion.action && suggestion.action!=="edit" ? "pending":"accept",reviewed:false};
}
export function revisionText(state: RevisionState): string {
  return state.parts.map(p=>p.choice === "reject" ? p.before : p.after).join("");
}
export function revisionDone(state: RevisionState): boolean {
  return state.reviewed && state.operation!=="pending" && state.parts.every(p=>p.choice!=="pending");
}
export function decideRevision(state: RevisionState, choice: "accept"|"reject"): RevisionState {
  return {...state, reviewed:true, operation:choice, parts:state.parts.map(p=>({...p,choice:p.changed?choice:p.choice}))};
}
export function resolvedSuggestion(_original: Segment, suggestion: AISuggestion, state: RevisionState): AISuggestion {
  const action = suggestion.action && suggestion.action!=="edit" && state.operation === "accept" ? suggestion.action : "edit";
  const text = revisionText(state);
  return {...suggestion,action:!text.trim()?"delete":action,text:action === "delete"?"":text};
}

/** A reviewed segment is tied to its text and source timing, never just its id. */
export function reviewRevision(segment: Segment): string {
  return JSON.stringify([segment.text, segment.start, segment.end, segment.speaker_id]);
}

export function isReviewed(segment: Segment, reviews: Record<string, string>): boolean {
  return reviews[segment.id] === reviewRevision(segment);
}

export function markReviewed(transcript: Transcript, segments: Segment[], reviewed: boolean): Record<string, string> {
  const next = Object.fromEntries(transcript.segments.filter(segment => isReviewed(segment, transcript.reviewedSegments ?? {}))
    .map(segment => [segment.id, reviewRevision(segment)]));
  for (const segment of segments) {
    if (reviewed) next[segment.id] = reviewRevision(segment);
    else delete next[segment.id];
  }
  return next;
}

/** Repair oversized legacy diff runs without changing text or review decisions. */
export function refineRevisionParts(state: RevisionState): RevisionState {
  let changed = false;
  const parts = state.parts.flatMap(part => {
    if (!part.changed || part.before.length * part.after.length <= 250000) return [part];
    const refined = revisionFor(part.before, { id: "", text: part.after, reason: "" }).parts;
    if (!refined.some(p => !p.changed)) return [part];
    changed = true;
    return refined.map(p => ({ ...p, choice: p.changed ? part.choice : "accept" as Choice }));
  });
  return changed ? { ...state, parts } : state;
}
