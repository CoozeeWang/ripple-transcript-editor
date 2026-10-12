import {expect,it,vi} from 'vitest';
import {AIConnector,type ConnectorDocument,type ConnectorHost} from './aiConnector';
import {applyContinuationBatch,stampContinuationReceipt} from './continuationBatch';
import type {ContinuationTask} from './incrementalContinuation';
import type {Segment,Transcript} from '../types';

function fixture(count=50) {
  const transcript:Transcript={audio:{filename:'synthetic.wav',duration:count},speakers:[{id:'s',name:'Synthetic speaker'}],segments:Array.from({length:count},(_,i)=>({id:`s${i}`,speaker_id:'s',start:i,end:i+1,text:`Synthetic segment ${i}`}))};
  const original=structuredClone(transcript),files=new Map<string,ContinuationTask>();let versions=1,writes=0,failPublish=false,failJournal=false;
  let doc:ConnectorDocument={identity:'0',editable:true,version:{id:'m:e1',model_id:'m',edit_id:'e1',name:'Synthetic draft',kind:'edit'},transcript,title:'Synthetic interview',label:'Synthetic draft',names:['Synthetic draft'],references:async()=>[]};
  const storage={scope:'0',read:async()=>structuredClone([...files.values()]),write:async(task:ContinuationTask)=>{
    if(failJournal&&task.done.length>0){failJournal=false;throw Error('synthetic_journal_failure');}files.set(task.id,structuredClone(task));
  }};
  doc.continuations=storage;
  const host:ConnectorHost={current:async()=>doc,publish:vi.fn(async(_baseline,suggestions,name,target)=>{
    if(failPublish)throw Error('synthetic_disk_failure');
    const version=target.save_mode==='new_version'?{...doc.version,id:`m:e${++versions}`,edit_id:`e${versions}`,name}:doc.version;
    const receipt={...target.checkpoint!.receipt,version_id:target.save_mode==='new_version'?'':version.id};
    const result=stampContinuationReceipt(applyContinuationBatch(doc.transcript,suggestions,{...target.checkpoint!,receipt}),version.id);
    writes++;doc={...doc,transcript:result,version,label:version.name,identity:String(versions),continuations:{...storage,scope:String(versions)}};
    return {result_version:version,version:version.name,version_id:version.edit_id};
  })};
  let connector=new AIConnector(host);
  return {host,original,files,get doc(){return doc;},get versions(){return versions;},get writes(){return writes;},get c(){return connector;},restart(){connector=new AIConnector(host);},
    change(index:number,patch:Partial<Segment>){doc={...doc,transcript:{...doc.transcript,segments:doc.transcript.segments.map((s,i)=>i===index?{...s,...patch}:s)}};},
    switchVersion(){doc={...doc,version:{...doc.version,id:'m:other',edit_id:'other'}};},
    failSave(){failPublish=true;},allowSave(){failPublish=false;},failProgress(){failJournal=true;},
    async plan(mode='current_version',extra:Record<string,unknown>={}){const read=await connector.handle('read_current',{});return connector.handle('prepare',{snapshot:read.snapshot,start_id:'s0',rules:['Synthetic editing rules'],save_mode:mode,delivery_mode:'incremental',...extra});},
  };
}
async function stage(f:ReturnType<typeof fixture>,plan:Record<string,unknown>) {
  const batch=await f.c.handle('batch',{task_id:plan.task_id});const segments=batch.segments as Segment[];
  await f.c.handle('stage',{task_id:plan.task_id,batch_id:batch.batch_id,changes:[{segment_id:segments[0].id,before:segments[0].text,after:`Revised ${segments[0].text}`}],unchanged_ids:segments.slice(1).map(s=>s.id)});
  return {batch,segments,args:{task_id:plan.task_id,batch_id:batch.batch_id,confirmed_summary:plan.summary}};
}

