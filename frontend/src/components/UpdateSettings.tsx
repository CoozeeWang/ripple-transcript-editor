import { useEffect, useRef, useState } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { cancelDesktopUpdatePreparation, desktopUpdates, desktopUpdatesAvailable, prepareDesktopUpdate, type DesktopUpdateInfo } from '../lib/desktopUpdates';

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  const keys: Record<string,string> = {
    update_development:'desktopUpdate.development', update_busy:'desktopUpdate.workInProgress',
    update_work_in_progress:'desktopUpdate.workInProgress', update_unsaved_project:'desktopUpdate.unsavedProject',
    update_in_use:'desktopUpdate.connectionInUse', update_too_large:'desktopUpdate.tooLarge',
    update_check_failed:'desktopUpdate.checkFailed', update_download_failed:'desktopUpdate.downloadFailed',
    update_invalid_package:'desktopUpdate.invalidPackage', update_install_failed:'desktopUpdate.installFailed',
  };
  return msg(keys[code] ?? 'desktopUpdate.failed');
}
export function UpdateSettings({onCriticalChange,autoCheck=false,onClose}:{onCriticalChange:(critical:boolean)=>void;autoCheck?:boolean;onClose?:()=>void}) {
  const language = useInterfaceLanguage();
  const [info,setInfo] = useState<DesktopUpdateInfo|null>(null);
  const [error,setError] = useState('');
  const [working,setWorking] = useState(false);
  const [confirm,setConfirm] = useState(false);
  const [critical,setCritical] = useState(false);
  const [preparing,setPreparing] = useState(false);
  const alive = useRef(false);
  const action = useRef(false);
  const sequence = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const wasConfirm = useRef(false);
  const restoreActionFocus = useRef(false);
  const supported = desktopUpdatesAvailable();
  useEffect(() => {
    alive.current = true;
    let disposed=false;
    const token=sequence.current;
    if (supported) void desktopUpdates.status().then(async next=>{
      if(disposed||!alive.current||sequence.current!==token)return;
      setInfo(next);
      if(autoCheck&&next.phase==='idle'&&!action.current){
        action.current=true;sequence.current++;setWorking(true);setInfo({...next,phase:'checking'});
        try { const checked=await desktopUpdates.check();if(!disposed&&alive.current)setInfo(checked); }
        catch(e){if(!disposed&&alive.current)setError(failure(e));}
        finally{action.current=false;if(!disposed&&alive.current)setWorking(false);}
      }
    }).catch(e=>{if(!disposed&&alive.current&&sequence.current===token)setError(failure(e));});
    return () => { disposed=true;alive.current=false; };
  },[supported,autoCheck]);
  useEffect(()=>{
    if(confirm&&!critical)cancelRef.current?.focus();
    else if(!confirm&&wasConfirm.current)restoreActionFocus.current=true;
    wasConfirm.current=confirm;
    if(!confirm&&restoreActionFocus.current&&!working&&!critical&&primaryActionRef.current&&!primaryActionRef.current.disabled){
      primaryActionRef.current.focus();restoreActionFocus.current=false;
    }
  },[confirm,critical,working,info?.phase]);
  useEffect(()=>{
    if(critical)statusRef.current?.focus();
  },[critical]);
  useEffect(()=>{
    if(!supported || !['checking','downloading','verifying'].includes(info?.phase??''))return;
    let disposed=false;
    const token=sequence.current;
    const timer=window.setInterval(()=>{ void desktopUpdates.status().then(next=>{if(!disposed&&alive.current&&sequence.current===token)setInfo(next);}).catch(()=>{}); },250);
    return()=>{disposed=true;window.clearInterval(timer);};
  },[supported,info?.phase]);
  if(!supported)return null;
  const busy=working||critical||['checking','downloading','verifying','installing'].includes(info?.phase??'');
  const run=async(work:()=>Promise<DesktopUpdateInfo|void>)=>{
    if(action.current)return;
    action.current=true;sequence.current++;setWorking(true);setError('');
    try { const next=await work();if(alive.current&&next)setInfo(next); }
    catch(e){if(alive.current)setError(failure(e));}
    finally{action.current=false;if(alive.current)setWorking(false);}
  };
  const install=()=>run(async()=>{
    setCritical(true);setPreparing(true);onCriticalChange(true);
    try {
      await prepareDesktopUpdate();
      if(!alive.current){cancelDesktopUpdatePreparation();return;}
      setPreparing(false);setInfo(previous=>previous?{...previous,phase:'installing'}:previous);
      await desktopUpdates.install();
    } catch(e) {
      cancelDesktopUpdatePreparation();
      setPreparing(false);setCritical(false);setConfirm(false);onCriticalChange(false);
      setInfo(previous=>previous?.phase==='installing'?{...previous,phase:'error',error:null}:previous);
      try { const next=await desktopUpdates.status();if(alive.current)setInfo(next); } catch { /* Preserve the actionable error below. */ }
      throw e;
    }
  });
  const status=()=>{
    if(preparing)return msg('desktopUpdate.preparingInstall');
    switch(info?.phase??(working?'checking':'idle')){
      case 'checking':return msg('desktopUpdate.checking');
      case 'current':return msg('desktopUpdate.current');
      case 'unavailable':return msg('desktopUpdate.unavailable');
      case 'downloading':return msg('desktopUpdate.downloading');
      case 'verifying':return msg('desktopUpdate.verifying');
      case 'ready':return msg('desktopUpdate.ready');
      case 'installing':return msg('desktopUpdate.installing');
      default:return '';
    }
  };
  const result=info?.result;
  const recheckRequired=info?.phase==='error'&&info.error==='update_invalid_package';
  return <section className="settings-block desktop-update-settings" aria-labelledby="desktop-update-title">
    <div className="desktop-update-scroll">
      <header className="desktop-update-header"><h1 id="desktop-update-title">{msg('desktopUpdate.title')}</h1>
        <p>{info?msg(info.build?'desktopUpdate.versionBuild':'desktopUpdate.version',{version:info.currentVersion,build:info.build??''}):msg('desktopUpdate.reading')}</p>
      </header>
      <div className="desktop-update-body">
        {info?.availableVersion&&<p className="desktop-update-version">{msg('desktopUpdate.available',{version:info.availableVersion})}</p>}
        {(!confirm||critical)&&status()&&<p ref={statusRef} className="settings-hint" role="status" tabIndex={critical?-1:undefined}>{status()}</p>}
        {info?.phase==='downloading'&&<div className="desktop-update-progress">
          {info.total!==null&&<progress aria-label={msg('desktopUpdate.downloading')} max={info.total} value={Math.min(info.downloaded,info.total)}/>}
          <p className="settings-hint">{msg('desktopUpdate.downloaded',{amount:new Intl.NumberFormat(language,{maximumFractionDigits:1}).format(info.downloaded/1048576)})}</p>
        </div>}
        {(error||info?.error)&&<p className="form-error" role="alert">{error||failure(info?.error)}</p>}
        {!confirm&&info?.notes&&<details className="desktop-update-notes"><summary>{msg('desktopUpdate.notes')}</summary><p>{info.notes}</p></details>}
        {result&&<div className="desktop-update-result" role="status"><p className="settings-hint">{msg(result.status==='installed'?'desktopUpdate.installed':result.status==='rolled_back'?'desktopUpdate.rolledBack':result.status==='blocked'?'desktopUpdate.connectionInUse':'desktopUpdate.previousFailed',{version:result.version})}</p>
          <button type="button" className="cred-btn" disabled={busy} onClick={()=>void run(async()=>{await desktopUpdates.dismissResult();return desktopUpdates.status();})}>{msg('desktopUpdate.dismiss')}</button>
        </div>}
        {confirm&&!critical&&<div className="desktop-update-confirm" role="group" aria-labelledby="desktop-update-confirm-title" onKeyDown={event=>{
          if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!critical)setConfirm(false);}
        }}>
          <p id="desktop-update-confirm-title">{msg('desktopUpdate.confirmTitle')}</p><p className="settings-hint">{msg('desktopUpdate.preservation')}</p>
          <div className="desktop-update-actions"><button ref={cancelRef} type="button" className="cred-btn" disabled={critical} onClick={()=>setConfirm(false)}>{msg('desktopUpdate.later')}</button>
            <button type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={()=>void install()}>{msg('desktopUpdate.install')}</button></div>
        </div>}
      </div>
    </div>
    <footer className="desktop-update-controls">
      <button type="button" className="desktop-update-release-link" disabled={busy} onClick={()=>void run(()=>desktopUpdates.releases())}>{msg('desktopUpdate.releases')}</button>
      {!confirm&&<div className="desktop-update-actions">
        {['downloading','ready'].includes(info?.phase??'')&&<button type="button" className="cred-btn" disabled={critical} onClick={()=>{void desktopUpdates.cancel().then(()=>desktopUpdates.status()).then(next=>{if(alive.current)setInfo(next);}).catch(e=>{if(alive.current)setError(failure(e));});}}>{msg('desktopUpdate.cancel')}</button>}
        {onClose&&<button type="button" className="cred-btn" autoFocus disabled={critical} onClick={onClose}>{msg('desktopUpdate.close')}</button>}
        {info?.phase==='ready'?<button ref={primaryActionRef} type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={()=>setConfirm(true)}>{msg('desktopUpdate.reviewInstall')}</button>
          :info?.availableVersion&&info.phase!=='checking'&&!recheckRequired?<button ref={primaryActionRef} type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={()=>void run(async()=>{setInfo(previous=>previous?{...previous,phase:'downloading',downloaded:0,total:null,error:null}:previous);return desktopUpdates.download();})}>{msg('desktopUpdate.download')}</button>
          :<button ref={primaryActionRef} type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={()=>void run(async()=>{setInfo(previous=>previous?{...previous,phase:'checking',availableVersion:null,notes:null,error:null}:previous);return desktopUpdates.check();})}>{msg('desktopUpdate.check')}</button>}
      </div>}
    </footer>
  </section>;
}
