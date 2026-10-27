/** Real workspace with synthetic files and local mock services only. */
import {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {AIConnectorProvider} from '../src/components/AIConnectorProvider';
import {ProjectWorkspace} from '../src/components/ProjectWorkspace';
import {addInterview,addRecordings,createProject,saveProject} from '../src/lib/projectStore';
import {msg,setInterfaceLanguage,type InterfaceLanguage} from '../src/i18n';
import {syntheticDirectory,syntheticTree,syntheticWave} from './syntheticProjectDirectory';
import '../src/styles.css';
const query=new URLSearchParams(location.search),language=(query.get('lang')||'zh-CN') as InterfaceLanguage,mode=query.get('mode')||'default';
await setInterfaceLanguage(language);
// Mock only this origin's handle database: synthetic JS handles are not native cloneable handles.
const databases=new Map<string,Map<string,Map<string,unknown>>>();
Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(name:string){
 const stores=databases.get(name)??new Map<string,Map<string,unknown>>();databases.set(name,stores);
 const request:Record<string,unknown>={};const db={close(){},transaction(store:string){
  const entries=stores.get(store)??new Map<string,unknown>();stores.set(store,entries);const tx:Record<string,unknown>={};
  const done=()=>queueMicrotask(()=>(tx.oncomplete as (()=>void))?.());
  tx.objectStore=()=>({get(key:string){const req={result:entries.get(key)};done();return req;},put(value:unknown,key:string){entries.set(key,value);done();return{};},delete(key:string){entries.delete(key);done();return{};}});return tx;
 }};queueMicrotask(()=>{request.result=db;(request.onsuccess as (()=>void))?.();});return request;
}}});
let blocked=false;const tree=syntheticTree(),root=syntheticDirectory(tree,'Synthetic selected folder',()=>blocked);
let project=await createProject(root,'Synthetic sidebar project');
if(mode!=='empty'){
 for(let i=1;i<=24;i++)project=await addInterview(project,mode==='long'&&i===1?'Synthetic session 01 with a long descriptive name that wraps across several lines':`Synthetic session ${String(i).padStart(2,'0')}`);
 const source=await root.getDirectoryHandle('synthetic-inputs',{create:true}),handles:FileSystemFileHandle[]=[];
 for(let i=1;i<=6;i++){const file=await source.getFileHandle(`Synthetic recording ${i}.wav`,{create:true}),write=await file.createWritable();await write.write(syntheticWave());await write.close();handles.push(file);}
 project=await addRecordings(project,project.data.interviews[0].id,handles,'copy');
 if(mode==='long')project=await saveProject(project,{...project.data,title:'Synthetic project with a long title and multiline notes',description:Array.from({length:10},(_,i)=>`Synthetic project note ${i+1}`).join('\n')});
}
Object.assign(window,{showDirectoryPicker:async()=>project.directory,showOpenFilePicker:async()=>mode==='busy'?new Promise(()=>{}):[]});
window.fetch=async()=>new Response(JSON.stringify({configured:false,engines:[],default_engine_id:null,providers:[],profiles:[]}),{headers:{'Content-Type':'application/json'}});
localStorage.setItem('ripple-open-last-project','0');localStorage.setItem('ripple-mcp-enabled','0');
export function Harness(){
 useEffect(()=>{const timer=setTimeout(()=>window.dispatchEvent(new Event('ripple-open-project')),50);return()=>clearTimeout(timer);},[]);
 useEffect(()=>{
  if(query.get('review')!=='1')return;
  let phase=0,published=false,timer:number|undefined,headerTop=0,canvasTop=0;
  const inspect=()=>{
   if(published)return;
   const board=document.querySelector('.project-home--board'),list=document.querySelector<HTMLElement>('.setup-session-list'),canvas=document.querySelector<HTMLElement>('.setup-canvas'),heading=document.querySelector<HTMLElement>('.setup-sidebar-heading'),plus=document.querySelector<HTMLButtonElement>('.setup-session-add');
   if(!board||!list||!canvas||!heading||!plus||board.getAttribute('aria-busy')==='true')return;
   if(phase===0){phase=1;headerTop=heading.getBoundingClientRect().top;canvasTop=canvas.getBoundingClientRect().top;
    if(mode==='left'||mode==='right'){(mode==='left'?list:canvas).scrollTo({top:500,behavior:'instant'});requestAnimationFrame(()=>requestAnimationFrame(inspect));return;}
    if(mode==='busy'){document.querySelector<HTMLButtonElement>('.setup-canvas > .setup-new')?.click();return;}
    if(mode==='new'||mode==='error'){plus.click();return;}
   }
   if(mode==='busy'&&!plus.disabled)return;
   if((mode==='new'||mode==='error')&&!document.querySelector('.setup-session-form'))return;
   if(mode==='error'&&phase===1){phase=2;const title=document.querySelector<HTMLElement>('.setup-session-form h2 [role="button"]');title?.click();return;}
   if(mode==='error'&&phase===2){const input=document.querySelector<HTMLInputElement>('.setup-session-form h2 input');if(!input)return;phase=3;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Synthetic retained draft');input.dispatchEvent(new Event('input',{bubbles:true}));requestAnimationFrame(inspect);return;}
   if(mode==='error'&&phase===3){const input=document.querySelector<HTMLInputElement>('.setup-session-form h2 input');if(!input)return;phase=4;input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return;}
   if(mode==='error'&&phase===4){const submit=document.querySelector<HTMLButtonElement>('.setup-confirm-actions button:last-child');if(!submit||submit.disabled)return;phase=5;blocked=true;submit.click();return;}
   if(mode==='error'&&(!document.querySelector('[role="alert"]')||plus.disabled))return;
   const h=heading.getBoundingClientRect(),l=list.getBoundingClientRect(),c=canvas.getBoundingClientRect();
   const exp=document.querySelector<HTMLElement>('.project-title-actions .icon-button'),del=document.querySelector<HTMLElement>('.project-session-delete');
   const aligned=!exp||!del||Math.abs(exp.getBoundingClientRect().right-del.getBoundingClientRect().right)<1;
   const fixed=!['left','right'].includes(mode)||(Math.abs(h.top-headerTop)<1&&Math.abs(c.top-canvasTop)<1);
   const independent=mode==='left'?list.scrollTop>0&&canvas.scrollTop===0:mode==='right'?canvas.scrollTop>0&&list.scrollTop===0:true;
   const bounded=l.bottom<=innerHeight+1&&c.bottom<=innerHeight+1&&l.height>0&&c.height>0&&document.documentElement.scrollHeight<=innerHeight+1;
   const value={status:fixed&&independent&&bounded&&aligned&&plus.getAttribute('data-tip')===msg('ProjectBoard.m0684')?'passed':'failed',mode,language,width:innerWidth,height:innerHeight,headingY:h.top,listY:l.top,listHeight:l.height,listScroll:list.scrollTop,rightScroll:canvas.scrollTop,aligned,exportRight:exp?.getBoundingClientRect().right,deleteRight:del?.getBoundingClientRect().right,tooltip:plus.getAttribute('data-tip'),disabled:plus.disabled,windowHeight:document.documentElement.scrollHeight};
   published=true;document.querySelector('output')!.textContent=JSON.stringify(value);
   (window as unknown as {webkit?:{messageHandlers?:{review?:{postMessage:(text:string)=>void}}}}).webkit?.messageHandlers?.review?.postMessage(JSON.stringify(value));
  };
  const observer=new MutationObserver(()=>{clearTimeout(timer);timer=window.setTimeout(inspect,100);});observer.observe(document.body,{childList:true,attributes:true,subtree:true});void document.fonts.ready.then(inspect);
  return()=>{observer.disconnect();clearTimeout(timer);};
 },[]);
 return <><AIConnectorProvider><ProjectWorkspace/></AIConnectorProvider><output style={{position:'fixed',bottom:1,left:4,maxWidth:'98vw',font:'9px monospace',opacity:.45,pointerEvents:'none'}}/></>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
