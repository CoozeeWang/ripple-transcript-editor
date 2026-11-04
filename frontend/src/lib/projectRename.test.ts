// Synthetic projects only: metadata rename must never touch audio, text or annotations.
import { msg, setInterfaceLanguage } from '../i18n';
import { expect, it, vi } from 'vitest';
import { projectConnectorFixture } from '../testUtils/syntheticProjectConnector';
import { ProjectAIConnector } from './projectAIConnector';
import { createModel, readManifest } from '../localStore';
import { recordingDirectory } from './projectStore';

async function fixture() {
  const f = await projectConnectorFixture(true);
  f.project = {...f.project!,data:{...f.project!.data,interviews:[...f.project!.data.interviews,{id:'empty',title:'Empty synthetic session',recordings:[]}]}};
  f.fs.files.set('ripple-project.json',new File([JSON.stringify(f.project.data)],'ripple-project.json'));
  const onRenamed=vi.fn();
  const connector = new ProjectAIConnector(f.active,()=>({project:()=>f.project,
    active:()=>({interview_id:'session-a',recording_id:'recording-session-a',version_id:'m1:e1',directory:f.dirA}),
    publishTagProject:async project=>{f.project=project;},onRenamed}));
  const request=(type:string,extra={})=>({target_type:type,project_id:'synthetic-project',expected_name:'Synthetic project',new_name:'Renamed synthetic',...extra});
  const version=(id='m1:e1',extra={})=>request('transcript',{interview_id:'session-b',recording_id:'recording-session-b',version_id:id,expected_name:id.endsWith('original')?msg('VersionPicker.m1085',{name:'Synthetic model'}):'Synthetic v1',...extra});
  return {f,connector,request,version,onRenamed};
}
async function files(dir:FileSystemDirectoryHandle,prefix=''):Promise<Record<string,string>> {
  const result:Record<string,string>={};
  for await(const [name,handle] of (dir as unknown as {entries():AsyncIterable<[string,FileSystemHandle]>}).entries()){
    if(handle.kind==='directory')Object.assign(result,await files(handle as FileSystemDirectoryHandle,`${prefix}${name}/`));
    else result[`${prefix}${name}`]=await(await(handle as FileSystemFileHandle).getFile()).text();
  }
  return result;
}
it('lists empty sessions and renames project/session names without touching material files',async()=>{
  const {f,connector,request}=await fixture(),before=await files(f.fs.handle);
  expect(await connector.handle('project_sessions',{})).toMatchObject({sessions:expect.arrayContaining([{interview_id:'empty',name:'Empty synthetic session'}])});
  expect(await connector.handle('rename_project_item',request('project'))).toMatchObject({saved:true,changed:true,name:'Renamed synthetic'});
  expect(await connector.handle('rename_project_item',request('session',{interview_id:'empty',expected_name:'Empty synthetic session',new_name:'新场次'}))).toMatchObject({saved:true});
  const after=await files(f.fs.handle);
  for(const [path,value] of Object.entries(before))if(path!=='ripple-project.json')expect(after[path]).toBe(value);
  expect(f.project!.data.interviews.at(-1)?.title).toBe('新场次');
});
it.each(['m1:original','m1:e1'])('renames exactly %s and preserves every content file and original association',async id=>{
  const {f,connector,version,onRenamed}=await fixture(),before=await files(f.fs.handle);
  const original=await readManifest(f.dirB,'session-b.wav');
  expect(await connector.handle('rename_project_item',version(id))).toMatchObject({saved:true,changed:true,content_unchanged:true,paths_unchanged:true});
  const next=await readManifest(f.dirB,'session-b.wav');
  expect(next!.models[0].originalGroupId).toBe(original!.models[0].originalGroupId);
  const after=await files(f.fs.handle);
  expect(Object.keys(after).filter(path=>!path.endsWith('.bak'))).toEqual(Object.keys(before).filter(path=>!path.endsWith('.bak')));
  for(const [path,value] of Object.entries(before))if(!path.endsWith('manifest.json'))expect(after[path]).toBe(value);
  expect(f.active.publish).not.toHaveBeenCalled();expect(onRenamed).toHaveBeenCalledOnce();
  const directory=await connector.handle('project_directory',{});
  expect((directory.candidates as {versions:{id:string;name:string}[]}[])[1].versions.find(v=>v.id===id)?.name).toContain('Renamed synthetic');
});
it('retries as a no-op and refuses stale names, ambiguous IDs, invalid names and cross-project targets',async()=>{
  const {f,connector,request,version}=await fixture();
  await connector.handle('rename_project_item',version());const before=await files(f.fs.handle);
  expect(await connector.handle('rename_project_item',version())).toMatchObject({saved:true,changed:false});
  for(const args of [version('m1:e1',{new_name:'Another name'}),version('missing'),request('project',{project_id:'other'}),request('project',{new_name:' '}),request('project',{new_name:'x\ny'}),request('project',{recording_id:'extra'}),request('segment')])await expect(connector.handle('rename_project_item',args)).rejects.toThrow();
  expect(await files(f.fs.handle)).toEqual(before);
});
it('rejects new duplicate session names while permitting existing duplicates to be resolved',async()=>{
  const {f,connector,request}=await fixture(),before=await files(f.fs.handle);
  await expect(connector.handle('rename_project_item',request('session',{interview_id:'empty',expected_name:'Empty synthetic session',new_name:'Synthetic duplicate session'}))).rejects.toThrow();
  expect(await files(f.fs.handle)).toEqual(before);
  await connector.handle('rename_project_item',request('session',{interview_id:'session-a',expected_name:'Synthetic duplicate session',new_name:'Resolved synthetic session'}));
  expect(f.project!.data.interviews[1].title).toBe('Synthetic duplicate session');
});
it('renames an audio title without renaming its physical file or changing fingerprint',async()=>{
  const {f,connector,request}=await fixture();
  const audio={...f.project!.data.interviews[0].recordings[0],storage:'copy' as const,fingerprint:'21:'+ 'a'.repeat(64)};
  f.project!.data.interviews[0].recordings[0]=audio;
  f.fs.files.set('ripple-project.json',new File([JSON.stringify(f.project!.data)],'ripple-project.json'));
  const dir=await recordingDirectory(f.project!,'session-a',audio);const media=await dir.getDirectoryHandle('media',{create:true});
  const writer=await(await media.getFileHandle(audio.file,{create:true})).createWritable();await writer.write('Synthetic audio bytes');await writer.close();
  await connector.handle('rename_project_item',request('audio',{interview_id:'session-a',recording_id:audio.id,expected_name:audio.name,new_name:'合成音频标题'}));
  expect(f.project!.data.interviews[0].recordings[0]).toEqual({...audio,name:'合成音频标题'});
  expect(await(await(await media.getFileHandle(audio.file)).getFile()).text()).toBe('Synthetic audio bytes');
});
it('rejects affected AI leases but allows unrelated session metadata',async()=>{
  const {f,connector,request,version}=await fixture();
  connector.editing.acquire('synthetic-task','chatgpt',{...f.current,target:{project_id:'synthetic-project',project:'Synthetic',interview_id:'session-b',interview:'B',recording_id:'recording-session-b',recording:'B',version_id:'m1:e1',version:'V1'}},'text',2);
  await expect(connector.handle('rename_project_item',version())).rejects.toThrow('rename_target_in_use');
  await expect(connector.handle('rename_project_item',request('project'))).rejects.toThrow('rename_target_in_use');
  await connector.handle('rename_project_item',request('session',{interview_id:'empty',expected_name:'Empty synthetic session'}));
});

