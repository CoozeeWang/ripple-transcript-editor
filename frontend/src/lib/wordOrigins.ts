import type { Word, WordOrigin } from "../types";

/** Original coordinates are immutable, even when current text is replaced. */
function originsOf(words: Word[]): WordOrigin[] {
  const unique = new Map<string,WordOrigin>();
  const seen=new Set<WordOrigin[]>();
  for (const word of words) {
    if(!word.origins || seen.has(word.origins))continue;
    seen.add(word.origins);
    for(const origin of word.origins)unique.set(JSON.stringify(origin),origin);
  }
  const ranges=[...unique.values()].sort((a,b)=>a.model.localeCompare(b.model)||a.segment.localeCompare(b.segment)||a.from-b.from);
  const result:WordOrigin[]=[];
  for(const origin of ranges){
    const last=result.at(-1);
    if(last && last.model===origin.model && last.segment===origin.segment && origin.from<=last.to)
      result[result.length-1]={...last,to:Math.max(last.to,origin.to),start:Math.min(last.start,origin.start),end:Math.max(last.end,origin.end)};
    else result.push(origin);
  }
  return result;
}

/** Re-anchor a sourced edit using an ordered character mapping. Insertions get
 * their own zero-width anchor and never consume an unchanged word's window. */
export function editSourcedWords(words: Word[], oldText: string, text: string, mapping: number[]): Word[] {
  const chars = words.flatMap(word=>Array.from({length:word.text.length},(_,i)=>({...word,
    text:word.text[i],start:word.start+(word.end-word.start)*i/word.text.length,
    end:word.start+(word.end-word.start)*(i+1)/word.text.length})));
  const used=new Set(mapping.filter(index=>index>=0));
  const result:Word[]=[];
  let oldOffset=0,newOffset=0;
  const addChange=(oldEnd:number,newEnd:number)=>{
    const added=text.slice(newOffset,newEnd);
    if(!added) return;
    const movedStart=oldText.indexOf(added);
    if(movedStart>=0 && oldText.lastIndexOf(added)===movedStart &&
      Array.from({length:added.length},(_,i)=>movedStart+i).every(index=>!used.has(index))){
      result.push(...chars.slice(movedStart,movedStart+added.length));
      for(let i=0;i<added.length;i++)used.add(movedStart+i);
      return;
    }
    const removed=chars.slice(oldOffset,oldEnd);
    const neighbour=chars[oldOffset-1]??chars[oldEnd];
    const origins=originsOf(removed.length?removed:neighbour?[neighbour]:[]);
    const timed=removed.filter(word=>word.origins?.length && (word.timing==="source" || word.timing==="replacement"));
    const replacement=removed.length>0 && timed.length>0;
    // Recover from immutable source ranges, not a progressively resized copy.
    const sourceTimes=replacement?origins:[];
    const start=sourceTimes.length?sourceTimes.reduce((min,o)=>Math.min(min,o.start),Infinity):removed[0]?.start??chars[oldOffset-1]?.end??chars[oldEnd]?.start??0;
    const end=sourceTimes.length?sourceTimes.reduce((max,o)=>Math.max(max,o.end),-Infinity):start;
    result.push({text:added,start,end,origins,timing:replacement?"replacement":origins.length?"approximate":"unresolved",
      ...(removed[0]?.speaker_id||neighbour?.speaker_id?{speaker_id:removed[0]?.speaker_id??neighbour?.speaker_id}: {})});
  };
  for(let i=0;i<text.length;i++) {
    const old=mapping[i];
    if(old<oldOffset)continue;
    addChange(old,i);
    if(chars[old])result.push(chars[old]);
    oldOffset=old+1;newOffset=i+1;
  }
  addChange(oldText.length,text.length);
  return result;
}
