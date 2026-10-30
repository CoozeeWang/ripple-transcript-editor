import {describe,it,expect,vi} from 'vitest';
import {projectConnectorFixture} from '../testUtils/syntheticProjectConnector';
import {ProjectAIConnector} from './projectAIConnector';
import {readModelEdit,saveActiveEdit} from '../localStore';
import {applyTagFields,restoreProjectTagTransaction,type TagTransactionReceipt} from './projectTagRepository';
const target={interview_id:'session-b',recording_id:'recording-session-b',version_id:'m1:e1'};
async function fixture(){
 const f=await projectConnectorFixture();let receipt:TagTransactionReceipt|undefined;
 const accept=vi.fn(async(r:TagTransactionReceipt)=>{receipt=r;const patch=r.versions.find(p=>p.id==='recording-session-a:m1:e1');if(patch)f.current={...f.current,transcript:applyTagFields(f.current.transcript,patch.after)};return true});
 const connector=()=>new ProjectAIConnector({...f.active,acceptTagTransaction:accept},()=>({project:()=>f.project,active:()=>({interview_id:'session-a',recording_id:'recording-session-a',version_id:'m1:e1',directory:f.dirA}),publishTagProject:async p=>{f.project=p}}));
 return{...f,f,connector,accept,get receipt(){return receipt}};
}
async function prepare(c:ProjectAIConnector,changes:Record<string,unknown>[],scope='current',t=target,client='local'){
 const read=await c.handle('tags_read',t,client);return c.handle('tags_prepare',{tag_snapshot:read.tag_snapshot,scope,allowed_actions:[...new Set(changes.map(c=>c.action))],changes},client);
}
const create=[{action:'create_tag',path:'经历/求学/小学',ref:'school'},{action:'assign_tags',segment_ids:['s1'],tag_ids:['ref:school']}];
describe('exact-version tag MCP transaction integration',()=>{
 it('previews without writes then saves once to background B, preserves A and body, and resolves after reconnect',async()=>{
  const x=await fixture(),c=x.connector(),before=await readModelEdit(x.dirB,'session-b.wav','m1','e1'),a=structuredClone(x.f.current.transcript);
  const task=await prepare(c,create);expect(task.task_id).toBeTruthy();expect(await readModelEdit(x.dirB,'session-b.wav','m1','e1')).toEqual(before);
  await expect(c.handle('tags_apply',{task_id:task.task_id,confirmed_summary:'wrong'})).rejects.toThrow('confirm_tag_summary');
  const result=await c.handle('tags_apply',{task_id:task.task_id,confirmed_summary:task.summary});expect(result).toMatchObject({saved:true,background:true,undo_available:false,view_refresh_failed:false});
  const saved=(await readModelEdit(x.dirB,'session-b.wav','m1','e1'))!.transcript;
  expect(saved.segments[0].tagIds).toHaveLength(1);expect(saved.segments.map(s=>s.text)).toEqual(before!.transcript.segments.map(s=>s.text));expect(x.f.current.transcript).toEqual(a);
  const status=await x.connector().handle('tags_status',{task_id:task.task_id});expect(status).toMatchObject({saved:true,currently_applied:true,operation_count:2});
  const revision=x.f.project!.data.revision;
  expect(await c.handle('tags_apply',{task_id:task.task_id,confirmed_summary:task.summary})).toMatchObject({saved:true});expect(x.f.project!.data.revision).toBe(revision);
  const read=await c.handle('tags_read',{...target,scope:'project',limit:1});expect(read.tags).toHaveLength(3);expect(read.segments).toHaveLength(1);expect(read.next_cursor).toBe('1');expect(JSON.stringify(read)).not.toContain('B0');
 });
 it('blocks readonly originals, missing exact version, undeclared actions and stale snapshots',async()=>{
  const x=await fixture(),c=x.connector();
  await expect(c.handle('tags_read',{...target,version_id:''})).rejects.toThrow('exact_tag_version');
  const original=await c.handle('tags_read',{...target,version_id:'m1:original'});
  await expect(c.handle('tags_prepare',{tag_snapshot:original.tag_snapshot,scope:'current',allowed_actions:['create_tag'],changes:[create[0]]})).rejects.toThrow('select_editable');
  const read=await c.handle('tags_read',target);
  await expect(c.handle('tags_prepare',{tag_snapshot:read.tag_snapshot,scope:'current',allowed_actions:['assign_tags'],changes:[create[0]]})).rejects.toThrow('outside_allowed');
  const saved=(await readModelEdit(x.dirB,'session-b.wav','m1','e1'))!;saved.transcript.segments[0].text='Synthetic human correction';await saveActiveEdit(x.dirB,'session-b.wav','m1','e1',saved);
  await expect(c.handle('tags_prepare',{tag_snapshot:read.tag_snapshot,scope:'current',allowed_actions:['create_tag'],changes:[create[0]]})).rejects.toThrow('snapshot_changed');
 });
 it('cancels without writes and enforces client ownership and project-wide AI locks',async()=>{
  const x=await fixture(),c=x.connector(),task=await prepare(c,create,'project',target,'chatgpt');
  await expect(c.handle('tags_apply',{task_id:task.task_id,confirmed_summary:task.summary},'claude')).rejects.toThrow('another_client');
  const other=await c.handle('tags_read',{...target,interview_id:'session-a',recording_id:'recording-session-a'},'claude');
  await expect(c.handle('tags_prepare',{tag_snapshot:other.tag_snapshot,scope:'current',allowed_actions:['create_tag'],changes:[create[0]]},'claude')).rejects.toThrow('locked_by_other');
  await c.handle('tags_cancel',{task_id:task.task_id},'chatgpt');await expect(c.handle('tags_apply',{task_id:task.task_id,confirmed_summary:task.summary},'chatgpt')).rejects.toThrow('not_editable');
  expect((await readModelEdit(x.dirB,'session-b.wav','m1','e1'))!.transcript.segments[0].tagIds).toBeUndefined();
 });
 it('records active undo, preserves later text and detects undone receipts after reopen',async()=>{
  const x=await fixture(),c=x.connector(),task=await prepare(c,create,'current',{...target,interview_id:'session-a',recording_id:'recording-session-a'});
  expect(await c.handle('tags_apply',{task_id:task.task_id,confirmed_summary:task.summary})).toMatchObject({saved:true,undo_available:true});expect(x.accept).toHaveBeenCalledOnce();
  const before=x.f.project!,disk=(await readModelEdit(x.dirA,'session-a.wav','m1','e1'))!;disk.transcript.segments[0].text='Later synthetic body';await saveActiveEdit(x.dirA,'session-a.wav','m1','e1',disk);
  x.f.project=await restoreProjectTagTransaction(before,x.receipt!,false);
  expect(await x.connector().handle('tags_status',{task_id:task.task_id})).toMatchObject({saved:true,state:'undone',currently_applied:false});
  expect((await readModelEdit(x.dirA,'session-a.wav','m1','e1'))!.transcript.segments[0].text).toBe('Later synthetic body');
  expect(await c.handle('tags_apply',{task_id:task.task_id,confirmed_summary:task.summary})).toMatchObject({state:'undone'});
  x.f.project=await restoreProjectTagTransaction(x.f.project!,x.receipt!,true);expect(await c.handle('tags_status',{task_id:task.task_id})).toMatchObject({currently_applied:true});
 });
 it('retains saved receipt when UI notification fails and never claims the disk save failed',async()=>{
  const x=await fixture();x.accept.mockRejectedValueOnce(Error('Synthetic UI failure'));const c=x.connector(),task=await prepare(c,create,'current',{...target,interview_id:'session-a',recording_id:'recording-session-a'});
  expect(await c.handle('tags_apply',{task_id:task.task_id,confirmed_summary:task.summary})).toMatchObject({saved:true,view_refresh_failed:true});expect(await x.connector().handle('tags_status',{task_id:task.task_id})).toMatchObject({saved:true});
 });
 it('rejects implicit shared merges and requires project capability before persistence',async()=>{
  const x=await fixture(),c=x.connector(),made=await prepare(c,create);const result=await c.handle('tags_apply',{task_id:made.task_id,confirmed_summary:made.summary});
  const id=(result.references as {tags:Record<string,string>}).tags.school;
  await expect(prepare(c,[{action:'rename_tag',tag_id:id,name:'童年'}])).rejects.toThrow('project_tag_scope');
  const rename=await prepare(c,[{action:'rename_tag',tag_id:id,name:'童年'}],'project');
  expect(await c.handle('tags_apply',{task_id:rename.task_id,confirmed_summary:rename.summary})).toMatchObject({saved:true});
  expect(x.f.project!.data.tagLibrary!.tags.find(t=>t.id===id)!.name).toBe('童年');
 });
});