it('retains old metadata and emits no successful UI update when saving fails',async()=>{
 const {f,connector,request,onRenamed}=await fixture();
 const before=f.fs.files.get('ripple-project.json');
 f.fs.fail(name=>name==='ripple-project.json');
 await expect(connector.handle('rename_project_item',request('project'))).rejects.toThrow('synthetic_write_failure');
 expect(f.fs.files.get('ripple-project.json')).toBe(before);
 expect(f.project!.data.title).toBe('Synthetic project');expect(onRenamed).not.toHaveBeenCalled();
});
it('blocks an unavailable original version and conflicting version labels',async()=>{
 const {f,connector,version}=await fixture(),before=await files(f.fs.handle);
 await expect(connector.handle('rename_project_item',version('m1:original',{new_name:'Synthetic v1'}))).rejects.toThrow();
 await expect(connector.handle('rename_project_item',version('m9:original'))).rejects.toThrow('target_version_unavailable');
 expect(await files(f.fs.handle)).toEqual(before);
});
it('stops if the workspace changes while entering the write and releases its busy guard',async()=>{
 const {f,request}=await fixture();const original=f.project!,end=vi.fn();
 const connector=new ProjectAIConnector(f.active,()=>({project:()=>f.project,
 active:()=>({interview_id:'',recording_id:'',version_id:null,directory:f.dirA}),
 beginRename:()=>{f.project=null;return end;}}));
 await expect(connector.handle('rename_project_item',request('project'))).rejects.toThrow('rename_project_changed');
 expect(JSON.parse(await f.fs.files.get('ripple-project.json')!.text()).title).toBe(original.data.title);
 expect(end).toHaveBeenCalledOnce();
});
it('reports durable success even when view publication fails, allowing a safe reread',async()=>{
 const {f,request}=await fixture();
 const connector=new ProjectAIConnector(f.active,()=>({project:()=>f.project,
 active:()=>({interview_id:'',recording_id:'',version_id:null,directory:f.dirA}),
 publishTagProject:async()=>{throw Error('synthetic_view_failure');}}));
 expect(await connector.handle('rename_project_item',request('project'))).toMatchObject({saved:true,view_updated:false});
 expect(await connector.handle('project_sessions',{})).toMatchObject({project:'Renamed synthetic'});
});

it('checks collisions against raw original labels rather than their read-only decoration',async()=>{
 const {f,connector,version}=await fixture();
 await createModel(f.dirB,'session-b.wav',{engine:'synthetic',label:'Other original',transcript:f.current.transcript,original:f.current.transcript,originalOnly:true});
 await expect(connector.handle('rename_project_item',version('m1:original',{new_name:'Other original'}))).rejects.toThrow();
});

it('refreshes target names on new reads after a cached target has been renamed',async()=>{
 const {connector,request}=await fixture();
 const target={interview_id:'session-b',recording_id:'recording-session-b',version_id:'m1:e1'};
 expect(await connector.handle('read_project',target)).toMatchObject({target:{project:'Synthetic project'}});
 await connector.handle('rename_project_item',request('project'));
 expect(await connector.handle('read_project',target)).toMatchObject({target:{project:'Renamed synthetic'}});
});

it.each(['zh-CN','zh-TW','en'] as const)('preserves user names and original identity in %s',async language=>{
 await setInterfaceLanguage(language);
 try {
  const {f,connector,version}=await fixture();
  const name='Synthetic 合成 · 访谈';
  expect(await connector.handle('rename_project_item',version('m1:original',{new_name:name}))).toMatchObject({saved:true,name});
  expect((await readManifest(f.dirB,'session-b.wav'))!.models[0].label).toBe(name);
  expect(await connector.handle('rename_project_item',version('m1:original',{new_name:name}))).toMatchObject({changed:false});
 } finally {await setInterfaceLanguage('zh-CN');}
});
