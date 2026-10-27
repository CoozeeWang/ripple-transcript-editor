import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {addInterview,addRecordings,createProject,openProject,recordingDirectory,trashProjectInterview,restoreProjectInterview} from './projectStore';
import {createEdit,createModel} from '../localStore';

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
  const transcript={audio:{filename:recording.file,duration:2},speakers:[],segments:[{id:'s1',speaker_id:'sp',start:0,end:2,text:'Synthetic original',annotations:[{id:'a1',text:'Synthetic annotation',createdAt:'2026-01-01T00:00:00Z'}]}]};
  const made=await createModel(view,recording.file,{engine:'synthetic',transcript,original:transcript});
  await createEdit(view,recording.file,made.model.id,{fromOriginal:true,label:'Synthetic copy'});
  const before=await bytes(temporary);
  const deleted=await trashProjectInterview(project,session.id);
  expect(await bytes(temporary)).toEqual(before);
  const reopened=await openProject(diskDirectory(join(temporary,'Synthetic project.ripple')));
  const restored=await restoreProjectInterview(reopened,deleted.data.sessionTrash![0].id);
  expect(restored.data.interviews).toEqual(project.data.interviews);
  expect(await bytes(temporary)).toEqual(before);
  expect(new Uint8Array(await readFile(join(temporary,'inputs','Synthetic.wav')))).toEqual(original);
 }finally{await rm(temporary,{recursive:true,force:true});}
});
