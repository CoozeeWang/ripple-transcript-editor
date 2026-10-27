/** Synthetic-only error review. All provider requests and file access are denied. */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { msg, setInterfaceLanguage, type InterfaceLanguage } from '../src/i18n';
import { serviceText } from '../src/i18n/serviceText';
import { apiErrorMessage } from '../src/i18n/errors';
import { useTranscription } from '../src/hooks/useTranscription';
import type { ProcessStatus } from '../src/hooks/useVersions';
import { ProcessNotice } from '../src/components/ProcessNotice';
import { recordProblem, diagnosticEnvironment } from '../src/lib/diagnostics';
import type { TranscriptionOptions } from '../src/types';
import '../src/styles.css';

const query=new URLSearchParams(location.search), mode=query.get('mode')||'limit';
await setInterfaceLanguage((query.get('lang')||'zh-CN') as InterfaceLanguage);
let networkCalls=0, fileAccess=0, writes=0;
window.fetch=async()=>{networkCalls++;throw new Error('Synthetic fixture denies network access');};
Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{document.getElementById('copied')!.textContent=text;}}});
const providers=[{id:'tencent_flash',name:'腾讯云录音文件识别（极速版）',capabilities:{max_duration_seconds:7200}}];
const directory={getFileHandle:async()=>{fileAccess++;throw new Error('Synthetic fixture denies file access');}} as unknown as FileSystemDirectoryHandle;

export function ErrorReview(){
 const [status,setStatus]=useState<ProcessStatus>('idle'),[text,setText]=useState('');
 const [decodeHint,setDecodeHint]=useState(''),[retry,setRetry]=useState(false);
 const started=useRef(false);
 const hook=useTranscription({dirHandleRef:{current:directory},selectedAudio:'Synthetic long.m4a',providers,
  confirmedAudioDuration:{audio:'Synthetic long.m4a',seconds:11169},processStatus:status,
  beforeChange:async()=>{writes++;},setProcessStatus:setStatus,setProcessMessage:setText,setActiveProviderName:()=>{},
  setMetadata:()=>{writes++;},reset:()=>{writes++;},setSelectedSegmentId:()=>{},setHasLoadedTranscript:()=>{},
  setSaveStatus:()=>{},applyManifest:()=>{writes++;},setNamingTarget:()=>{},setNamingOpen:()=>{},setNamingValue:()=>{},refreshAudioList:async()=>{},
 });
 const start=()=>{
  if(mode==='decode'){
   const message=apiErrorMessage({detail:{code:'unsupported_format',message:'Synthetic decoder rejection'}},502);
   recordProblem('transcription',Object.assign(new Error(message),{code:'unsupported_format'}));
   setText(message);setDecodeHint(msg('useTranscription.m1155'));setStatus('error');
  }else void hook.startTranscription({} as TranscriptionOptions,'tencent_flash').catch(()=>{});
 };
 useEffect(()=>{if(query.get('review')==='1'&&!started.current){started.current=true;document.querySelector<HTMLButtonElement>('#run')?.click();}},[]);
 useEffect(()=>{
  if(query.get('review')!=='1')return;
  let published=false,copyRequested=false;
  const inspect=()=>{
   if(published)return;
   const card=document.querySelector<HTMLElement>('.transcription-card--error');if(!card)return;
   if(!copyRequested){copyRequested=true;card.querySelector<HTMLButtonElement>('.diagnostic-copy button')?.click();return;}
   const copied=document.getElementById('copied')?.textContent||'';if(!copied)return;
   const primary=card.querySelector('.transcription-card-error')?.textContent||'',hint=card.querySelector('.transcription-card-hint')?.textContent||'';
   const bounds=card.getBoundingClientRect(),version=diagnosticEnvironment().version;
   const valid=networkCalls===0&&fileAccess===0&&writes===0&&copied.startsWith(`Ripple ${version}\n`)
    &&bounds.left>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight
    &&(mode==='limit'?primary.includes('03:06:09')&&primary.includes('02:00:00'):primary===msg('transcriptionErrors.decodeFailed')&&hint===msg('useTranscription.m1155'));
   const value={status:valid?'passed':'failed',mode,language:query.get('lang'),width:innerWidth,height:innerHeight,version,networkCalls,fileAccess,writes,primary,hint,copiedVersion:copied.split('\n')[0]};
   published=true;document.getElementById('result')!.textContent=JSON.stringify(value);
   (window as unknown as {webkit?:{messageHandlers?:{review?:{postMessage:(s:string)=>void}}}}).webkit?.messageHandlers?.review?.postMessage(JSON.stringify(value));
  };
  const observer=new MutationObserver(inspect);observer.observe(document.body,{subtree:true,childList:true,attributes:true});void document.fonts.ready.then(inspect);
  return()=>observer.disconnect();
 },[]);
 return <main style={{maxWidth:1000,margin:'0 auto',padding:28}}>
  <h1 style={{fontSize:24}}>Synthetic transcription error review</h1>
  <button id="run" className="cred-btn" onClick={start}>Run synthetic check</button>
  {status==='error'&&<ProcessNotice card text={text} status={status} phase="uploading" ratio={null}
   engine={serviceText(providers[0].name)} hint={mode==='decode'?decodeHint:hook.transcribeHint} raw=""
   cancelTranscription={()=>{}} setTranscriptionDialogOpen={()=>setRetry(true)} setSaveToast={()=>{}} onDismiss={()=>setStatus('idle')}/>}
  {retry&&<p role="status">Synthetic engine selection requested</p>}
  <output id="copied" aria-label="Synthetic copied diagnostic" style={{display:'block',whiteSpace:'pre-wrap',fontSize:11}}/>
  <output id="result" style={{position:'fixed',bottom:1,left:4,fontSize:9,opacity:.4,maxWidth:'98vw'}}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<ErrorReview/>);
