import {ProjectAIConnector} from './projectAIConnector';
import {blocksHumanEditing} from './aiEditOwnership';
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
    batches++;if(batches%7===0){f.restart();const list=await f.c.handle('tasks',{include_history:true});expect((list.tasks as {saved_segments:number}[])[0].saved_segments).toBe(saved);}
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
  expect((await f.c.handle('tasks',{include_history:true})).tasks).toEqual([expect.objectContaining({state:'completed',saved_segments:3,version_id:'m:e2'})]);
  expect(await f.c.handle('checkpoint',s.args)).toMatchObject({saved:true,repeated:true});expect(f.writes).toBe(1);
});

it('discovers an uncertain first save even after its work version was renamed and the source reopened',async()=>{
  const f=fixture(3),plan=await f.plan('new_version'),s=await stage(f,plan);f.failProgress();
  await expect(f.c.handle('checkpoint',s.args)).rejects.toThrow('synthetic_journal_failure');
  const saved=structuredClone(f.doc.transcript),version={...f.doc.version,name:'User renamed work version'};
  Object.assign(f.doc,{transcript:structuredClone(f.original),version:{...f.doc.version,id:'m:e1',edit_id:'e1',name:'Synthetic draft'},references:async()=>[{version,load:async()=>saved}]});
  f.restart();expect((await f.c.handle('tasks',{include_history:true})).tasks).toEqual([expect.objectContaining({version_id:'m:e2',version:'User renamed work version',saved_segments:3,is_current:false})]);
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

it('reports actual saved batch counts across restart and repeated receipts',async()=>{
  const f=fixture(50),plan=await f.plan();
  expect((await f.c.handle('tasks',{include_history:true})).tasks).toEqual([expect.objectContaining({saved_batches:0,batch_number:1})]);
  const first=await stage(f,plan);await f.c.handle('checkpoint',first.args);
  f.restart();
  expect((await f.c.handle('tasks',{include_history:true})).tasks).toEqual([expect.objectContaining({saved_batches:1,batch_number:2,saved_segments:24})]);
  await f.c.handle('checkpoint',first.args);
  expect((await f.c.handle('tasks',{include_history:true})).tasks).toEqual([expect.objectContaining({saved_batches:1})]);
  const second=await stage(f,plan);await f.c.handle('checkpoint',second.args);
  const third=await stage(f,plan);await f.c.handle('checkpoint',third.args);
  expect((await f.c.handle('tasks',{include_history:true})).tasks).toEqual([expect.objectContaining({state:'completed',saved_batches:3,saved_segments:50})]);
});
it('does not invent batches when legacy saved segments are missing from the receipt history',async()=>{
  const f=fixture(50),plan=await f.plan(),first=await stage(f,plan);await f.c.handle('checkpoint',first.args);
  const journal=f.files.get(String(plan.task_id))!;delete journal.receipts;delete journal.lastReceipt;f.restart();
  const tasks=(await f.c.handle('tasks',{include_history:true})).tasks as {saved_batches?:number;batch_number?:number}[];
  expect(tasks[0].saved_batches).toBeUndefined();expect(tasks[0].batch_number).toBeUndefined();
  const second=await stage(f,plan);await f.c.handle('checkpoint',second.args);
  const updated=(await f.c.handle('tasks',{include_history:true})).tasks as {saved_batches?:number}[];
  expect(updated[0].saved_batches).toBeUndefined();
});


it('creates a linked fresh task for cancelled remaining scope after restart without inheriting rules or replaying saved text', async () => {
  const f = fixture(30), remember = vi.fn(async () => {}); f.doc.remember = remember;
  const old = await f.plan(), batch = await stage(f, old);
  await f.c.handle('checkpoint', batch.args);
  await f.c.handle('cancel', { task_id: old.task_id });
  f.change(24, { text: 'Synthetic manual correction' }); f.restart();
  expect((await f.c.handle('tasks', {})).tasks).toEqual([]);
  expect(await f.c.handle('status', { task_id: old.task_id })).toMatchObject({ state: 'cancelled', saved_segments: 24, next_action: 'prepare_remaining_as_new_task', remaining_ids: ['s24','s25','s26','s27','s28','s29'] });
  expect((await f.c.handle('status', { task_id: old.task_id })).summary).toBeUndefined();
  await expect(f.c.handle('resume', { task_id: old.task_id })).rejects.toThrow('task_not_paused');
  const next = await f.plan('current_version', { start_id: 's24', previous_task_id: old.task_id, rules: ['New explicit instructions'] });
  expect(next.task_id).not.toBe(old.task_id);
  expect(JSON.parse(String(next.summary))).toMatchObject({ previous_task_id: old.task_id, rules: ['New explicit instructions'] });
  expect((await f.c.handle('batch', { task_id: next.task_id })).segments).toMatchObject([{id:'s24',text:'Synthetic manual correction'}, ...['s25','s26','s27','s28','s29'].map(id=>({id}))]);
  const saved = await stage(f, next); await f.c.handle('checkpoint', saved.args);
  expect(f.writes).toBe(2); expect(remember).not.toHaveBeenCalled();
  expect(f.doc.transcript.segments[0].text).toBe('Revised Synthetic segment 0');
  await expect(f.plan('current_version', {start_id:'s24',previous_task_id:old.task_id})).rejects.toThrow('successor_already_exists');
  expect((await f.c.handle('stage', {task_id:old.task_id,batch_id:batch.batch.batch_id,changes:[]})).saved).toBe(false);
});

it.each(['structure','range','version','receipt','uncertain'])('refuses unsafe successor: %s', async kind => {
  const f = fixture(30), old = await f.plan(), batch = await stage(f, old);
  await f.c.handle('checkpoint', batch.args); await f.c.handle('cancel', {task_id:old.task_id});
  if(kind==='structure') f.change(25,{id:'replacement'});
  if(kind==='version') f.switchVersion();
  if(kind==='receipt') delete f.doc.transcript.aiContinuationReceipts;
  if(kind==='uncertain') { const t=f.files.get(String(old.task_id))!; t.pending={...t.lastReceipt!,batch_id:'uncertain'}; f.restart(); }
  await expect(f.plan('current_version',{start_id:kind==='range'?'s23':'s24',previous_task_id:old.task_id})).rejects.toThrow();
  expect(f.files.size).toBe(1); expect(f.writes).toBe(1);
});


it('resolves a cancelled pending save receipt after restart without resurrecting the task', async () => {
  for (const count of [3,30]) {
    const f=fixture(count), task=await f.plan(), batch=await stage(f,task);
    f.failProgress();
    await expect(f.c.handle('checkpoint',batch.args)).rejects.toThrow('synthetic_journal_failure');
    const journal=f.files.get(String(task.task_id))!;
    journal.state='cancelled';journal.reason='user_cancelled';f.restart();
    expect(await f.c.handle('status',{task_id:task.task_id})).toMatchObject({state:'cancelled',saved_segments:Math.min(24,count),next_action:count>24?'prepare_remaining_as_new_task':'none'});
    expect(f.files.get(String(task.task_id))!.pending).toBeUndefined();
    await expect(f.c.handle('resume',{task_id:task.task_id})).rejects.toThrow('task_not_paused');
    expect(f.writes).toBe(1);
  }
});

it('keeps the 2312 original denominator across edit, proofreading and fresh continuation without adding repeated proofreading', async () => {
  const f=fixture(2312), root=await f.plan('current_version',{proofreading_required:true});
  async function batches(plan:Record<string,unknown>,count:number){for(let i=0;i<count;i++){const b=await f.c.handle('batch',{task_id:plan.task_id});await f.c.handle('checkpoint',{task_id:plan.task_id,batch_id:b.batch_id,confirmed_summary:plan.summary,unchanged_ids:(b.segments as Segment[]).map(s=>s.id)});}}
  await batches(root,10);await f.c.handle('cancel',{task_id:root.task_id,initiator:'ai',reason:'phase_transition',next_phase:'proofreading'});
  const proof=await f.plan('current_version',{previous_task_id:root.task_id,phase:'proofreading',end_id:'s239'});await batches(proof,10);
  expect(await f.c.handle('status',{task_id:proof.task_id})).toMatchObject({request_saved:240,request_total:2312,proofread_saved:240,request_status:'waiting',request_complete:false});
  const second=await f.plan('current_version',{previous_task_id:proof.task_id,start_id:'s240'});await batches(second,10);
  expect(await f.c.handle('status',{task_id:second.task_id})).toMatchObject({saved_segments:240,total_segments:2072,request_saved:480,request_total:2312,proofread_saved:240,phase:'editing'});
  await f.c.handle('cancel',{task_id:second.task_id,initiator:'ai',reason:'phase_transition',next_phase:'proofreading'});
  const again=await f.plan('current_version',{previous_task_id:second.task_id,phase:'proofreading',end_id:'s239'});await batches(again,10);f.restart();
  expect(await f.c.handle('status',{task_id:again.task_id})).toMatchObject({request_saved:480,request_total:2312,proofread_saved:240,request_complete:false});
},15000);
it('publishes durable progress before slow next-batch preparation returns',async()=>{
 const f=fixture(30),plan=await f.plan(),s=await stage(f,plan);const observed:unknown[]=[];f.host.continuationProgress=tasks=>observed.push(structuredClone(tasks));
 const current=f.host.current;let release!:()=>void,enter!:()=>void;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>enter=r);
 f.host.current=async()=>{if(f.writes===1){enter();await gate;}return current();};const saving=f.c.handle('checkpoint',s.args);await entered;
 expect(observed).toContainEqual(expect.arrayContaining([expect.objectContaining({request_saved:24,request_total:30,request_status:'preparing_next'})]));release();await saving;
});
it('does not count failed or uncertain saves until a durable manuscript receipt is recovered',async()=>{
 const f=fixture(30),plan=await f.plan(),s=await stage(f,plan);f.failSave();await expect(f.c.handle('checkpoint',s.args)).rejects.toThrow();
 expect(await f.c.handle('status',{task_id:plan.task_id})).toMatchObject({request_saved:0,request_status:'failed',request_complete:false});
 f.allowSave();await f.c.handle('resume',{task_id:plan.task_id});f.failProgress();await expect(f.c.handle('checkpoint',s.args)).rejects.toThrow();f.restart();
 expect(await f.c.handle('status',{task_id:plan.task_id})).toMatchObject({request_saved:24,request_total:30});
});
it('requires explicit AI handoff and keeps user stops distinct from failures',async()=>{
 const f=fixture(),p=await f.plan();await expect(f.c.handle('cancel',{task_id:p.task_id,initiator:'ai',reason:'phase_transition'})).rejects.toThrow('explicit_handoff');
 expect(await f.c.handle('cancel',{task_id:p.task_id,initiator:'system',reason:'failure'})).toMatchObject({ended_by:'system',reason:'failure',request_status:'failed'});
 const next=await f.plan('current_version',{previous_task_id:p.task_id});expect(await f.c.handle('cancel',{task_id:next.task_id,initiator:'user',reason:'user_stop'})).toMatchObject({ended_by:'user',reason:'user_cancelled',request_status:'stopped'});
});
it('requires the whole original scope and required proofreading before whole completion; partial completion stays local',async()=>{
 const f=fixture(3),p=await f.plan('current_version',{proofreading_required:true});const s=await stage(f,p);await f.c.handle('checkpoint',s.args);
 expect(await f.c.handle('status',{task_id:p.task_id})).toMatchObject({complete:true,request_complete:false,request_status:'waiting'});
 const proof=await f.plan('current_version',{previous_task_id:p.task_id,phase:'proofreading'});const b=await stage(f,proof);await f.c.handle('checkpoint',b.args);
 expect(await f.c.handle('status',{task_id:proof.task_id})).toMatchObject({request_complete:true,request_status:'completed',request_saved:3,proofread_saved:3});
 const partial=fixture(3),q=await partial.plan('current_version',{end_id:'s1',proofreading_required:false}),qb=await stage(partial,q);await partial.c.handle('checkpoint',qb.args);
 expect(await partial.c.handle('status',{task_id:q.task_id})).toMatchObject({request_complete:true,whole_request:false,request_status:'range_completed'});
});
it('keeps structural deletions and merges in the original saved denominator, not the smaller current manuscript',async()=>{
 const f=fixture(4),p=await f.plan('current_version',{allowed_actions:['edit','delete','merge_previous'],proofreading_required:false});
 const b=await f.c.handle('batch',{task_id:p.task_id});
 const r=await f.c.handle('checkpoint',{task_id:p.task_id,batch_id:b.batch_id,confirmed_summary:p.summary,changes:[{segment_id:'s1',before:'Synthetic segment 1',after:'',action:'delete'},{segment_id:'s2',before:'Synthetic segment 2',after:'Merged synthetic',action:'merge_previous'}],unchanged_ids:['s0','s3']});
 expect(f.doc.transcript.segments).toHaveLength(2);expect(r).toMatchObject({request_saved:4,request_total:4,request_complete:true});
});
it.each(['current_version','new_version'])('refreshes durable counts and the exact %s version before the slow next batch returns',async saveMode=>{
 const f=fixture(30),current=f.host.current;let release!:()=>void,enter!:()=>void;
 const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>enter=r);
 f.host.current=async()=>{if(f.writes===1){enter();await gate;}return current();};
 const c=new ProjectAIConnector(f.host,()=>undefined);
 const read=await c.handle('read_current',{}),p=await c.handle('prepare',{snapshot:read.snapshot,start_id:'s0',rules:['Synthetic'],save_mode:saveMode,delivery_mode:'incremental'});
 const b=await c.handle('batch',{task_id:p.task_id});
 const saving=c.handle('checkpoint',{task_id:p.task_id,batch_id:b.batch_id,confirmed_summary:p.summary,unchanged_ids:(b.segments as Segment[]).map(s=>s.id)});
 await entered;
 try {expect(c.editing.get(String(p.task_id))).toMatchObject({saved:24,total:30,requestStatus:'preparing_next',inFlight:1,version_id:saveMode==='new_version'?'m:e2':'m:e1'});}finally{release();}
 await saving;
});
it('does not invent an unfinished request lease for completed legacy journals without request metadata',async()=>{
 const f=fixture(2),p=await f.plan('current_version',{proofreading_required:false}),b=await stage(f,p);await f.c.handle('checkpoint',b.args);
 const legacy=f.files.get(String(p.task_id))!;delete legacy.request;delete legacy.phase;f.restart();
 const status=await f.c.handle('status',{task_id:p.task_id});expect(status).toMatchObject({state:'completed',saved_segments:2,total_segments:2});expect(status.request_id).toBeUndefined();
});

