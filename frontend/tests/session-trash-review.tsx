/** Isolated synthetic filesystem, persisted only in this test origin's localStorage.
 * Uses the real workspace/store; never reads user files or contacts providers. */
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectWorkspace} from '../src/components/ProjectWorkspace';
import {AIConnectorProvider} from '../src/components/AIConnectorProvider';
import {addInterview,addRecordings,createProject,openProject,trashProjectInterview,restoreProjectInterview,recordingDirectory,saveProject} from '../src/lib/projectStore';
import {createEdit,createModel,defaultMetadata} from '../src/localStore';
import {msg,setInterfaceLanguage,type InterfaceLanguage} from '../src/i18n';
import '../src/styles.css';
const query=new URLSearchParams(location.search), language=(query.get('lang')||'zh-CN') as InterfaceLanguage;
const key=`ripple-synthetic-session-trash-${language}`;
type Tree={files:Record<string,string>;dirs:Record<string,Tree>};
const empty=():Tree=>({files:{},dirs:{}});
const rootTree:Tree=JSON.parse(localStorage.getItem(key)||'null')??empty();
const persist=()=>localStorage.setItem(key,JSON.stringify(rootTree));
const missing=()=>new DOMException('Synthetic missing file','NotFoundError');
function directory(tree:Tree,name:string):FileSystemDirectoryHandle {
 const getFileHandle=async(file:string,options?:{create?:boolean})=>{
  if(!(file in tree.files)){if(!options?.create)throw missing();tree.files[file]='';persist();}
  return {kind:'file',name:file,getFile:async()=>{if(!(file in tree.files))throw missing();return new File([Uint8Array.from(atob(tree.files[file]),c=>c.charCodeAt(0))],file);},createWritable:async()=>{
   const chunks:BlobPart[]=[];const write=async(chunk:BlobPart)=>{chunks.push(chunk);};
   const close=async()=>{const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());tree.files[file]=btoa(Array.from(bytes,c=>String.fromCharCode(c)).join(''));persist();};
   const stream=new WritableStream({write,close});return Object.assign(stream,{write,close,abort:async()=>{}});
  }} as unknown as FileSystemFileHandle;
 };
 return {kind:'directory',name,getFileHandle,queryPermission:async()=>'granted',requestPermission:async()=>'granted',
  getDirectoryHandle:async(child:string,options?:{create?:boolean})=>{if(!tree.dirs[child]){if(!options?.create)throw missing();tree.dirs[child]=empty();persist();}return directory(tree.dirs[child],child);},
  removeEntry:async(child:string)=>{delete tree.files[child];delete tree.dirs[child];persist();},
  async *entries(){for(const file of Object.keys(tree.files))yield[file,await getFileHandle(file)];for(const [child,folder]of Object.entries(tree.dirs))yield[child,directory(folder,child)];},
 } as unknown as FileSystemDirectoryHandle;
}
const root=directory(rootTree,'Synthetic test origin');
async function seed(){
 if(rootTree.dirs['Synthetic session project.ripple'])return;
 let project=await createProject(root,'Synthetic session project');project=await addInterview(project,'Synthetic session A');
 const source=await root.getDirectoryHandle('synthetic-inputs',{create:true});
 const bytes=new Uint8Array(44+16000),v=new DataView(bytes.buffer);
 const ascii=(at:number,text:string)=>[...text].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
 ascii(0,'RIFF');v.setUint32(4,bytes.length-8,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,bytes.length-44,true);
 const audio=await source.getFileHandle('Synthetic recording.wav',{create:true}),writer=await audio.createWritable();await writer.write(bytes);await writer.close();
 project=await addRecordings(project,project.data.interviews[0].id,[audio],'copy');
 const session=project.data.interviews[0],recording=session.recordings[0];
 const transcript={audio:{filename:recording.file,duration:1},speakers:[{id:'sp',name:'Synthetic speaker',colorIndex:0}],segments:[{id:'s1',speaker_id:'sp',start:0,end:1,text:'Synthetic transcript retained after session recovery.',annotations:[{id:'a1',text:'Synthetic annotation',createdAt:'2026-01-01T00:00:00Z'}]}]};
 const view=await recordingDirectory(project,session.id,recording),model=await createModel(view,recording.file,{engine:'synthetic',transcript,original:transcript,metadata:defaultMetadata(recording.name)});
 await createEdit(view,recording.file,model.model.id,{fromOriginal:true,label:'Synthetic editable version'});
 project=await addInterview(project,'Synthetic empty session B');
 await saveProject(project,{...project.data,interviews:project.data.interviews.map(item=>item.id===session.id?{...item,metadata:{...item.metadata!,recorded_at:'2026-01-01',location:'Synthetic location'}}:item)});
}
// All backend routes are local mock responses, including any incidental editor load.
window.fetch=async()=>new Response(JSON.stringify({configured:false,engines:[],default_engine_id:null,providers:[],profiles:[]}),{headers:{'Content-Type':'application/json'}});
Object.assign(window,{showDirectoryPicker:async()=>root.getDirectoryHandle('Synthetic session project.ripple')});
localStorage.setItem('ripple-mcp-enabled','0');
await seed();await setInterfaceLanguage(language);
const syntheticInputs=await root.getDirectoryHandle('synthetic-inputs',{create:true});
try{await syntheticInputs.getFileHandle('Synthetic imported manuscript.txt');}catch{
 const handle=await syntheticInputs.getFileHandle('Synthetic imported manuscript.txt',{create:true}),writer=await handle.createWritable();
 await writer.write('Synthetic standalone import keeps its source name.');await writer.close();
}
Object.assign(window,{showOpenFilePicker:async()=>[await syntheticInputs.getFileHandle('Synthetic imported manuscript.txt')]});
const review=query.get('review')==='1',mode=query.get('mode')||'default';
if(review){const project=await openProject(await root.getDirectoryHandle('Synthetic session project.ripple'));
 const active=project.data.interviews.find(session=>session.title==='Synthetic session A');
 const archived=project.data.sessionTrash?.find(item=>item.interview.title==='Synthetic session A');
 if(mode==='trash'&&active)await trashProjectInterview(project,active.id);
 else if(mode!=='trash'&&archived)await restoreProjectInterview(project,archived.id);
}
export function Harness(){
 const [proof,setProof]=useState('');
 useEffect(()=>{
  if(!review)return;
  let published=false,acted=false,timer:number|undefined;
  const inspect=()=>{
   if(published)return;
   const remove=document.querySelector<HTMLButtonElement>('.project-session-delete');
   if(!remove)return;
   if(!acted&&mode!=='default'){
    acted=true;
    const control=mode==='confirm'?remove:document.querySelector<HTMLButtonElement>(`button[aria-label="${msg('ProjectWorkspace.m0925')}"]`);
    control?.click();return;
   }
   const exp=document.querySelector<HTMLElement>('.project-title-actions .icon-button');
   const dialog=document.querySelector<HTMLDialogElement>('dialog[open]');
   if(!exp||mode!=='default'&&!dialog)return;
   const a=exp.getBoundingClientRect(),b=remove.getBoundingClientRect();
   const d=dialog?.getBoundingClientRect();
   const value={status:Math.abs(a.right-b.right)<1&&b.width<a.width&&(!d||d.left>=0&&d.right<=innerWidth&&d.top>=0&&d.bottom<=innerHeight)?'passed':'failed',language,mode,width:innerWidth,delta:b.right-a.right,deleteSize:b.width,exportSize:a.width,dialog:!!dialog};
   published=true;
   const host=window as unknown as {webkit?:{messageHandlers?:{review?:{postMessage:(text:string)=>void}}}};
   host.webkit?.messageHandlers?.review?.postMessage(JSON.stringify(value));
  };
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=window.setTimeout(inspect,100);});
  observer.observe(document.body,{childList:true,subtree:true});void document.fonts.ready.then(inspect);
  return()=>{observer.disconnect();clearTimeout(timer);};
 },[]);

 useEffect(()=>{const timer=setTimeout(()=>window.dispatchEvent(new Event('ripple-open-project')),100);return()=>clearTimeout(timer);},[]);
 const inspect=async()=>{const folder=rootTree.dirs['Synthetic session project.ripple'];const index=JSON.parse(atob(folder.files['ripple-project.json']));const material=JSON.stringify(folder.dirs);const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material)));setProof(JSON.stringify({active:index.interviews.map((s:{title:string})=>s.title),archived:(index.sessionTrash??[]).map((s:{interview:{title:string}})=>s.interview.title),materialHash:Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('')}));};
 return <div className="session-trash-harness"><style>{`.session-trash-harness{height:100vh;display:flex;flex-direction:column}.session-trash-harness>details{flex:none;padding:6px 12px}.session-trash-harness>.project-home{flex:1;min-height:0;height:auto}`}</style><details><summary>Synthetic session Trash review</summary><p>Local synthetic files only. Reload to reopen the saved index. No user projects or providers.</p><button onClick={()=>void inspect()}>Inspect synthetic index</button><output>{proof}</output></details><AIConnectorProvider><ProjectWorkspace/></AIConnectorProvider></div>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
