import {expect,it} from 'vitest';
import {tagTestFs} from './tagTestFs';
import {migrateProjectTagStorage} from './tagMigration';
import {openProject,recordingDirectory,type RippleProject} from './projectStore';
import {readModelEdit,saveActiveEdit,defaultMetadata,createEdit} from '../localStore';
import {transactProjectTags,restoreProjectTagTransaction,readProjectTagCounts} from './projectTagRepository';
import {setSegmentTag} from './tags';
import {applyTagBatch,tagBatchScope} from './tagBatch';
import {changeSharedTag} from './tagCollections';
import {parseTagSidecar,sidecarName,TAG_STORAGE_MARKER} from './tagSidecar';
import type {Transcript} from '../types';

function fixture(fail?:(path:string)=>void){
 const fs=tagTestFs('synthetic.ripple',fail),backup=tagTestFs('backup.ripple'),folder='interviews/session/sample.transcript';
 for(const p of ['interviews','interviews/session',folder])fs.directories.add(p);
 const data:RippleProject={kind:'ripple-project',schemaVersion:1,id:'project',title:'Synthetic only',description:'',revision:0,
  tagLibrary:{schemaVersion:3,tags:[{id:'root',name:'主题',parentId:null,groupIds:[]},{id:'leaf',name:'童年',parentId:'root',groupIds:[]}],groups:[]},
  interviews:[{id:'session',title:'Synthetic',recordings:[{id:'recording',name:'Synthetic',file:'sample.wav',storage:'none',fingerprint:''}]}]};
 const transcript:Transcript={audio:{filename:'sample.wav',duration:2},speakers:[],
  tagCollection:{schemaVersion:1,tagIds:['root','leaf'],groups:[{id:'group',name:'Group',tagIds:['leaf']}]},
  segments:[{id:'s1',text:'合成正文',speaker_id:'s',start:0,end:1,tagIds:['leaf'],words:[{text:'合成正文',start:0,end:1}]},{id:'s2',text:'合成正文二',speaker_id:'s',start:1,end:2}]};
 fs.files.set('ripple-project.json',JSON.stringify(data));
 fs.files.set(folder+'/manifest.json',JSON.stringify({schemaVersion:2,audio:'sample.wav',activeModelId:'m1',models:[{id:'m1',engine:'imported',original:'original.json',activeEditId:'e1',edits:[{id:'e1',file:'e1.json',updated_at:'2026-01-01'},{id:'e2',file:'e2.json',updated_at:'2026-01-01'}]}]}));
 for(const file of ['e1.json','e2.json','original.json','recoverable-orphan.json'])fs.files.set(folder+'/'+file,JSON.stringify({kind:'te-edited',audio:'sample.wav',metadata:defaultMetadata('Synthetic'),transcript}));
 return{...fs,backup,folder,project:{directory:fs.root,data},transcript};
}
async function migrated(){const f=fixture(),project=await migrateProjectTagStorage(f.project,f.backup.root),directory=await recordingDirectory(project,'session',project.data.interviews[0].recordings[0]);
 const document=(await readModelEdit(directory,'sample.wav','m1','e1'))!;
 return{...f,project,directory,document,current:{recordingId:'recording',modelId:'m1',editId:'e1',transcript:document.transcript}}}
