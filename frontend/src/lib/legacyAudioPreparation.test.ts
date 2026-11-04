// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {transcribeAudio} from '../localStore';
import {readLegacyPreparation} from './legacyAudioPreparation';
import type {TranscriptionOptions} from '../types';
const ids=vi.hoisted(()=>({source:`5:${'a'.repeat(64)}`,work:`4:${'b'.repeat(64)}`}));
vi.mock('./audioIdentity',()=>({audioIdentity:async(file:File)=>file.name==='sample.wav'?ids.source:ids.work}));
const options={} as TranscriptionOptions;
const pending={schema:1,source:'sample.wav',format:'m4a',purpose:'replace',file:'.ripple-work-1234.m4a',provider:'test',sourceIdentity:ids.source,identity:ids.work,state:'ready',configuration:{options,profileId:'profile'}};
function fixture(record:unknown=pending,marker=true){
 const values=new Map<string,unknown>();
 if(record!==null)values.set('.sample.wav.audio-preparation.json',record);
 if(marker)values.set('.sample.wav.ripple-job.json',{jobId:'old-job',signature:JSON.stringify(['strict-audio',pending.sourceIdentity,pending.identity,'profile','test',options])});
 const dir={getDirectoryHandle:async()=>{throw new DOMException('Synthetic absent','NotFoundError')},getFileHandle:vi.fn(async(name:string)=>{if(name==='sample.wav'||name===pending.file)return {getFile:async()=>({name})};if(!values.has(name))throw new DOMException('Synthetic absent','NotFoundError');return {getFile:async()=>({text:async()=>JSON.stringify(values.get(name))})}}),removeEntry:vi.fn()} as unknown as FileSystemDirectoryHandle;
 return {dir,values};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});
it('reads legacy records without creating, cleaning or replacing any files',async()=>{
 const {dir,values}=fixture();const before=JSON.stringify([...values]);expect(await readLegacyPreparation(dir,'sample.wav')).toEqual(pending);expect(JSON.stringify([...values])).toBe(before);expect(dir.removeEntry).not.toHaveBeenCalled();expect(vi.mocked(dir.getFileHandle).mock.calls.every(args=>args.length===1)).toBe(true);
});
it('recovers the exact submitted job using GET only and retains all old records',async()=>{
 const {dir,values}=fixture();const before=JSON.stringify([...values]);const transcript={segments:[{text:'Synthetic result'}]};
 const fetch=vi.fn<(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>>(async()=>new Response(JSON.stringify({state:'completed',transcript})));vi.stubGlobal('fetch',fetch);
 expect(await transcribeAudio(dir,'sample.wav',options,{providerId:'test',legacyPreparation:pending as never})).toEqual(transcript);
 expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][0]).toBe('/api/transcribe/jobs/old-job');expect(JSON.stringify([...values])).toBe(before);expect(dir.removeEntry).not.toHaveBeenCalled();
});
it.each(['preparing','saved','missing-marker','changed-source','changed-provider','expired','failed','invalid-record','orphan-marker'])('never resubmits or deletes uncertain legacy work (%s)',async mode=>{
 let record:unknown={...pending};if(mode==='preparing'||mode==='saved')record={...pending,state:mode};if(mode==='changed-source')record={...pending,sourceIdentity:`5:${'c'.repeat(64)}`};if(mode==='invalid-record')record={...pending,file:'../unsafe.m4a'};if(mode==='orphan-marker')record=null;
 const {dir,values}=fixture(record,mode!=='missing-marker');const before=JSON.stringify([...values]);
 const fetch=vi.fn<(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>>(async()=>new Response(JSON.stringify(mode==='failed'?{state:'failed',status:422,detail:'Synthetic failure'}:{}),{status:mode==='expired'?404:200}));vi.stubGlobal('fetch',fetch);const confirm=vi.spyOn(window,'confirm');
 await expect(transcribeAudio(dir,'sample.wav',options,{providerId:mode==='changed-provider'?'other':'test'})).rejects.toThrow();
 expect(fetch.mock.calls.every(([,init])=>!init||!(init as RequestInit).method||(init as RequestInit).method==='GET')).toBe(true);expect(confirm).not.toHaveBeenCalled();expect(dir.removeEntry).not.toHaveBeenCalled();expect(JSON.stringify([...values])).toBe(before);
});