it('saves 2107 segments in short visible batches into one work version and resumes after controller replacement',async()=>{
  const f=fixture(2107),plan=await f.plan('new_version');let saved=0,batches=0;
  let batch=await f.c.handle('batch',{task_id:plan.task_id});
  while(saved<2107){
    const segments=batch.segments as Segment[];expect(segments.length).toBeLessThanOrEqual(24);
    const result=await f.c.handle('checkpoint',{task_id:plan.task_id,batch_id:batch.batch_id,confirmed_summary:plan.summary,
      changes:[{segment_id:segments[0].id,before:segments[0].text,after:`Revised ${segments[0].text}`}],unchanged_ids:segments.slice(1).map(s=>s.id)});
    saved=Number(result.saved_segments);
    expect(f.doc.transcript.segments.find(segment=>segment.id===segments[0].id)!.text).toMatch(/^Revised /);
    batches++;if(batches%7===0){f.restart();const list=await f.c.handle('tasks',{});expect((list.tasks as {saved_segments:number}[])[0].saved_segments).toBe(saved);}
    if(saved<2107)batch=batches%7===0?await f.c.handle('batch',{task_id:plan.task_id}):result.next_batch as Record<string,unknown>;
  }
  expect(batches).toBe(88);expect(f.versions).toBe(2);expect(f.writes).toBe(88);
  expect(f.original.segments[0].text).toBe('Synthetic segment 0');
  expect((await f.c.handle('status',{task_id:plan.task_id})).state).toBe('completed');
},15000);

it('preserves manual edits outside the current batch, then reads the latest text when reaching them',async()=>{
  const f=fixture(),plan=await f.plan();const s=await stage(f,plan);f.change(49,{text:'Manual future edit'});
  await f.c.handle('checkpoint',s.args);expect(f.doc.transcript.segments[49].text).toBe('Manual future edit');
  const middle=await stage(f,plan);await f.c.handle('checkpoint',middle.args);
  const last=await f.c.handle('batch',{task_id:plan.task_id});expect((last.segments as Segment[]).at(-1)!.text).toBe('Manual future edit');
});

it('retains newly submitted proposals when manual typing overlaps before staging, and resumes by rereading',async()=>{
  const f=fixture(),plan=await f.plan();const batch=await f.c.handle('batch',{task_id:plan.task_id});f.change(0,{text:'User correction'});
  const result=await f.c.handle('stage',{task_id:plan.task_id,batch_id:batch.batch_id,changes:[{segment_id:'s0',before:'Synthetic segment 0',after:'AI proposal'}]});
  expect(result).toMatchObject({state:'paused',conflict:true,saved:false});expect(f.writes).toBe(0);
  expect(f.files.get(String(plan.task_id))!.batch!.changes[0].after).toBe('AI proposal');f.restart();
  await f.c.handle('resume',{task_id:plan.task_id});const latest=await f.c.handle('batch',{task_id:plan.task_id});
  expect((latest.segments as Segment[])[0].text).toBe('User correction');
  expect(f.files.get(String(plan.task_id))!.held[0].changes[0].after).toBe('AI proposal');
});

it.each(['text','speaker','mark','neighbour','structure'])('pauses %s conflicts without overwriting manual work',async kind=>{
  const f=fixture(),plan=await f.plan(),s=await stage(f,plan);
  if(kind==='text')f.change(2,{text:'Manual changed'});
  if(kind==='speaker')f.change(2,{speaker_id:'other'});
  if(kind==='mark')f.change(2,{annotations:[{id:'human',text:'Manual note',createdAt:'2026-01-01'}]});
  if(kind==='neighbour')f.change(24,{text:'Neighbour changed'});
  if(kind==='structure')f.change(2,{id:'split-replacement'});
  const before=structuredClone(f.doc.transcript);expect(await f.c.handle('checkpoint',s.args)).toMatchObject({state:'paused',saved:false,proposals_retained:true});
  expect(f.doc.transcript).toEqual(before);expect(f.writes).toBe(0);
});

it('recovers a saved manuscript receipt after the progress journal fails without making another version',async()=>{
  const f=fixture(3),plan=await f.plan('new_version'),s=await stage(f,plan);f.failProgress();
  await expect(f.c.handle('checkpoint',s.args)).rejects.toThrow('synthetic_journal_failure');
  expect(f.writes).toBe(1);expect(f.versions).toBe(2);f.restart();
  expect((await f.c.handle('tasks',{})).tasks).toEqual([expect.objectContaining({state:'completed',saved_segments:3,version_id:'m:e2'})]);
  expect(await f.c.handle('checkpoint',s.args)).toMatchObject({saved:true,repeated:true});expect(f.writes).toBe(1);
});

