import {expect,it} from 'vitest';
import {buildJsonPayload,selectExportScope} from './export';
import {inspectTranscript} from './import';
import type {Transcript} from '../types';
import type {TagLibrary} from './tags';
const library:TagLibrary={schemaVersion:4,groups:[],tags:[{id:'parent',name:'合成父级',parentId:null,groupIds:[]},{id:'child',name:'合成子级 <&> 😀',parentId:'parent',groupIds:[]},{id:'unrelated',name:'Unrelated private label',parentId:null,groupIds:[]}],treeOrder:['unrelated','parent','child']};
const source:Transcript={audio:{filename:'synthetic.wav',duration:2},speakers:[{id:'speaker',name:'Synthetic'}],segments:[{id:'s1',speaker_id:'speaker',start:0,end:1,text:'甲😀e\u0301乙',tagIds:['child'],highlights:[{id:'h1',start:1,end:3},{id:'h2',start:3,end:5}],annotations:[{id:'a1',text:'Synthetic note <&> 😀',createdAt:'2026-01-01'}]},{id:'s2',speaker_id:'other',start:1,end:2,text:'Outside export scope',tagIds:['unrelated']}],aiContinuationReceipts:{},tagCollection:{schemaVersion:1,tagIds:['child','unrelated'],groups:[]}};
it.each(Array.from({length:8},(_,mask)=>mask))('exports JSON option combination %i without unrelated definitions or mutation',mask=>{
 const options={tags:!!(mask&1),highlights:!!(mask&2),annotations:!!(mask&4)},before=JSON.stringify(source);
 const selected=selectExportScope(source,'visible',new Set(['other']),null);
 const payload=buildJsonPayload(selected,'synthetic',options,library),rows=payload.segments as Transcript['segments'];
 expect(rows).toHaveLength(1);expect(rows[0].text).toBe(source.segments[0].text);expect(rows[0].tagIds).toEqual(options.tags?['child']:undefined);expect(rows[0].highlights).toEqual(options.highlights?source.segments[0].highlights:undefined);expect(rows[0].annotations).toEqual(options.annotations?source.segments[0].annotations:undefined);
 const meta=payload.rippleExport as {schemaVersion:number;highlightOffsetUnit:string;tagDefinitions?:unknown[]};
 expect(meta.schemaVersion).toBe(1);expect(meta.highlightOffsetUnit).toBe('utf16-code-units');
 expect(meta.tagDefinitions).toEqual(options.tags?[{id:'child',name:'合成子级 <&> 😀',parentId:'parent'},{id:'parent',name:'合成父级',parentId:null}]:undefined);
 expect(JSON.stringify(payload)).not.toContain('Unrelated private label');expect(JSON.stringify(payload)).not.toContain('Outside export scope');expect(payload).not.toHaveProperty('tagCollection');expect(payload).not.toHaveProperty('aiContinuationReceipts');
 if(options.highlights)expect(rows[0].text.slice(rows[0].highlights![0].start,rows[0].highlights![0].end)).toBe('😀');
 expect(JSON.stringify(source)).toBe(before);
});
it('defaults all JSON options on for both original and edited transcript content',()=>{
 for(const text of ['Synthetic original','Synthetic edited']){
 const t={...source,segments:[{...source.segments[0],text,highlights:[{id:'h',start:0,end:9}]}]};
 const row=(buildJsonPayload(t,undefined,undefined,library).segments as Transcript['segments'])[0];expect(row.tagIds).toEqual(['child']);expect(row.highlights).toHaveLength(1);expect(row.annotations).toHaveLength(1);
 }
});
it('exports empty markings without inventing associations or parent use',()=>{
 const payload=buildJsonPayload({...source,segments:[{id:'s',speaker_id:'speaker',start:0,end:1,text:'Synthetic plain text'}]},undefined);
 expect((payload.rippleExport as {tagDefinitions:unknown[]}).tagDefinitions).toEqual([]);expect((payload.segments as Transcript['segments'])[0]).not.toHaveProperty('tagIds');
});
it('refuses unresolved tag references and invalid highlight ranges instead of silently losing them',()=>{
 expect(()=>buildJsonPayload(source,undefined)).toThrow();expect(()=>buildJsonPayload({...source,segments:[{...source.segments[0],highlights:[{id:'bad',start:0,end:99}]}]},undefined,undefined,library)).toThrow();
 expect(()=>buildJsonPayload(source,undefined,{tags:false,highlights:false,annotations:false})).not.toThrow();
});
it('keeps current import compatibility explicit: annotations return but tag and highlight restoration is not implemented',()=>{
 const result=inspectTranscript(buildJsonPayload(source,undefined,undefined,library));expect(result.ok).toBe(true);
 if(result.ok){expect(result.transcript.segments[0].annotations).toEqual(source.segments[0].annotations);expect(result.transcript.segments[0].highlights).toBeUndefined();expect(result.transcript.segments[0].tagIds).toBeUndefined();}
});
