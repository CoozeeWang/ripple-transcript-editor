/** Synthetic-only filesystem; no provider calls, real projects or audio. */
import { expect, test } from 'vitest';
import { createEdit, createModel, readManifest, stemOf, readModelEdit, readModelOriginal, renameEditLabel, renameModelLabel } from '../src/localStore';
import { hasVisibleOriginal, originalGroups, reorderOriginalModels, withOriginalGroups } from '../src/lib/originalGroups';
import { addInterview, addRecordings, createProject, moveProjectRecordings, openProject, recordingDirectory, reassignManuscript,
  restoreProjectInterview, restoreProjectTrashItem, trashProjectInterview, trashProjectMaterial } from '../src/lib/projectStore';
import type { Transcript, TranscriptManifest, TranscriptModel } from '../src/types';
import { syntheticDirectory, syntheticTree, syntheticWave, type SyntheticTree } from './syntheticProjectDirectory';

const audio = 'Synthetic source.wav';
const transcript = (): Transcript => ({audio:{filename:audio,duration:3},speakers:[{id:'sp',name:'Synthetic speaker'}],segments:[
  {id:'segment',speaker_id:'sp',start:0,end:3,text:'Synthetic source words',words:[{text:'Synthetic source words',start:0,end:3}],
    annotations:[{id:'note',text:'Synthetic retained annotation',createdAt:'2026-01-01'}],highlights:[{id:'highlight',start:0,end:9}]},
]});
function snapshot(tree: SyntheticTree, prefix = ''): Record<string, number[]> {
  return Object.fromEntries([...tree.files].map(([name,bytes])=>[prefix+name,[...bytes]]).concat(
    [...tree.folders].flatMap(([name,folder])=>Object.entries(snapshot(folder,prefix+name+'/')))));
}
function assertRetained(before: Record<string,number[]>, after: Record<string,number[]>) {
  for (const [name,bytes] of Object.entries(before)) if (!name.split('/').at(-1)!.startsWith('manifest.json')) expect(after[name], name).toEqual(bytes);
}
async function localFixture() {
  const tree=syntheticTree();tree.files.set(audio,syntheticWave());const dir=syntheticDirectory(tree,'Synthetic ownership');
  const a=await createModel(dir,audio,{engine:'Synthetic A',transcript:transcript(),original:transcript(),originalOnly:true});
  const b=await createModel(dir,audio,{engine:'Synthetic B',transcript:transcript(),original:transcript(),originalOnly:true});
  return {tree,dir,a,b};
}

test('forks, further copies and AI versions share one stable original group, with other originals separate',async()=>{
  const f=await localFixture(),before=snapshot(f.tree);
  const a1=await createEdit(f.dir,audio,f.a.model.id,{fromOriginal:true,label:'Synthetic A version 1'});
  const a2=await createEdit(f.dir,audio,a1.model.id,{srcEditId:a1.edit.id,label:'Synthetic A version 2'});
  const a3=await createEdit(f.dir,audio,f.a.model.id,{fromOriginal:true,label:'Synthetic A independent copy'});
  const baseline=(await readModelEdit(f.dir,audio,a1.model.id,a1.edit.id))!.transcript;
  await createEdit(f.dir,audio,a1.model.id,{srcEditId:a1.edit.id,reviewed:{baseline,transcript:baseline,label:'Synthetic AI version'}});
  await createEdit(f.dir,audio,f.b.model.id,{fromOriginal:true,label:'Synthetic B version'});
  const manifest=(await readManifest(f.dir,audio))!,groups=originalGroups(manifest.models);
  expect(f.a.model.originalGroupId).not.toBe(f.b.model.originalGroupId);
  const ga=groups.find(group=>group.original?.id===f.a.model.id)!;
  expect(ga.models.map(model=>model.id)).toEqual([f.a.model.id,a1.model.id,a3.model.id]);
  expect(ga.models.flatMap(model=>model.edits)).toHaveLength(4);
  expect(ga.models.every(model=>model.originalGroupId===f.a.model.originalGroupId)).toBe(true);
  expect(a2.model.originalGroupId).toBe(f.a.model.originalGroupId);
  expect(groups.find(group=>group.original?.id===f.b.model.id)?.models.flatMap(model=>model.edits)).toHaveLength(1);
  assertRetained(before,snapshot(f.tree));
});

