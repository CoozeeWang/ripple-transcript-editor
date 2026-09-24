// Development-only visual fixture. No real API requests or credential writes.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsModal } from '../src/components/SettingsModal';
import '../src/styles.css';

const fields = [
  { key: 'base_url', label: '服务地址', secret: false, required: true, default_value: 'https://example.invalid/v1' },
  { key: 'model', label: '模型名称', secret: false, required: true, options: ['qa-model'], allow_custom: true },
  { key: 'api_key', label: 'API 密钥', secret: true, required: true },
];
window.fetch = async (input, init) => {
  const path = String(input);
  let data: unknown;
  if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({detail:'此验收页仅预览配置，未保存或调用服务。'}),{status:400});
  if (path.endsWith('/providers')) data = [{id:'qa',name:'合成服务'}];
  else if (path.endsWith('/credentials')) data = {provider_id:'qa',provider_name:'合成服务',fields,active_profile_id:'qa',profiles:[{id:'qa',name:'界面验收配置',active:true,is_default:true,field_keys_present:['api_key','model','base_url'],public_values:{model:'qa-model',base_url:'https://example.invalid/v1'}}]};
  else if (path.endsWith('/reveal')) data = {values:{base_url:'https://example.invalid/v1',model:'qa-model',api_key:'synthetic-key-not-a-secret'}};
  else if (path.endsWith('/plans')) data = [{id:'qa-plan',name:'合成整理方案',instructions:'保留说话人的语气与不确定性。\n\n修正明确的文字错误，不添加事实。',common:true}];
  else if (path.endsWith('/diagnostics')) data = {records:[],storageAvailable:true};
  else return new Response(JSON.stringify({detail:'未模拟的验收接口'}),{status:404});
  return new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json'}});
};
export function Preview() {
  const [open,setOpen]=useState(false);
  const [tab,setTab]=useState<'prefs'|'engines'|'ai'|'plans'|'diagnostics'>('prefs');
  const [rate,setRate]=useState(1),[skip,setSkip]=useState(3);
  const ref=useRef<HTMLDialogElement>(null);
  return <main style={{padding:32}}><h1>设置界面验收</h1><p>仅含合成配置；不访问真实服务，不保存引擎与方案。通用偏好仅影响此隔离来源。</p><button className="button" onClick={()=>setOpen(true)}>打开测试设置</button>
    {open&&<SettingsModal settingsTab={tab} setSettingsTab={setTab} settingsRef={ref} setSettingsOpen={setOpen} defaultPlaybackRate={rate} setDefaultPlaybackRate={setRate} setPlaybackRate={()=>{}} audioRef={{current:null}} skipSeconds={skip} setSkipSeconds={setSkip}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
