import {RefreshIcon} from './RefreshIcon';
import {nativeDesktopAvailable} from '../lib/desktopFs';
import {useEffect,useRef,useState} from 'react';
import {msg,useInterfaceLanguage} from '../i18n';
import {formatPlaybackTime} from '../lib/format';
const validRule=(value:unknown):value is Rule=>!!value&&typeof value==='object'&&Array.isArray((value as Rule).formats)&&(value as Rule).formats.every(f=>typeof f==='string')&&typeof (value as Rule).verified==='string';
interface Rule {formats:string[];url:string|null;verified:string;checked_at?:string;review_required?:boolean;max_bytes:number|null;max_seconds:number|null}
export function AudioEngineRules({provider,busy}:{provider:string;busy:boolean}){
 useInterfaceLanguage();
 const [data,setData]=useState<{provider:string;rule:Rule}|null>(null),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 const rule=data?.provider===provider?data.rule:null;
 useEffect(()=>{const request=++generation.current;const controller=new AbortController();void fetch(`/api/audio/rules/${encodeURIComponent(provider)}`,{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(rule=>{if(request===generation.current&&validRule(rule))setData({provider,rule})}).catch(()=>{});return()=>{generation.current=request+1;controller.abort()}},[provider]);
 const refresh=async()=>{if(refreshing||!rule?.url)return;const request=generation.current;setRefreshing(true);setError('');try{const r=await fetch(`/api/audio/rules/${encodeURIComponent(provider)}/refresh`,{method:'POST',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(msg('audioInformation.refreshFailed'));const next=await r.json();if(request===generation.current&&validRule(next))setData({provider,rule:next})}catch{if(request===generation.current)setError(msg('audioInformation.refreshFailed'))}finally{setRefreshing(false)}};
 return <div className="audio-engine-rule">
  <div className="audio-engine-rule-title"><p>{msg('audioInformation.engineFormats',{formats:rule?.formats.length?rule.formats.map(format=>format.toLowerCase()).join(' / '):msg('audioInformation.unknownRules')})}</p>
   {rule?.url&&<button type="button" className="cred-btn audio-engine-refresh" aria-label={msg(refreshing?'audioInformation.refreshing':'audioInformation.refresh')} aria-busy={refreshing} data-action-tip={msg('audioInformation.refreshInfo')} disabled={busy||refreshing} onClick={()=>void refresh()}><RefreshIcon/></button>}
  </div>
  {rule&&<p className="settings-hint">{msg('audioInformation.engineLimits',{size:rule.max_bytes?`${(rule.max_bytes/1_000_000).toFixed(0)} MB`:msg('audioInformation.unknown'),duration:rule.max_seconds?formatPlaybackTime(rule.max_seconds):msg('audioInformation.unknown')})}</p>}
  {rule?.url&&<div className="audio-rule-actions"><a href={rule.url} target="_blank" rel="noreferrer" onClick={event=>{
    if(!nativeDesktopAvailable())return;event.preventDefault();
    const bridge=(window as unknown as {__TAURI__:{core:{invoke:(command:string,args:Record<string,string>)=>Promise<void>}}}).__TAURI__.core;
    void bridge.invoke('audio_open_documentation',{url:rule.url!}).catch(()=>setError(msg('audioInformation.openOfficialFailed')));
  }}>{msg('audioInformation.official')}</a><span className="settings-hint">{msg('audioInformation.verified',{date:rule.verified})}</span></div>}
  {rule?.review_required&&<p className="settings-hint" role="status">{msg('audioInformation.reviewRequired',{date:rule.checked_at??''})}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </div>;
}