test('legacy backfill uses word origins, stays read-only, and is persisted by a subsequent index operation',async()=>{
  const f=await localFixture();
  const child=await createEdit(f.dir,audio,f.a.model.id,{fromOriginal:true,label:'Synthetic legacy version'});
  const folder=f.tree.folders.get('Synthetic source.transcript')!;
  const manifest=JSON.parse(new TextDecoder().decode(folder.files.get('manifest.json'))) as TranscriptManifest;
  manifest.models=manifest.models.map(({originalGroupId: _group,...model})=>{void _group;return model;});
  folder.files.set('manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));
  const before=snapshot(f.tree);
  const read=(await readManifest(f.dir,audio))!;
  const root=read.models.find(model=>model.id===f.a.model.id)!,copy=read.models.find(model=>model.id===child.model.id)!;
  expect(root.originalGroupId).toMatch(/^legacy-/);expect(copy.originalGroupId).toBe(root.originalGroupId);
  expect(snapshot(f.tree)).toEqual(before);
  await renameModelLabel(f.dir,audio,root.id,'Synthetic renamed original');
  const saved=JSON.parse(new TextDecoder().decode(folder.files.get('manifest.json'))) as TranscriptManifest;
  expect(saved.models.find(model=>model.id===copy.id)?.originalGroupId).toBe(root.originalGroupId);
  await renameEditLabel(f.dir,audio,copy.id,'e1','Synthetic renamed edit');
  expect((await readManifest(f.dir,audio))?.models.find(model=>model.id===copy.id)?.originalGroupId).toBe(root.originalGroupId);
  expect((await readModelOriginal(f.dir,audio,root.id))?.transcript.segments[0].annotations).toEqual(transcript().segments[0].annotations);
});

test('a legacy original without an identity and its first new fork receive the same persisted identity',async()=>{
  const f=await localFixture(),folder=f.tree.folders.get('Synthetic source.transcript')!;
  const raw=JSON.parse(new TextDecoder().decode(folder.files.get('manifest.json'))) as TranscriptManifest;
  delete raw.models[0].originalGroupId;folder.files.set('manifest.json',new TextEncoder().encode(JSON.stringify(raw)));
  const child=await createEdit(f.dir,audio,f.a.model.id,{fromOriginal:true,label:'Synthetic new fork'});
  const current=(await readManifest(f.dir,audio))!;
  expect(current.models[0].originalGroupId).toBe(child.model.originalGroupId);
  expect(current.models[0].originalGroupId).toBeTruthy();
});

test('legacy same-model editing versions materialize their original identity without moving files',async()=>{
  const tree=syntheticTree(),dir=syntheticDirectory(tree,'Synthetic legacy group');tree.files.set(audio,syntheticWave());
  const made=await createModel(dir,audio,{engine:'Synthetic legacy engine',transcript:transcript(),original:transcript()});
  const folder=tree.folders.get('Synthetic source.transcript')!,raw=JSON.parse(new TextDecoder().decode(folder.files.get('manifest.json'))) as TranscriptManifest;
  delete raw.models[0].originalGroupId;folder.files.set('manifest.json',new TextEncoder().encode(JSON.stringify(raw)));
  const before=snapshot(tree),copy=await createEdit(dir,audio,made.model.id,{srcEditId:'e1',label:'Synthetic flat legacy copy'});
  expect(copy.model.id).toBe(made.model.id);expect(copy.model.originalGroupId).toBeTruthy();
  expect(originalGroups(copy.manifest.models)[0].models[0].edits).toHaveLength(2);assertRetained(before,snapshot(tree));
});

test('sorting moves an original together with its edits and never changes edit ownership',()=>{
  const a:TranscriptModel={id:'a',engine:'test',original:'a.json',originalGroupId:'a-owner',edits:[],activeEditId:''};
  const b={...a,id:'b',original:'b.json',originalGroupId:'b-owner'};
  const child=(id:string,group:string):TranscriptModel=>({id,engine:'test',originalGroupId:group,edits:[{id:'e1',file:`${id}.json`,updated_at:''}],activeEditId:'e1'});
  const a1=child('a1','a-owner'),a2=child('a2','a-owner'),b1=child('b1','b-owner');
  const input=[a,a1,a2,b,b1];
  expect(reorderOriginalModels(input,'a','b',true).map(model=>model.id)).toEqual(['b','b1','a','a1','a2']);
  expect(reorderOriginalModels(input,'a1','b1',true)).toBe(input);
  expect(reorderOriginalModels(input,'a2','a1',false).map(model=>model.id)).toEqual(['a','a2','a1','b','b1']);
});

test.each(['none','mixed','invalid','unreadable'] as const)('does not guess legacy ownership from names, engines or position (%s)',async mode=>{
  const original:TranscriptModel={id:'m1',createdAt:'2026-01-01',engine:'Same engine',label:'Matching title',original:'source.json',edits:[],activeEditId:''};
  const other={...original,id:'m2',original:'other.json'};
  const refs=mode==='none'?[]:[{model:'m1',segment:'segment',from:mode==='invalid'?999:0,to:mode==='invalid'?1000:1,start:0,end:1},
    ...(mode==='mixed'?[{model:'m2',segment:'segment',from:0,to:1,start:0,end:1}]:[])];
  const child:TranscriptModel={id:'m3',createdAt:'2026-01-02',engine:original.engine,label:original.label,edits:[{id:'e1',file:'edit.json',updated_at:''}],activeEditId:'e1'};
  const manifest:TranscriptManifest={schemaVersion:2,audio,activeModelId:'m3',models:[original,child,other]};
  const input=transcript();input.segments[0].words![0].origins=refs;
  const result=await withOriginalGroups(manifest,async file=>{if(mode==='unreadable')throw Error('Synthetic missing');return JSON.stringify({transcript:file==='edit.json'?input:transcript()});});
  expect(result.models[1].originalGroupId).toBeUndefined();expect(originalGroups(result.models).find(group=>!group.original)?.models[0].id).toBe('m3');
});

test.each(['newer-source','different-content'] as const)('legacy evidence rejects a reused model ID (%s)',async mode=>{
  const original:TranscriptModel={id:'m1',createdAt:mode==='newer-source'?'2026-02-01':'2026-01-01',engine:'test',original:'original.json',edits:[],activeEditId:''};
  const child:TranscriptModel={id:'m2',createdAt:'2026-01-02',engine:'test',edits:[{id:'e1',file:'edit.json',updated_at:''}],activeEditId:'e1'};
  const source=transcript(),copy=transcript();
  copy.segments[0].words=[{text:copy.segments[0].text,start:0,end:3,timing:'source',origins:[{model:'m1',segment:'segment',from:0,to:copy.segments[0].text.length,start:0,end:3}]}];
  if(mode==='different-content')source.segments[0].text='An unrelated original that is long enough';
  const result=await withOriginalGroups({schemaVersion:2,audio,activeModelId:'m2',models:[original,child]},async file=>JSON.stringify({transcript:file==='edit.json'?copy:source}));
  expect(result.models[1].originalGroupId).toBeUndefined();
});

test('explicit orphan provenance never attaches to a different original with a reused local model ID',()=>{
  const root:TranscriptModel={id:'m1',engine:'test',original:'new.json',originalGroupId:'new-owner',edits:[],activeEditId:''};
  const child:TranscriptModel={id:'m2',engine:'test',originalGroupId:'deleted-owner',edits:[{id:'e1',file:'old.json',updated_at:''}],activeEditId:'e1'};
  const groups=originalGroups([root,child]);expect(groups).toHaveLength(2);expect(groups[0].models).toEqual([root]);expect(groups[1].original).toBeNull();
  expect(originalGroups([root,{...root,id:'m3'}, {...child,originalGroupId:'new-owner'}])).toHaveLength(3);
});

async function projectFixture() {
  const tree=syntheticTree(),parent=syntheticDirectory(tree,'Synthetic root');let project=await createProject(parent,'Synthetic ownership project');
  project=await addInterview(project,'Synthetic first session');project=await addInterview(project,'Synthetic second session');
  const inputs=syntheticTree();inputs.files.set('Synthetic A.wav',syntheticWave());inputs.files.set('Synthetic B.wav',syntheticWave());
  const input=syntheticDirectory(inputs,'Synthetic inputs'),session=project.data.interviews[0];
  project=await addRecordings(project,session.id,[await input.getFileHandle('Synthetic A.wav'),await input.getFileHandle('Synthetic B.wav')],'copy');
  const source=project.data.interviews[0].recordings[0],target=project.data.interviews[0].recordings[1];
  const dir=await recordingDirectory(project,session.id,source),to=await recordingDirectory(project,session.id,target);
  const a=await createModel(dir,source.file,{engine:'Synthetic A',transcript:transcript(),original:transcript(),originalOnly:true});
  const child=await createEdit(dir,source.file,a.model.id,{fromOriginal:true,label:'Synthetic A correction'});
  const b=await createModel(to,target.file,{engine:'Synthetic B',transcript:transcript(),original:transcript(),originalOnly:true});
  await createEdit(to,target.file,b.model.id,{fromOriginal:true,label:'Synthetic B correction'});
  return {tree,parent,project,session,source,target,dir,a,b,child};
}

test('session movement, reopening, soft deletion and restoration keep provenance and old bytes',async()=>{
  const f=await projectFixture(),before=snapshot(f.tree);
  let project=await moveProjectRecordings(f.project,f.session.id,f.project.data.interviews[1].id,[f.source.id]);
  const session=project.data.interviews[1];project=await trashProjectInterview(project,session.id);
  project=await openProject(project.directory);project=await restoreProjectInterview(project,project.data.sessionTrash![0].id);
  const recording=project.data.interviews.find(item=>item.id===session.id)!.recordings.find(item=>item.id===f.source.id)!;
  const view=await recordingDirectory(project,session.id,recording),manifest=(await readManifest(view,recording.file))!;
  expect(originalGroups(manifest.models)[0].models).toHaveLength(2);
  expect(manifest.models.every(model=>model.originalGroupId===f.a.model.originalGroupId)).toBe(true);
  const after=snapshot(f.tree);
  for(const [name,bytes]of Object.entries(before)) if(!name.includes('ripple-project.json')) expect(after[name],name).toEqual(bytes);
});

test.each([false,true])('partial association and colliding local IDs keep provenance without a wrong owner (legacy=%s)',async legacy=>{
  const f=await projectFixture();
  if(legacy){
    const folder=await f.dir.getDirectoryHandle(`${stemOf(f.source.file)}.transcript`),handle=await folder.getFileHandle('manifest.json');
    const raw=JSON.parse(await (await handle.getFile()).text()) as TranscriptManifest;
    raw.models=raw.models.map(({originalGroupId:_group,...model})=>{void _group;return model;});
    const writer=await handle.createWritable();await writer.write(JSON.stringify(raw));await writer.close();
  }
  const expectedGroup=(await readManifest(f.dir,f.source.file))!.models.find(model=>model.id===f.a.model.id)!.originalGroupId;
  let project=await reassignManuscript(f.project,f.session.id,f.source.id,f.target.id,f.child.model.id);
  let target=project.data.interviews[0].recordings.find(record=>record.id===f.target.id)!;
  let manifest=(await readManifest(await recordingDirectory(project,f.session.id,target),target.file))!;
  const orphan=manifest.models.find(model=>!hasVisibleOriginal(model)&&model.originalGroupId===expectedGroup)!;
  expect(orphan.id).not.toBe(f.child.model.id);expect(originalGroups(manifest.models).find(group=>group.models.includes(orphan))?.original).toBeNull();
  project=await reassignManuscript(project,f.session.id,f.source.id,f.target.id,f.a.model.id);
  target=project.data.interviews[0].recordings.find(record=>record.id===f.target.id)!;
  manifest=(await readManifest(await recordingDirectory(project,f.session.id,target),target.file))!;
  const group=originalGroups(manifest.models).find(group=>group.original?.originalGroupId===expectedGroup)!;
  expect(group.models).toHaveLength(2);expect(group.original?.id).not.toBe(f.a.model.id);
});

test('removing and restoring a source original preserves its separately stored editing versions and regrouping',async()=>{
  const f=await projectFixture();
  let project=await trashProjectMaterial(f.project,f.session.id,f.source.id,{modelId:f.a.model.id});
  let recording=project.data.interviews[0].recordings.find(record=>record.id===f.source.id)!;
  let manifest=(await readManifest(await recordingDirectory(project,f.session.id,recording),recording.file))!;
  expect(originalGroups(manifest.models)[0].original).toBeNull();expect(manifest.models[0].originalGroupId).toBe(f.a.model.originalGroupId);
  project=await restoreProjectTrashItem(project,project.data.trash![0].id);
  recording=project.data.interviews[0].recordings.find(record=>record.id===f.source.id)!;
  manifest=(await readManifest(await recordingDirectory(project,f.session.id,recording),recording.file))!;
  expect(originalGroups(manifest.models)[0].models).toHaveLength(2);
});
