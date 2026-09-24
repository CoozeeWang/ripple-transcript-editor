// Isolated synthetic feedback scenarios. Every fetch is intercepted; no real engine or files.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProcessNotice} from '../src/components/ProcessNotice';
import {ProcessingNotice} from '../src/components/ProcessingNotice';
import {TranscriptionDialog} from '../src/TranscriptionDialog';
import {AIEditingDialog,type AIReviewDraft} from '../src/components/AIEditingDialog';
import type {ProviderInfo,Transcript} from '../src/types';
import '../src/styles.css';
const provider:ProviderInfo={id:'qa',name:'合成转录引擎',configured:true,models:[],credential_fields:[],capabilities:{diarization:true,language_selection:true,speaker_count_hint:true,audio_events:true,word_timestamps:true}};
const providers=[provider];
const transcript:Transcript={audio:{filename:'合成访谈.wav',duration:30},speakers:[{id:'s',name:'采访者'}],segments:Array.from({length:3},(_,i)=>({id:`s${i}`,speaker_id:'s',start:i*10,end:(i+1)*10,text:'这是合成访谈内容，保留原话。'.repeat(220)}))};
let scenario='',attempts=0,editCalls=0,draft:AIReviewDraft|null=null;
let releaseRead:(()=>void)|undefined;
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
window.fetch=async(input,init)=>{
 const path=String(input);
 if(path.endsWith('/credentials')){
  attempts++;
  if(scenario==='config-failure'&&attempts===1)return response({detail:'模拟配置读取失败'},503);
  if(scenario==='config-loading')await new Promise<void>(resolve=>{releaseRead=resolve;});
  return response({provider_id:'qa',active_profile_id:'p',profiles:[{id:'p',name:'合成配置',active:true,is_default:true,field_keys_present:[],public_values:{}}]});
 }
 if(path.endsWith('/config')){
  if(scenario==='ai-load-failure'&&attempts++===0)return response({detail:'无法读取编辑引擎配置（模拟）'},503);
  return response({configured:true,has_key:true,model:'qa',selected_engine_id:'qa',engines:[{id:'qa',name:'合成编辑引擎',model:'qa'}]});
 }
 if(path.endsWith('/preferences')||path.endsWith('/plans'))return response([]);
 if(path.endsWith('/edit')){
  editCalls++;
  if(scenario==='ai-cancel')await new Promise((_,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
  if(scenario==='ai-recovery'&&editCalls===2)return response({detail:'第二批连接中断（模拟）；已完成批次保留。'},502);
  const body=JSON.parse(String(init?.body));
  return response({segments:body.segments.map((s:{id:string;text:string})=>({...s,reason:'合成建议',text:s.text.replace('这是','这里是')}))});
 }
 return response({detail:'未模拟此接口'},404);
};
export function Preview(){
 const [mode,setMode]=useState('idle'),[open,setOpen]=useState(false),[note,setNote]=useState('');
 const choose=(value:string)=>{scenario=value;attempts=0;editCalls=0;draft=null;setNote('');setMode(value);setOpen(true);};
 const ai=mode.startsWith('ai-');
 const running=['uploading','processing','saving'].includes(mode);
 return <main style={{padding:24,maxWidth:1100,margin:'auto'}}><h1>B4 反馈状态验收</h1><p>合成数据和模拟响应，不访问真实服务、不改动项目文件。</p>
 <label>验收场景 <select aria-label="验收场景" value={mode} onChange={e=>choose(e.target.value)}>
 {Object.entries({idle:'请选择',uploading:'上传进度',processing:'长时间识别',saving:'保存中',failure:'转录失败', 'config-loading':'配置读取中','config-failure':'配置读取失败重试','no-audio':'没有音频','ai-load-failure':'AI 读取失败重试','ai-cancel':'AI 运行与取消','ai-recovery':'AI 分批失败与恢复'}).map(([v,t])=><option key={v} value={v}>{t}</option>)}
 </select></label> <button className="button" onClick={()=>setOpen(true)}>重新打开当前弹窗</button> {mode==='config-loading'&&<button onClick={()=>releaseRead?.()}>完成模拟读取</button>}
 {note&&<p role="status">{note}</p>}
 {(running||mode==='failure'||mode==='cancelled')&&<div style={{marginTop:32}}><ProcessNotice card={mode!=='cancelled'} status={running?'transcribing':mode==='failure'?'error':'idle'} phase={mode==='uploading'?'sending':mode} ratio={.42} engine="合成引擎 · 长访谈" elapsed={425} text={mode==='cancelled'?'已停止等待转录结果，可重新开始以领取原任务结果。':'无法连接 Ripple 本地服务（模拟）'} hint="请重新启动 Ripple 后重试。" raw="" cancelTranscription={()=>setMode('cancelled')} setTranscriptionDialogOpen={()=>{setMode('no-audio');setOpen(true);}} setSaveToast={t=>setNote(t.text)}/></div>}
 {mode==='saving'&&<ProcessingNotice>正在保存转录稿…</ProcessingNotice>}
 {open&&['config-loading','config-failure','no-audio'].includes(mode)&&<TranscriptionDialog key={mode} providers={providers} defaultProviderId="qa" selectedProviderId="qa" onSelectProvider={()=>{}} hasAudio={mode!=='no-audio'} audioFilename="合成访谈.wav" busy={false} onClose={()=>setOpen(false)} onStart={async()=>{setNote('模拟开始入口已触发，没有调用真实转录服务。');setOpen(false);}}/>}
 {open&&ai&&<AIEditingDialog key={mode} transcript={transcript} source="b4-synthetic" selectedId="s0" sourceLabel="合成修改稿" loadOriginal={async()=>transcript} loadDraft={async()=>draft} saveDraft={async value=>{draft=value;}} onClose={()=>setOpen(false)} onSettings={()=>{setNote('已触发设置入口（模拟）。');setOpen(false);}} onApply={async()=>{setNote('已确认完整 AI 结果（仅模拟，不写文件）。');setOpen(false);}}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