it('discovers an uncertain first save even after its work version was renamed and the source reopened',async()=>{
  const f=fixture(3),plan=await f.plan('new_version'),s=await stage(f,plan);f.failProgress();
  await expect(f.c.handle('checkpoint',s.args)).rejects.toThrow('synthetic_journal_failure');
  const saved=structuredClone(f.doc.transcript),version={...f.doc.version,name:'User renamed work version'};
  Object.assign(f.doc,{transcript:structuredClone(f.original),version:{...f.doc.version,id:'m:e1',edit_id:'e1',name:'Synthetic draft'},references:async()=>[{version,load:async()=>saved}]});
  f.restart();expect((await f.c.handle('tasks',{})).tasks).toEqual([expect.objectContaining({version_id:'m:e2',version:'User renamed work version',saved_segments:3,is_current:false})]);
  await expect(f.c.handle('checkpoint',s.args)).rejects.toThrow('open_task_target_version_first');expect(f.versions).toBe(2);expect(f.writes).toBe(1);
});

it('does not discover or recover another interview’s task with the same manuscript version IDs',async()=>{
  const f=fixture(),plan=await f.plan();await stage(f,plan);
  const other=fixture();expect((await other.c.handle('tasks',{})).tasks).toEqual([]);
  await expect(other.c.handle('status',{task_id:plan.task_id})).rejects.toThrow('task_not_found_in_current_interview');
});

it('keeps timing/mark details local instead of sending thousands of word-origin objects per batch',async()=>{
  const f=fixture(3);f.change(0,{words:Array.from({length:1000},(_,i)=>({text:'synthetic',start:i,end:i+1})),annotations:[{id:'human',text:'Local annotation',createdAt:'2026-01-01'}]});
  const plan=await f.plan(),batch=await f.c.handle('batch',{task_id:plan.task_id});
  expect((batch.segments as Record<string,unknown>[])[0]).not.toHaveProperty('words');
  expect((batch.segments as Record<string,unknown>[])[0]).not.toHaveProperty('annotations');
  expect(f.files.get(String(plan.task_id))!.batch!.guard.segments[0].words).toHaveLength(1000);
});

it('pauses a changed future scope instead of silently skipping manually inserted segments',async()=>{
  const f=fixture(50),plan=await f.plan(),s=await stage(f,plan);await f.c.handle('checkpoint',s.args);
  f.doc.transcript.segments.splice(26,0,{id:'manual-added',speaker_id:'s',start:26,end:27,text:'Synthetic manual addition'});
  expect(await f.c.handle('stage',{task_id:plan.task_id,batch_id:(await f.c.handle('batch',{task_id:plan.task_id})).batch_id,unchanged_ids:['s24']})).toMatchObject({state:'paused'});
  await f.c.handle('resume',{task_id:plan.task_id});expect(await f.c.handle('batch',{task_id:plan.task_id})).toMatchObject({state:'paused',reason:'planned_segment_changed'});
  expect(f.doc.transcript.segments[26].id).toBe('manual-added');
});

it('keeps drafts after a failed manuscript write and does not call them saved',async()=>{
  const f=fixture(3),plan=await f.plan(),s=await stage(f,plan);f.failSave();
  await expect(f.c.handle('checkpoint',s.args)).rejects.toThrow('synthetic_disk_failure');
  f.restart();expect((await f.c.handle('status',{task_id:plan.task_id})).state).toBe('paused');
  expect(f.doc.transcript).toEqual(f.original);expect(f.files.get(String(plan.task_id))!.done).toEqual([]);
  f.allowSave();await f.c.handle('resume',{task_id:plan.task_id});await f.c.handle('checkpoint',s.args);expect(f.writes).toBe(1);
});

it('serializes repeated writes, rejects a different confirmation, and never edits a switched target',async()=>{
  const f=fixture(3),plan=await f.plan(),s=await stage(f,plan);
  const results=await Promise.all([f.c.handle('checkpoint',s.args),f.c.handle('checkpoint',s.args)]);
  expect(results[1].repeated).toBe(true);expect(f.writes).toBe(1);
  await expect(f.c.handle('checkpoint',{...s.args,confirmed_summary:'different'})).rejects.toThrow('confirmation_changed');
  f.switchVersion();await expect(f.c.handle('checkpoint',s.args)).rejects.toThrow('open_task_target_version_first');
});

