// Isolated synthetic feedback scenarios. Every fetch is intercepted; no real engine or files.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProcessNotice} from '../src/components/ProcessNotice';
import {ProcessingNotice} from '../src/components/ProcessingNotice';
import {TranscriptionDialog} from '../src/TranscriptionDialog';
import type {ProviderInfo} from '../src/types';
import '../src/styles.css';
const provider:ProviderInfo={id:'qa',name:'合成转录引擎',configured:true,models:[],credential_fields:[],capabilities:{diarization:true,language_selection:true,speaker_count_hint:true,audio_events:true,word_timestamps:true}};
const providers=[provider];
let scenario='',attempts=0;
let releaseRead:(()=>void)|undefined;
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
window.fetch=async(input)=>{
 const path=String(input);
 if(path.endsWith('/credentials')){
  attempts++;
  if(scenario==='config-failure'&&attempts===1)return response({detail:'模拟配置读取失败'},503);
  if(scenario==='config-loading')await new Promise<void>(resolve=>{releaseRead=resolve;});
  return response({provider_id:'qa',active_profile_id:'p',profiles:[{id:'p',name:'合成配置',active:true,is_default:true,field_keys_present:[],public_values:{}}]});
 }
 return response({detail:'未模拟此接口'},404);
};
export function Preview(){
 const [mode,setMode]=useState('idle'),[open,setOpen]=useState(false),[note,setNote]=useState('');
 const choose=(value:string)=>{scenario=value;attempts=0;setNote('');setMode(value);setOpen(true);};
 const running=['uploading','processing','saving'].includes(mode);
 return <main style={{padding:24,maxWidth:1100,margin:'auto'}}><h1>B4 反馈状态验收</h1><p>合成数据和模拟响应，不访问真实服务、不改动项目文件。</p>
 <label>验收场景 <select aria-label="验收场景" value={mode} onChange={e=>choose(e.target.value)}>
 {Object.entries({idle:'请选择',uploading:'上传进度',processing:'长时间识别',saving:'保存中',failure:'转录失败', 'config-loading':'配置读取中','config-failure':'配置读取失败重试','no-audio':'没有音频'}).map(([v,t])=><option key={v} value={v}>{t}</option>)}
 </select></label> <button className="button" onClick={()=>setOpen(true)}>重新打开当前弹窗</button> {mode==='config-loading'&&<button onClick={()=>releaseRead?.()}>完成模拟读取</button>}
 {note&&<p role="status">{note}</p>}
 {(running||mode==='failure'||mode==='cancelled')&&<div style={{marginTop:32}}><ProcessNotice card={mode!=='cancelled'} status={running?'transcribing':mode==='failure'?'error':'idle'} phase={mode==='uploading'?'sending':mode} ratio={.42} engine="合成引擎 · 长访谈" elapsed={425} text={mode==='cancelled'?'已停止等待转录结果，可重新开始以领取原任务结果。':'无法连接 Ripple 本地服务（模拟）'} hint="请重新启动 Ripple 后重试。" raw="" cancelTranscription={()=>setMode('cancelled')} setTranscriptionDialogOpen={()=>{setMode('no-audio');setOpen(true);}} setSaveToast={t=>setNote(t.text)}/></div>}
 {mode==='saving'&&<ProcessingNotice>正在保存转录稿…</ProcessingNotice>}
 {open&&['config-loading','config-failure','no-audio'].includes(mode)&&<TranscriptionDialog key={mode} providers={providers} defaultProviderId="qa" selectedProviderId="qa" onSelectProvider={()=>{}} hasAudio={mode!=='no-audio'} audioFilename="合成访谈.wav" busy={false} onClose={()=>setOpen(false)} onStart={async()=>{setNote('模拟开始入口已触发，没有调用真实转录服务。');setOpen(false);}}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
