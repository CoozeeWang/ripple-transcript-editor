import type { Transcript, Word } from "../types";
import { revisionFor } from "./revisions";
import { comparisonRows } from "./comparisonSegments";
import { alignTimestampWords, reanchorCharacters } from "./transcriptOps";

/** Decorate an in-memory original; the immutable original file is never rewritten. */
export function seedOriginalOrigins(original:Transcript,model:string):Transcript {
  return {...original,segments:original.segments.map(segment=>{
    let offset=0;
    const aligned=segment.words?.length?alignTimestampWords(segment.words,segment.text):
      [{text:segment.text,start:segment.start,end:segment.start}];
    const words:Word[]=aligned.flatMap(word=>Array.from({length:word.text.length},(_,i)=>{
      const from=offset++,start=word.start+(word.end-word.start)*i/word.text.length,
        end=word.start+(word.end-word.start)*(i+1)/word.text.length;
      return {...word,speaker_id:word.speaker_id??segment.speaker_id,text:word.text[i],start,end,timing:end>start?"source" as const:"unresolved" as const,
        origins:[{model,segment:segment.id,from,to:from+1,start,end}]};
    }));
    return {...segment,words};
  })};
}

/** Backfill only files that predate origin tracking. Ambiguous repeated text
 * retains its current approximate timing rather than inventing an occurrence. */
export function restoreTranscriptOrigins(transcript:Transcript,original:Transcript,model:string):Transcript {
  const source=seedOriginalOrigins(original,model);
  const rows=comparisonRows(transcript.segments,source.segments);
  return {...transcript,segments:transcript.segments.map(segment=>{
    if(segment.words?.length && segment.words.every(word=>word.timing))return segment;
    const row=rows.find(row=>!row.deleted && row.segment.id===segment.id);
    const before=row?.before??"";
    const repeated=revisionFor(before,{id:segment.id,text:segment.text,reason:""}).parts.some(part=>!part.changed && part.after.length>0 && before.indexOf(part.after)!==before.lastIndexOf(part.after));
    const same=before===segment.text;
    if(!row?.beforeWords || (!same && repeated))return {...segment,words:(segment.words?.length?
      alignTimestampWords(segment.words,segment.text):[{text:segment.text,start:segment.start,end:segment.start}])
      .map(word=>({...word,timing:"unresolved" as const,origins:[]}))};
    const words=reanchorCharacters(row.beforeWords,before,segment.text);
    // Legacy text-only matching cannot certify edited portions as exact.
    return {...segment,words:words?.map(word=>({...word,speaker_id:segment.speaker_id,...(word.timing==="replacement"?{timing:"approximate" as const}: {})}))};
  })};
}
