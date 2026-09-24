import type { Segment, Word } from "../types";
import { mapCharsByDiff } from "./transcriptOps";
import { joinedTimestampWords, segmentTimestampWords, sliceTimestampWords } from "./timestampSlices";
import { joinParagraphs } from "./segmentOps";
/** Place deleted source segments before their next surviving neighbour, without sorting the current manuscript. */
export function comparisonRows(current:Segment[],baseline:Segment[]|undefined) {
  const before=new Map((baseline??[]).map(s=>[s.id,s]));
  const currentIds=new Set(current.map(s=>s.id));
  const currentById=new Map(current.map(s=>[s.id,s]));
  const consumed=new Set<string>();
  const mergedBefore=new Map<string,string>();
  const sourceWords=new Map<string,Word[]>((baseline??[]).map(s=>[s.id,segmentTimestampWords(s)]));
  // Prefer recorded operations. Time ranges alone cannot distinguish a merge
  // from deletion, overlap, or equal-end timestamps in imported transcripts.
  for (const target of current) {
    if (!target.mergedFrom?.length) continue;
    const ids = new Set(target.mergedFrom);
    const group = (baseline ?? []).filter(s => ids.has(s.id) &&
      (!s.mergedFrom || s.mergedFrom.every(id => ids.has(id))));
    if (!group.length || group.some(s => s.id !== target.id && currentIds.has(s.id))) continue;
    mergedBefore.set(target.id, group.map(s => s.text).reduce(joinParagraphs));
    sourceWords.set(target.id,joinedTimestampWords(group));
    group.filter(s => s.id !== target.id).forEach(s => consumed.add(s.id));
  }
  // A merge retains its first ID and extends its audio range. Compare against
  // all source paragraphs in that range, including text deleted during editing.
  // Require a complete range ending at a source boundary; never borrow text
  // from another surviving row or guess from overlapping timestamps alone.
  for(let i=0;i<(baseline?.length??0);i++) {
    const source=baseline![i];
    const target=currentById.get(source.id);
    if(!target || target.mergedFrom?.length || target.start!==source.start || target.end<=source.end) continue;
    const group=[source];
    for(let j=i+1;j<baseline!.length;j++) {
      const candidate=baseline![j];
      if(currentIds.has(candidate.id) || consumed.has(candidate.id) ||
        candidate.start<source.start || candidate.end>target.end) break;
      group.push(candidate);
      if(candidate.end===target.end) break;
    }
    if(group.length<2 || group.at(-1)!.end!==target.end) continue;
    mergedBefore.set(target.id,group.map(s=>s.text).reduce(joinParagraphs));
    sourceWords.set(target.id,joinedTimestampWords(group));
    group.slice(1).forEach(s=>consumed.add(s.id));
  }
  // A complete split keeps the first ID and partitions its original time window.
  // Align text across the pieces before dividing the baseline, so an unchanged
  // second half is not presented as newly inserted text.
  for (let i = 0; i < current.length; i++) {
    const first = current[i], source = before.get(first.id);
    const recordedSplit = source && source.start === source.end && first.splitFrom === source.id;
    if (!source || first.start !== source.start || (!recordedSplit && first.end >= source.end) || first.mergedFrom?.length) continue;
    const group = [first];
    for (let j = i + 1; j < current.length; j++) {
      const next = current[j];
      if (before.has(next.id) || (recordedSplit ? next.splitFrom !== source.id : next.start !== group.at(-1)!.end || next.end > source.end)) break;
      group.push(next);
      if (!recordedSplit && next.end === source.end) break;
    }
    if (group.length < 2 || group.at(-1)!.end !== source.end) continue;
    const mapping = mapCharsByDiff(source.text, group.map(s => s.text).join(""));
    let offset = 0, boundary = 0;
    group.forEach((segment, index) => {
      offset += segment.text.length;
      const nextMatch = mapping.slice(offset).find(pos => pos >= boundary);
      const end = index === group.length - 1 ? source.text.length : nextMatch ?? boundary;
      mergedBefore.set(segment.id, source.text.slice(boundary, end));
      sourceWords.set(segment.id,sliceTimestampWords(segmentTimestampWords(source),boundary,end));
      boundary = end;
    });
    i += group.length - 1;
  }
  const ghosts=new Map<string,Segment[]>();let next="";
  for(let i=(baseline?.length??0)-1;i>=0;i--){const segment=baseline![i];
    if(currentIds.has(segment.id))next=segment.id;
    else if(!consumed.has(segment.id)) ghosts.set(next,[segment,...(ghosts.get(next)??[])]);
  }
  const rows=current.flatMap(segment=>[
    ...(ghosts.get(segment.id)??[]).map(segment=>({segment,deleted:true,before:segment.text,beforeWords:sourceWords.get(segment.id)})),
    {segment,deleted:false,beforeWords:sourceWords.get(segment.id),before:baseline?mergedBefore.get(segment.id)??before.get(segment.id)?.text??"":undefined},
  ]);
  return [...rows,...(ghosts.get("")??[]).map(segment=>({segment,deleted:true,before:segment.text,beforeWords:sourceWords.get(segment.id)}))];
}
