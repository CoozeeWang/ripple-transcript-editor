import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {addInterview,addRecordings,createProject,openProject,recordingDirectory,saveProject,trashProjectInterview,restoreProjectInterview} from './projectStore';
import {createEdit,createModel,readModelEdit,saveActiveEdit,readModelOriginal} from '../localStore';
import {setTagPath,renameTagLeaf,removeTagNode,removeTagBranch,tagPath,removeTagGroup,transferTagGroup} from './tags';

const fileError=(error:unknown)=>{throw (error as NodeJS.ErrnoException).code==='ENOENT'?new DOMException('Synthetic missing file','NotFoundError'):error;};

/** Test-only File System Access adapter over disposable real files; path.join works on both platforms. */
function diskDirectory(path:string):FileSystemDirectoryHandle {
 const fileHandle=async(name:string,options?:{create?:boolean})=>{
  const file=join(path,name);
  try{await stat(file);}catch(error){if(!options?.create)fileError(error);await writeFile(file,'');}
  return {kind:'file',name,getFile:async()=>new File([new Uint8Array(await readFile(file))],name),createWritable:async()=>{
   const chunks:BlobPart[]=[];
   const write=async(chunk:BlobPart)=>{chunks.push(chunk);};
   const close=async()=>{await writeFile(file,new Uint8Array(await new Blob(chunks).arrayBuffer()));};
   return Object.assign(new WritableStream({write,close}),{write,close});
  }} as unknown as FileSystemFileHandle;
 };
 return {kind:'directory',name:path.split(/[\\/]/).at(-1)!,getFileHandle:fileHandle,
  getDirectoryHandle:async(name:string,options?:{create?:boolean})=>{const folder=join(path,name);if(options?.create)await mkdir(folder,{recursive:true});else try{await stat(folder);}catch(error){fileError(error);}return diskDirectory(folder);},
  removeEntry:async(name:string,options?:{recursive?:boolean})=>{await rm(join(path,name),{recursive:options?.recursive});},
  async *entries(){for(const entry of await readdir(path,{withFileTypes:true}))yield[entry.name,entry.isDirectory()?diskDirectory(join(path,entry.name)):await fileHandle(entry.name)];},
 } as unknown as FileSystemDirectoryHandle;
}
async function bytes(path:string,prefix=''):Promise<Record<string,string>>{
 const result:Record<string,string>={};
 for(const entry of await readdir(path,{withFileTypes:true})){
  if(entry.name.startsWith('ripple-project.json'))continue;
  const child=join(path,entry.name);
  if(entry.isDirectory())Object.assign(result,await bytes(child,`${prefix}${entry.name}/`));
  else result[`${prefix}${entry.name}`]=(await readFile(child)).toString('base64');
 }
 return result;
}
it('deletes, closes, reopens and restores real synthetic files with byte-identical originals and all versions',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'ripple-session-trash-'));
 try{
  await mkdir(join(temporary,'inputs'));const input=diskDirectory(join(temporary,'inputs'));
  const original=new Uint8Array([82,73,70,70,0,1,2,3,4,5,6,7]);await writeFile(join(temporary,'inputs','Synthetic.wav'),original);
  let project=await createProject(diskDirectory(temporary),'Synthetic project');
  project=await addInterview(project,'Synthetic session');
  const session=project.data.interviews[0];
  project=await addRecordings(project,session.id,[await input.getFileHandle('Synthetic.wav')],'copy');
  const recording=project.data.interviews[0].recordings[0],view=await recordingDirectory(project,session.id,recording);
  const transcript={audio:{filename:recording.file,duration:2},speakers:[],segments:[{id:'s1',speaker_id:'sp',start:0,end:2,text:'Synthetic original',tagIds:['tag-a'],annotations:[{id:'a1',text:'Synthetic annotation',createdAt:'2026-01-01T00:00:00Z'}]}]};
  const made=await createModel(view,recording.file,{engine:'synthetic',transcript,original:transcript});
 const copy=await createEdit(view,recording.file,made.model.id,{fromOriginal:true,label:'Synthetic copy'});
 const copied=await readModelEdit(view,recording.file,made.model.id,copy.edit.id);
 expect(copied!.transcript.segments[0].tagIds).toEqual(['tag-a']);
 await saveActiveEdit(view,recording.file,made.model.id,copy.edit.id,{...copied!,transcript:{...copied!.transcript,segments:copied!.transcript.segments.map(segment=>({...segment,tagIds:['tag-b']}))}});
 project=await saveProject(project,{...project.data,tagLibrary:{schemaVersion:1,tags:[{id:'tag-a',name:'Synthetic original topic',groupIds:[]},{id:'tag-b',name:'Synthetic copied topic',groupIds:[]}],groups:[]}});
 const defined={...project.data.tagLibrary!,groups:[{id:'parent',name:'Synthetic parent',parentId:null},{id:'child',name:'Synthetic child',parentId:'parent'},{id:'target',name:'Synthetic target',parentId:null}],tags:project.data.tagLibrary!.tags.map(tag=>({...tag,groupIds:['parent','child']}))};
 project=await saveProject(project,{...project.data,tagLibrary:defined});const manuscriptBytes=await bytes(temporary);
 for(const scope of ['level','tree'] as const){
  const changed=removeTagGroup(defined,'parent',scope);project=await saveProject(project,{...project.data,tagLibrary:changed});
  project=await openProject(project.directory);expect(project.data.tagLibrary).toEqual(changed);expect(await bytes(temporary)).toEqual(manuscriptBytes);
  project=await saveProject(project,{...project.data,tagLibrary:defined});
 }
 for(const copy of [false,true]){
  const changed=transferTagGroup(defined,'tag-a','parent','target',copy);project=await saveProject(project,{...project.data,tagLibrary:changed});
  project=await openProject(project.directory);expect(project.data.tagLibrary).toEqual(changed);expect(await bytes(temporary)).toEqual(manuscriptBytes);
  project=await saveProject(project,{...project.data,tagLibrary:defined});
 }
 const hierarchy=setTagPath(setTagPath(defined,'Synthetic hierarchy/Synthetic parent','tag-a').library,'Synthetic hierarchy/Synthetic parent/Synthetic child','tag-b').library;
 project=await saveProject(project,{...project.data,tagLibrary:hierarchy});project=await openProject(project.directory);expect(project.data.tagLibrary).toEqual(hierarchy);expect(await bytes(temporary)).toEqual(manuscriptBytes);
 const renamedHierarchy=renameTagLeaf(hierarchy,'tag-a','Synthetic renamed parent');project=await saveProject(project,{...project.data,tagLibrary:renamedHierarchy});project=await openProject(project.directory);expect(tagPath(project.data.tagLibrary!,'tag-b')).toBe('Synthetic hierarchy/Synthetic renamed parent/Synthetic child');expect(await bytes(temporary)).toEqual(manuscriptBytes);
 const lifted=removeTagNode(renamedHierarchy,'tag-a');project=await saveProject(project,{...project.data,tagLibrary:lifted});project=await openProject(project.directory);expect(tagPath(project.data.tagLibrary!,'tag-b')).toBe('Synthetic hierarchy/Synthetic child');expect(project.data.tagLibrary!.tags.find(t=>t.id==='tag-b')?.groupIds).toEqual(['parent','child']);expect(await bytes(temporary)).toEqual(manuscriptBytes);
 const branch=removeTagBranch(renamedHierarchy,renamedHierarchy.tags.find(tag=>tag.name==='Synthetic hierarchy')!.id);project=await saveProject(project,{...project.data,tagLibrary:branch});project=await openProject(project.directory);expect(project.data.tagLibrary!.tags).toEqual([]);expect(project.data.tagLibrary!.groups).toEqual(defined.groups);expect(await bytes(temporary)).toEqual(manuscriptBytes);
 project=await saveProject(project,{...project.data,tagLibrary:defined});
 const renamed={...defined,tags:defined.tags.map(tag=>tag.id==='tag-a'?{...tag,name:'Synthetic renamed topic'}:tag)};
 project=await saveProject(project,{...project.data,tagLibrary:renamed});
 project=await openProject(project.directory);expect(project.data.tagLibrary).toEqual(renamed);expect(await bytes(temporary)).toEqual(manuscriptBytes);
 project=await saveProject(project,{...project.data,tagLibrary:defined});
 expect((await readModelOriginal(view,recording.file,made.model.id))!.transcript.segments[0].tagIds).toEqual(['tag-a']);
 expect((await readModelEdit(view,recording.file,made.model.id,made.model.edits[0].id))!.transcript.segments[0].tagIds).toEqual(['tag-a']);

  const before=await bytes(temporary);
  const deleted=await trashProjectInterview(project,session.id);
  expect(await bytes(temporary)).toEqual(before);
  const reopened=await openProject(diskDirectory(join(temporary,'Synthetic project.ripple')));
  const restored=await restoreProjectInterview(reopened,deleted.data.sessionTrash![0].id);
  expect(restored.data.interviews).toEqual(project.data.interviews);
  expect(restored.data.tagLibrary).toEqual(project.data.tagLibrary);
  expect(await bytes(temporary)).toEqual(before);
  expect(new Uint8Array(await readFile(join(temporary,'inputs','Synthetic.wav')))).toEqual(original);
 }finally{await rm(temporary,{recursive:true,force:true});}
});