it('releases a fully saved requested range without claiming the whole manuscript is complete',async()=>{
 const f=fixture(4),c=new ProjectAIConnector(f.host,()=>undefined);
 const read=await c.handle('read_current',{});
 const p=await c.handle('prepare',{snapshot:read.snapshot,start_id:'s0',end_id:'s1',rules:['Synthetic'],save_mode:'current_version',delivery_mode:'incremental',proofreading_required:false});
 const b=await c.handle('batch',{task_id:p.task_id});
 await c.handle('checkpoint',{task_id:p.task_id,batch_id:b.batch_id,confirmed_summary:p.summary,unchanged_ids:['s0','s1']});
 const activity=c.editing.get(String(p.task_id))!;
 expect(activity).toMatchObject({state:'completed',requestComplete:true,requestStatus:'range_completed',saved:2,total:2,inFlight:0});
 expect(blocksHumanEditing(activity)).toBe(false);
 expect(f.doc.transcript.segments).toEqual(f.original.segments);
});

it('reports the exact batch receipt without attributing an unobserved call to a platform',async()=>{
 const f=fixture(30),p=await f.plan(),b=await stage(f,p);
 const status=()=>f.c.handle('status',{task_id:p.task_id,batch_id:b.batch.batch_id});
 // Simulate a pre-dispatch block by making no checkpoint call at all.
 expect((await status()).save_diagnostics).toMatchObject({receipt_status:'no_saved_receipt',external_call_status:'not_observable',saved_segments:0});
 expect(f.writes).toBe(0);
 f.failSave();await expect(f.c.handle('checkpoint',b.args)).rejects.toThrow('synthetic_disk_failure');
 expect((await status()).save_diagnostics).toMatchObject({receipt_status:'save_uncertain',saved_segments:0});
 f.allowSave();await f.c.handle('resume',{task_id:p.task_id});
 f.failProgress();await expect(f.c.handle('checkpoint',b.args)).rejects.toThrow('synthetic_journal_failure');f.restart();
 const saved=await status();
 expect(saved.save_diagnostics).toMatchObject({receipt_status:'confirmed_saved',saved_segments:24,saved_version_id:'m:e1'});
 expect(JSON.stringify(saved.save_diagnostics)).not.toMatch(/Synthetic|Revised|rules|summary|text/);
 expect((await f.c.handle('status',{task_id:p.task_id})).save_diagnostics).toMatchObject({receipt_status:'confirmed_saved',batch_id:b.batch.batch_id});
 const next=await f.c.handle('batch',{task_id:p.task_id});
 expect((await f.c.handle('status',{task_id:p.task_id,batch_id:next.batch_id})).save_diagnostics).toMatchObject({receipt_status:'no_saved_receipt',saved_segments:0});
 const unknown=(await f.c.handle('status',{task_id:p.task_id,batch_id:'/synthetic/private-note'})).save_diagnostics;
 expect(unknown).toMatchObject({receipt_status:'unknown_batch',batch_id:null});
 expect(JSON.stringify(unknown)).not.toContain('private-note');
 await f.c.handle('checkpoint',b.args);expect(f.writes).toBe(1);
});

