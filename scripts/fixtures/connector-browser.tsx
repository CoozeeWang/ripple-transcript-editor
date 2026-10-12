// Synthetic browser filesystem fixture; imports are expanded by connector-browser-check.mjs.
import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '__REPO__/frontend/src/App.tsx';
import {createModel, saveActiveEdit, readManifest, readModelEdit, readModelOriginal} from '__REPO__/frontend/src/localStore.ts';
import '__REPO__/frontend/src/styles.css';
interface TestDirectory { handle: FileSystemDirectoryHandle; files: Map<string, File>; dirs: Map<string, TestDirectory> }
function directory(name = 'root'): TestDirectory {
  const files = new Map<string, File>(); const dirs = new Map<string, TestDirectory>();
  const missing = () => new DOMException('missing', 'NotFoundError');
  const getFileHandle = async (fileName: string, options?: { create?: boolean }) => {
    if (!files.has(fileName)) { if (!options?.create) throw missing(); files.set(fileName, new File([], fileName)); }
    return { kind: 'file', name: fileName, getFile: async () => { const file = files.get(fileName); if (!file) throw missing(); return file; },
      createWritable: async () => {
        const chunks: BlobPart[] = [];
        const write = async (chunk: BlobPart) => { chunks.push(chunk); };
        const close = async () => { files.set(fileName, new File(chunks, fileName)); };
        const stream = new WritableStream({ write, close });
        return Object.assign(stream, { write, close });
      },
    } as unknown as FileSystemFileHandle;
  };
  const handle = { kind: 'directory', name, getFileHandle,
    getDirectoryHandle: async (key: string, options?: { create?: boolean }) => {
      if (!dirs.has(key)) { if (!options?.create) throw missing(); dirs.set(key, directory(key)); }
      return dirs.get(key)!.handle;
    },
    removeEntry: async (key: string) => { files.delete(key); dirs.delete(key); },
    async *entries() { for (const name of files.keys()) yield [name, await getFileHandle(name)]; for (const [name, dir] of dirs) yield [name, dir.handle]; },
  } as unknown as FileSystemDirectoryHandle;
  return { handle, files, dirs };
}

const root=directory('Synthetic connector fixture');
const wav=new Uint8Array(44+8000*30*2), view=new DataView(wav.buffer);
for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as [number,string][]) [...text].forEach((c,i)=>wav[offset+i]=c.charCodeAt(0));
view.setUint32(4,wav.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,wav.length-44,true);
root.files.set('synthetic.wav',new File([wav],'synthetic.wav'));
const raw={audio:{filename:'synthetic.wav',duration:30},speakers:[{id:'speaker',name:'Synthetic speaker'}],segments:[
{id:'s1',speaker_id:'speaker',start:0,end:10,text:'嗯，我觉得先开始，把这份合成稿件核对清楚。',annotations:[{id:'manual',text:'合成人工批注',createdAt:'2026-01-01'}],highlights:[{id:'manual',start:0,end:1}]},
{id:'s2',speaker_id:'speaker',start:10,end:20,text:'嗯，我觉得可能还有问题，需要继续检查这个合成例子。',words:[...'嗯，我觉得可能还有问题，需要继续检查这个合成例子。'].map((text,i)=>({text,start:10+i/2,end:10+(i+1)/2}))},
{id:'s3',speaker_id:'speaker',start:20,end:30,text:'这是很重要、很重要的。'}]};
if (new URLSearchParams(location.search).has('delete-between')) {
  raw.speakers.push({id:'filler-speaker',name:'Synthetic filler speaker'});
  raw.segments[1]={...raw.segments[1],speaker_id:'filler-speaker',text:'嗯',words:[{text:'嗯',start:10,end:20}]};
}
if(new URLSearchParams(location.search).has('incremental')) {
  for(let i=3;i<60;i++)raw.segments.push({id:`s${i+1}`,speaker_id:'speaker',start:i,end:i+1,text:`Synthetic continuation segment ${i+1}`} as typeof raw.segments[number]);
}
await createModel(root.handle,'synthetic.wav',{engine:'imported',sourceKind:'import',sourceName:'Synthetic original.json',transcript:raw,original:raw,originalOnly:true,designatedOriginal:true});
const made=await createModel(root.handle,'synthetic.wav',{engine:'imported',sourceKind:'import',sourceName:'Synthetic revision.json',transcript:raw,original:raw,editLabel:'v1'});
// Reproduce a legacy import snapshot retained by existing projects; never a user version.
const transcriptDir=await root.handle.getDirectoryHandle('synthetic.transcript');
async function writeJson(name:string,value:unknown){const f=await transcriptDir.getFileHandle(name,{create:true});const w=await f.createWritable();await w.write(JSON.stringify(value));await w.close();}
made.model.original='synthetic-import-snapshot.json';
await writeJson(made.model.original,{kind:'te-imported',transcript:raw});
await writeJson('manifest.json',made.manifest);
const current=structuredClone(made.edited);
current.transcript.segments[0].text='我觉得先开始，把这份合成稿件核对清楚。';
await saveActiveEdit(root.handle,'synthetic.wav',made.model.id,made.model.edits[0].id,current);
const appRoot=createRoot(document.getElementById('root')!);let generation=0;
const render=()=>appRoot.render(<App key={generation} projectDirectory={root.handle} projectLabel="Synthetic connector fixture"/>);
(window as any).__fixture={root,raw,made,readManifest:()=>readManifest(root.handle,'synthetic.wav'),readModelEdit:(model:string,edit:string)=>readModelEdit(root.handle,'synthetic.wav',model,edit),readModelOriginal:(model:string)=>readModelOriginal(root.handle,'synthetic.wav',model),remount:()=>{generation++;render();}};
render();