it('explicitly backs up every file and migrates metadata without changing any manuscript bytes; repeated migration is a no-op',async()=>{
 const f=fixture(),before=new Map(f.files),project=await migrateProjectTagStorage(f.project,f.backup.root);
 expect(project.data.schemaVersion).toBe(2);expect((await openProject(f.root)).data.schemaVersion).toBe(2);
 for(const [path,raw]of before){expect(f.backup.files.get(path)).toBe(raw);if(path!=='ripple-project.json')expect(f.files.get(path)).toBe(raw)}
 const sidecar=parseTagSidecar(f.files.get(f.folder+'/'+await sidecarName('e1.json'))!);
 expect(parseTagSidecar(f.files.get(f.folder+'/'+await sidecarName('recoverable-orphan.json'))!).segments[0][1]).toEqual(['leaf']);
 expect(sidecar.collection.groups[0].tagIds).toEqual(['leaf']);expect(sidecar.segments).toEqual([['s1',['leaf']],['s2',undefined]]);
 expect(await migrateProjectTagStorage(project,f.backup.root)).toEqual(project);
});
it('attaches/unlinks and undoes/redoes using metadata only, with every body read forbidden',async()=>{
 const f=await migrated(),before=new Map(f.files),get=f.files.get.bind(f.files),bodies=['e1.json','e2.json','original.json'].map(n=>f.folder+'/'+n);
 // Metadata stat is allowed, getFile().text / body file-map reads are forbidden.
 f.files.get=path=>{if(bodies.includes(path))throw Error('body read forbidden');return get(path)};
 const result=await transactProjectTags(f.project,f.current,(library,consumers,id)=>({library,consumers:consumers.map(c=>c.id===id?{...c,transcript:setSegmentTag(c.transcript,'s2','leaf',true)}:c)}),'current');
 expect(result.transcript.segments[1].tagIds).toEqual(['leaf']);
 for(const body of bodies)expect(get(body)).toBe(before.get(body));
 const undone=await restoreProjectTagTransaction(result.project,result.receipt,false),redone=await restoreProjectTagTransaction(undone,result.receipt,true);
 expect(redone.data.revision).toBe(result.project.data.revision+2);
 const meta=parseTagSidecar(get(f.folder+'/'+await sidecarName('e1.json'))!);expect(meta.segments[1][1]).toEqual(['leaf']);
 for(const body of bodies)expect(get(body)).toBe(before.get(body));
});
it('shared rename checks metadata and keeps all versions and word arrays byte-identical',async()=>{
 const f=await migrated(),before=new Map(f.files);
 const result=await transactProjectTags(f.project,f.current,(library,consumers)=>changeSharedTag(library,'leaf','主题/求学',consumers));
 expect(result.project.data.tagLibrary!.tags.find(t=>t.id==='leaf')!.name).toBe('求学');
 for(const name of ['e1.json','e2.json','original.json'])expect(f.files.get(f.folder+'/'+name)).toBe(before.get(f.folder+'/'+name));
});
it('hydrates authority over frozen inline tags and fails closed if metadata is missing',async()=>{
 const f=await migrated(),result=await transactProjectTags(f.project,f.current,(library,consumers,id)=>({library,consumers:consumers.map(c=>c.id===id?{...c,transcript:setSegmentTag(c.transcript,'s1','leaf',false)}:c)}),'current');
 const directory=await recordingDirectory(result.project,'session',result.project.data.interviews[0].recordings[0]);
 expect((await readModelEdit(directory,'sample.wav','m1','e1'))!.transcript.segments[0].tagIds).toEqual([]);
 f.files.delete(f.folder+'/'+await sidecarName('e1.json'));
 await expect(readModelEdit(directory,'sample.wav','m1','e1')).rejects.toThrow('tag_metadata_missing');
});
it('body saves strip inline tags and preserve metadata, then version copies are independent',async()=>{
 const f=await migrated();f.document.transcript={...f.document.transcript,segments:f.document.transcript.segments.map((s,i)=>i? s:{...s,text:'后来修改的合成正文'})};
 await saveActiveEdit(f.directory,'sample.wav','m1','e1',f.document);
 const body=JSON.parse(f.files.get(f.folder+'/e1.json')!);expect(body.transcript.tagCollection).toBeUndefined();expect(body.transcript.tagStorageRevision).toBeUndefined();expect(body.transcript.segments[0].tagIds).toBeUndefined();
 expect((await readModelEdit(f.directory,'sample.wav','m1','e1'))!.transcript.segments[0].tagIds).toEqual(['leaf']);
 const copied=await createEdit(f.directory,'sample.wav','m1',{srcEditId:'e1',label:'Copy'});
 expect(copied.edited.transcript.tagCollection?.groups).toHaveLength(1);
 expect(f.files.has(f.folder+'/'+await sidecarName(copied.edit.file))).toBe(true);
});
it('migration failure rolls back every project/metadata patch and retains the full backup',async()=>{
 let fail=true;const f=fixture(path=>{if(path==='ripple-project.json'&&fail){fail=false;throw Error('synthetic disk full')}}),before=new Map(f.files);
 await expect(migrateProjectTagStorage(f.project,f.backup.root)).rejects.toThrow('synthetic disk full');
 for(const [path,raw]of before){expect(f.files.get(path)).toBe(raw);expect(f.backup.files.get(path)).toBe(raw)}
 expect(f.files.has(f.folder+'/'+TAG_STORAGE_MARKER)).toBe(false);
});
it('never migrates simply by opening a legacy project and rejects stale bodies and original mutations',async()=>{
 const legacy=fixture(),before=new Map(legacy.files);await openProject(legacy.root);expect(legacy.files).toEqual(before);
 const f=await migrated();await expect(transactProjectTags(f.project,{...f.current,editId:'original'},(library,consumers)=>({library,consumers}),'current')).rejects.toThrow('read_only');
 const body=JSON.parse(f.files.get(f.folder+'/e1.json')!);body.transcript.segments[0].text='external synthetic change';f.files.set(f.folder+'/e1.json',JSON.stringify(body));
 await expect(transactProjectTags(f.project,f.current,(library,consumers)=>({library,consumers}),'current')).rejects.toThrow('source_changed');
 const reopened=(await readModelEdit(f.directory,'sample.wav','m1','e1'))!;
 expect(reopened.transcript.segments[0].text).toBe('external synthetic change');expect(reopened.transcript.segments[0].tagIds).toEqual(['leaf']);
 const next=await transactProjectTags(f.project,{...f.current,transcript:reopened.transcript},(library,consumers,id)=>({library,consumers:consumers.map(c=>c.id===id?{...c,transcript:setSegmentTag(c.transcript,'s2','leaf',true)}:c)}),'current');
 expect(next.transcript.segments[1].tagIds).toEqual(['leaf']);
});
it('an atomic mixed batch reuses entities, updates groups once and cannot leak partial changes on a later invalid action',async()=>{
 const f=await migrated(),body=f.files.get(f.folder+'/e1.json'),changes=[{action:'create_tag' as const,path:'新主题/新子项',ref:'tag'},
  {action:'create_group' as const,name:'New group',ref:'group'},{action:'assign_tags' as const,segment_ids:['s1','s2'],tag_ids:['ref:tag']},
  {action:'set_group_tags' as const,group_id:'ref:group',tag_ids:['ref:tag']}];
 const result=await transactProjectTags(f.project,f.current,(library,consumers,id)=>applyTagBatch(library,consumers,id,changes),tagBatchScope(changes));
 expect(result.transcript.segments.every(s=>s.tagIds?.length)).toBe(true);expect(result.transcript.tagCollection!.groups).toHaveLength(2);expect(f.files.get(f.folder+'/e1.json')).toBe(body);
 const before=new Map(f.files);await expect(transactProjectTags(result.project,{...f.current,transcript:result.transcript},(library,consumers,id)=>applyTagBatch(library,consumers,id,[...changes,{action:'assign_tags',segment_ids:['missing'],tag_ids:['ref:tag']}]),'additions')).rejects.toThrow();
 expect(f.files).toEqual(before);
});