it('distinguishes observed checkpoint arrival from durable receipt and forgets only window arrival history on reopen',async()=>{
 const f=fixture(3),c=new ProjectAIConnector(f.host,()=>undefined);
 const read=await c.handle('read_current',{}),p=await c.handle('prepare',{snapshot:read.snapshot,start_id:'s0',rules:['Synthetic'],save_mode:'current_version',delivery_mode:'incremental',proofreading_required:false});
 const b=await c.handle('batch',{task_id:p.task_id});
 expect((await c.handle('status',{task_id:p.task_id,batch_id:b.batch_id})).save_diagnostics).toMatchObject({window_save_attempt:null,receipt_status:'no_saved_receipt',external_call_status:'not_observable'});
 f.failSave();await expect(c.handle('checkpoint',{task_id:p.task_id,batch_id:b.batch_id,confirmed_summary:p.summary,unchanged_ids:['s0','s1','s2']})).rejects.toThrow('synthetic_disk_failure');
 expect((await c.handle('status',{task_id:p.task_id,batch_id:b.batch_id})).save_diagnostics).toMatchObject({window_save_attempt:{batch_id:b.batch_id},receipt_status:'save_uncertain',arrival_history_scope:'current_window_session'});
 const reopened=new ProjectAIConnector(f.host,()=>undefined);
 const status=await reopened.handle('status',{task_id:p.task_id,batch_id:b.batch_id});
 expect(status.save_diagnostics).toMatchObject({receipt_status:'save_uncertain',external_call_status:'not_observable'});
 expect((status.save_diagnostics as {window_save_attempt?:unknown}).window_save_attempt??null).toBeNull();
});

it('completes an agreed editing-only request by default without inventing a proofreading phase',async()=>{
 const f=fixture(3),c=new ProjectAIConnector(f.host,()=>undefined);
 const read=await c.handle('read_current',{}),p=await c.handle('prepare',{snapshot:read.snapshot,start_id:'s0',rules:['Synthetic editing-only request'],save_mode:'current_version',delivery_mode:'incremental'});
 const b=await c.handle('batch',{task_id:p.task_id});await c.handle('checkpoint',{task_id:p.task_id,batch_id:b.batch_id,confirmed_summary:p.summary,unchanged_ids:['s0','s1','s2']});
 expect(await c.handle('status',{task_id:p.task_id})).toMatchObject({request_complete:true,request_status:'completed'});expect(blocksHumanEditing(c.editing.get(String(p.task_id))!)).toBe(false);
});