it('cancels the remaining work while retaining completed batches and human marks',async()=>{
  const f=fixture();f.change(0,{annotations:[{id:'human',text:'Synthetic note',createdAt:'2026-01-01'}],highlights:[{id:'h',start:0,end:3}]});
  const plan=await f.plan(),s=await stage(f,plan);await f.c.handle('checkpoint',s.args);
  expect(await f.c.handle('cancel',{task_id:plan.task_id})).toMatchObject({saved_segments:24,already_saved_batches_retained:true});
  expect(f.doc.transcript.segments[0].annotations![0].id).toBe('human');expect(f.doc.transcript.segments[0].highlights).toHaveLength(1);
});

it('merges across a batch boundary only with the agreed retained same-speaker neighbour',async()=>{
  const f=fixture(25),plan=await f.plan('current_version',{allowed_actions:['edit','delete','merge_previous']});const s=await stage(f,plan);await f.c.handle('checkpoint',s.args);
  f.change(23,{text:'User revised already-saved predecessor'});const batch=await f.c.handle('batch',{task_id:plan.task_id});
  await f.c.handle('stage',{task_id:plan.task_id,batch_id:batch.batch_id,changes:[{segment_id:'s24',before:'Synthetic segment 24',after:'AI final text',action:'merge_previous'}]});
  if((await f.c.handle('status',{task_id:plan.task_id})).state==='paused') {
    await f.c.handle('resume',{task_id:plan.task_id});const fresh=await f.c.handle('batch',{task_id:plan.task_id});batch.batch_id=fresh.batch_id;
    await f.c.handle('stage',{task_id:plan.task_id,batch_id:batch.batch_id,changes:[{segment_id:'s24',before:'Synthetic segment 24',after:'AI final text',action:'merge_previous'}]});
  }
  await f.c.handle('checkpoint',{task_id:plan.task_id,batch_id:batch.batch_id,confirmed_summary:plan.summary});
  expect(f.doc.transcript.segments).toHaveLength(24);expect(f.doc.transcript.segments.at(-1)!.text).toBe('User revised already-saved predecessor\nAI final text');
});

it('combines stage/save, returns the next short batch, and deduplicates even an older completed batch',async()=>{
  const f=fixture(),plan=await f.plan();let batch=await f.c.handle('batch',{task_id:plan.task_id});
  const firstId=batch.batch_id;
  for(let i=0;i<3;i++) {
    const segments=batch.segments as Segment[];
    const result=await f.c.handle('checkpoint',{task_id:plan.task_id,batch_id:batch.batch_id,confirmed_summary:plan.summary,unchanged_ids:segments.map(s=>s.id)});
    expect(result.saved).toBe(true);if(result.next_batch)batch=result.next_batch as Record<string,unknown>;
  }
  expect(f.writes).toBe(3);
  expect(await f.c.handle('checkpoint',{task_id:plan.task_id,batch_id:firstId,confirmed_summary:plan.summary})).toMatchObject({saved:true,repeated:true});
  expect(f.writes).toBe(3);
});

it('refuses stale batch IDs and directs long atomic scopes to recoverable batches',async()=>{
  const f=fixture(),plan=await f.plan(),batch=await f.c.handle('batch',{task_id:plan.task_id});
  await expect(f.c.handle('stage',{task_id:plan.task_id,batch_id:'old',unchanged_ids:['s0']})).rejects.toThrow('batch_id_mismatch');
  expect(f.files.get(String(plan.task_id))!.batch!.checked).toEqual([]);
  const g=fixture(),read=await g.c.handle('read_current',{});
  await expect(g.c.handle('prepare',{snapshot:read.snapshot,start_id:'s0',save_mode:'current_version',rules:['Synthetic']})).rejects.toThrow('long_task_requires_incremental_mode');
  expect(batch.batch_id).toBeTruthy();
});

it('requires an explicit save choice and full segment scope, and survives restarts before first save',async()=>{
  const f=fixture();await f.plan();
  const batch=await f.c.handle('batch',{task_id:[...f.files.keys()][0]});f.restart();
  expect((await f.c.handle('batch',{task_id:[...f.files.keys()][0]})).batch_id).toBe(batch.batch_id);
  const g=fixture();await expect(g.plan('current_version',{start_offset:1})).rejects.toThrow('incremental_requires_full_segments');
  const read=await g.c.handle('read_current',{});expect(await g.c.handle('prepare',{snapshot:read.snapshot,start_id:'s0',rules:['Synthetic'],delivery_mode:'incremental'})).toMatchObject({needs_clarification:['save_mode']});
});