it('counts direct IDs across independent versions, reuses a hot cache and incrementally publishes committed changes and undo',async()=>{
 const f=await migrated(),get=f.files.get.bind(f.files),bodyPaths=['e1.json','e2.json','original.json','recoverable-orphan.json'].map(name=>f.folder+'/'+name);
 f.files.get=path=>{if(bodyPaths.includes(path))throw Error('body read forbidden');return get(path)};
 const cold=await readProjectTagCounts(f.project);expect(cold.get('leaf')).toBe(3);expect(cold.get('root')).toBe(0);expect(cold.coverage.get('root')).toBe(3);
 f.files.get=path=>{if(path.startsWith(f.folder+'/tags-'))throw Error('hot count reread metadata');return get(path)};
 expect((await readProjectTagCounts(f.project)).get('leaf')).toBe(3);
 f.files.get=path=>{if(bodyPaths.includes(path))throw Error('body read forbidden');return get(path)};
 const next=await transactProjectTags(f.project,f.current,(library,consumers,id)=>({library,consumers:consumers.map(c=>c.id===id?{...c,transcript:setSegmentTag(c.transcript,'s2','leaf',true)}:c)}),'current');
 f.files.get=path=>{if(path.startsWith(f.folder+'/tags-'))throw Error('incremental count reread metadata');return get(path)};
 expect((await readProjectTagCounts(next.project)).get('leaf')).toBe(4);expect((await readProjectTagCounts(next.project)).coverage.get('root')).toBe(4);
 f.files.get=get;const undone=await restoreProjectTagTransaction(next.project,next.receipt,false);expect((await readProjectTagCounts(undone)).get('leaf')).toBe(3);
});
