import type { Segment, Transcript } from "../types";
import { comparisonRows } from "./comparisonSegments";
import { segmentTimestampWords, sliceTimestampWords } from "./timestampSlices";
import { revisionFor } from "./revisions";
import { reanchorCharacters, reanchorRanges } from "./transcriptOps";

export function comparisonParts(before: string, text: string) {
  let sourceOffset = 0, offset = 0;
  return revisionFor(before, {id:"", text, reason:""}).parts.map(part => {
    const result = {...part, key:JSON.stringify([sourceOffset, part.before, part.after]), sourceStart:sourceOffset, start:offset, end:offset+part.after.length};
    sourceOffset += part.before.length; offset += part.after.length;
    return result;
  });
}
export const comparisonReviewKey = (base: string, segmentId: string) => JSON.stringify([base, segmentId]);
export type ComparisonDecision = {base:string; segmentId:string; before:string; text:string; key:string; choice:"accept"|"reject"};

export function applyComparisonDecision(current: Transcript, decision: ComparisonDecision, baseline?: Segment[]): Transcript {
  const segment = current.segments.find(s => s.id === decision.segmentId);
  // A menu opened before typing or switching versions cannot act on a newer snapshot.
  if (!segment || segment.text !== decision.text) return current;
  const part = comparisonParts(decision.before, segment.text).find(p => p.changed && p.key === decision.key);
  if (!part) return current;
  const recordKey = comparisonReviewKey(decision.base, segment.id);
  if (decision.choice === "accept") {
    const record = current.comparisonReviews?.[recordKey];
    const accepted = record?.before === decision.before ? record.accepted : [];
    return {...current, comparisonReviews:{...current.comparisonReviews,
      [recordKey]:{segmentId:segment.id, before:decision.before, accepted:[...new Set([...accepted, part.key])]}}};
  }
  const source = baseline ? comparisonRows(current.segments,baseline).find(row=>!row.deleted && row.segment.id===segment.id) : undefined;
  // Never apply timestamps from a different/obsolete comparison snapshot.
  if (baseline && source?.before !== decision.before) return current;
  const currentWords = segmentTimestampWords(segment);
  // Matching text also regains its source anchor: inserted/replaced characters
  // may previously have shared (and compressed) a neighbour's word window.
  // Other pending or accepted edits retain their current timing.
  const sourceWords = source?.beforeWords;
  let words = sourceWords ? comparisonParts(decision.before,segment.text).flatMap(piece => {
    if ((!piece.changed && currentWords.some(word=>word.timing)) || (piece.changed && piece.key !== part.key)) return sliceTimestampWords(currentWords,piece.start,piece.end);
    const restored = sliceTimestampWords(sourceWords,piece.sourceStart,piece.sourceStart+piece.before.length);
    // Legacy baselines may lack word timing. Preserve any existing timing for
    // matching text; missing timing for restored text remains a zero-width anchor.
    if (!piece.changed && !restored.some(word=>word.end>word.start))
      return sliceTimestampWords(currentWords,piece.start,piece.end);
    return restored;
  }) : undefined;
  const text = segment.text.slice(0,part.start) + part.before + segment.text.slice(part.end);
  // A text-only diff cannot distinguish which identical occurrence was deleted.
  // If rejection completely restores a version from the same original sources,
  // restore that snapshot's coordinates as well (never borrow another model's
  // coordinates for the unchanged text).
  const roots=new Set(sourceWords?.flatMap(word=>(word.origins??[]).map(o=>JSON.stringify([o.model,o.segment]))));
  const currentOrigins=currentWords.flatMap(word=>word.origins??[]);
  if(text===decision.before && sourceWords && currentOrigins.length &&
    currentOrigins.every(o=>roots.has(JSON.stringify([o.model,o.segment]))))words=sourceWords;

  return {...current, lastEditedSegmentId:segment.id, segments:current.segments.flatMap(s => s.id !== segment.id ? [s] : text ? [{...s, text,
    words:words ?? reanchorCharacters(s.words, s.text, text),
    highlights:reanchorRanges(s.highlights ?? [], s.text, text),
  }] : [])};
}

/** Keep confirmations only while the corresponding change still exists. Undo restores the earlier record. */
export function reconcileComparisonReviews(transcript: Transcript): Transcript {
  if (!transcript.comparisonReviews) return transcript;
  const segments = new Map(transcript.segments.map(s => [s.id,s]));
  return {...transcript, comparisonReviews:Object.fromEntries(Object.entries(transcript.comparisonReviews).flatMap(([key,record]) => {
    const segment = segments.get(record.segmentId);
    if (!segment) return [];
    const changes = new Set(comparisonParts(record.before,segment.text).filter(p=>p.changed).map(p=>p.key));
    const accepted = record.accepted.filter(key=>changes.has(key));
    return accepted.length ? [[key,{...record,accepted}]] : [];
  }))};
}
