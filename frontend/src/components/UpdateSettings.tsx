import { useEffect, useRef, useState } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { cancelDesktopUpdatePreparation, desktopUpdates, desktopUpdatesAvailable, prepareDesktopUpdate, type DesktopUpdateInfo } from '../lib/desktopUpdates';

function errorCode(error: unknown) { return error instanceof Error ? error.message : String(error); }
function failure(error: unknown) {
  const code = errorCode(error);
  const keys: Record<string,string> = {
    update_development:'desktopUpdate.development', update_busy:'desktopUpdate.workInProgress',
    update_work_in_progress:'desktopUpdate.workInProgress', update_unsaved_project:'desktopUpdate.unsavedProject',
    update_in_use:'desktopUpdate.connectionInUse', update_too_large:'desktopUpdate.tooLarge',
    update_check_failed:'desktopUpdate.checkFailed', update_download_failed:'desktopUpdate.downloadFailed',
    update_invalid_package:'desktopUpdate.invalidPackage', update_install_failed:'desktopUpdate.installFailed',
    update_prepare_timeout:'desktopUpdate.prepareTimeout',
  };
  return msg(keys[code] ?? 'desktopUpdate.failed');
}
export function UpdateSettings({onCriticalChange,autoCheck=false,onClose}:{onCriticalChange:(critical:boolean)=>void;autoCheck?:boolean;onClose?:()=>void}) {
  const language = useInterfaceLanguage();
  const [info,setInfo] = useState<DesktopUpdateInfo|null>(null);
  const [error,setError] = useState('');
  const [working,setWorking] = useState(false);
  const [critical,setCritical] = useState(false);
  const [preparing,setPreparing] = useState(false);
  const alive = useRef(false);
  const action = useRef(false);
  const sequence = useRef(0);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const continueUpdate = useRef(false);
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
        catch(e){if(!disposed&&alive.current)setError(errorCode(e));}
        finally{action.current=false;if(!disposed&&alive.current)setWorking(false);}
      }
    }).catch(e=>{if(!disposed&&alive.current&&sequence.current===token)setError(errorCode(e));});
    return () => { disposed=true;alive.current=false;continueUpdate.current=false; };
  },[supported,autoCheck]);
  useEffect(()=>{
    if(restoreActionFocus.current&&!working&&!critical&&primaryActionRef.current&&!primaryActionRef.current.disabled){
      primaryActionRef.current.focus();restoreActionFocus.current=false;
    }
  },[critical,working,info?.phase]);
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
    catch(e){if(alive.current){setError(errorCode(e));restoreActionFocus.current=true;}}
    finally{action.current=false;if(alive.current)setWorking(false);}
  };
  const install=async()=>{
    setCritical(true);setPreparing(true);onCriticalChange(true);
    try {
      await prepareDesktopUpdate();
      if(!alive.current){cancelDesktopUpdatePreparation();return;}
      setPreparing(false);setInfo(previous=>previous?{...previous,phase:'installing'}:previous);
      await desktopUpdates.install();
    } catch(e) {
      cancelDesktopUpdatePreparation();
      setPreparing(false);setCritical(false);onCriticalChange(false);
      setInfo(previous=>previous?.phase==='installing'?{...previous,phase:'error',error:null}:previous);
      try { const next=await desktopUpdates.status();if(alive.current)setInfo(next); } catch { /* Preserve the actionable error below. */ }
      throw e;
    }
  };
  const updateAndRestart=()=>run(async()=>{
    continueUpdate.current=true;
    try {
      if(info?.phase!=='ready'){
        setInfo(previous=>previous?{...previous,phase:'downloading',downloaded:0,total:null,error:null}:previous);
        const downloaded=await desktopUpdates.download();
        if(!alive.current)return;
        setInfo(downloaded);
        if(downloaded.phase!=='ready'){restoreActionFocus.current=true;return;}
      }
      // Closing or cancelling a download revokes this click's installation intent.
      // Reopening a window with verified bytes never resumes installation itself.
      if(alive.current&&continueUpdate.current)await install();
    } finally {continueUpdate.current=false;}
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
  const recovering=result?.status==='recovery_required';
  const hasFailure=Boolean(error||info?.error);
  const recheckRequired=info?.phase==='error'&&info.error==='update_invalid_package';
  return <section className="settings-block desktop-update-settings" aria-labelledby="desktop-update-title" onKeyDown={event=>{
    if(event.key==='Escape'&&!critical)continueUpdate.current=false;
  }}>
    <div className="desktop-update-scroll">
      <header className="desktop-update-header"><h1 id="desktop-update-title">{msg('desktopUpdate.title')}</h1>
        <p>{info?msg(info.build?'desktopUpdate.versionBuild':'desktopUpdate.version',{version:info.currentVersion,build:info.build??''}):msg('desktopUpdate.reading')}</p>
      </header>
      <div className="desktop-update-body">
        {!recovering&&info?.availableVersion&&<p className="desktop-update-version">{msg('desktopUpdate.available',{version:info.availableVersion})}</p>}
        {!recovering&&(!hasFailure||critical)&&status()&&<p ref={statusRef} className="settings-hint" role="status" tabIndex={critical?-1:undefined}>{status()}</p>}
        {!recovering&&!hasFailure&&!busy&&info?.availableVersion&&<p className="settings-hint">{msg(info?.phase==='ready'?'desktopUpdate.restartEffect':'desktopUpdate.updateEffect')}</p>}
        {info?.phase==='downloading'&&<div className="desktop-update-progress">
          {info.total!==null&&<progress aria-label={msg('desktopUpdate.downloading')} max={info.total} value={Math.min(info.downloaded,info.total)}/>}
          <p className="settings-hint">{msg('desktopUpdate.downloaded',{amount:new Intl.NumberFormat(language,{maximumFractionDigits:1}).format(info.downloaded/1048576)})}</p>
        </div>}
        {hasFailure&&<p className="form-error" role="alert">{failure(error||info?.error)}</p>}
        {!recovering&&!critical&&info?.notes&&<details className="desktop-update-notes"><summary>{msg('desktopUpdate.notes')}</summary><p>{info.notes}</p></details>}
        {result&&<div className="desktop-update-result" role={result.status==='recovery_required'?'alert':'status'}><div className="desktop-update-result-copy"><p className={result.status==='recovery_required'?'form-error':'settings-hint'}>{msg(result.status==='installed'?'desktopUpdate.installed':result.status==='rolled_back'?'desktopUpdate.rolledBack':result.status==='recovery_required'?'desktopUpdate.rollbackFailed':result.status==='blocked'?'desktopUpdate.connectionInUse':'desktopUpdate.previousFailed',{version:result.version})}</p>
          {result.status==='recovery_required'&&<p className="settings-hint">{msg('desktopUpdate.recoveryGuide')}</p>}</div>
          <button type="button" className="cred-btn" disabled={busy} onClick={()=>void run(async()=>{await desktopUpdates.dismissResult();return desktopUpdates.status();})}>{msg('desktopUpdate.dismiss')}</button>
        </div>}
      </div>
    </div>
    <footer className="desktop-update-controls">
      {!recovering&&<button type="button" className="desktop-update-release-link" disabled={busy} onClick={()=>void run(()=>desktopUpdates.releases())}>{msg('desktopUpdate.releases')}</button>}
      <div className="desktop-update-actions">
        {info?.phase==='downloading'&&<button type="button" className="cred-btn" disabled={critical} onClick={()=>{continueUpdate.current=false;void desktopUpdates.cancel().then(()=>desktopUpdates.status()).then(next=>{if(alive.current){setInfo(next);restoreActionFocus.current=true;}}).catch(e=>{if(alive.current)setError(errorCode(e));});}}>{msg('desktopUpdate.cancel')}</button>}
        {onClose&&<button type="button" className="cred-btn" autoFocus disabled={critical} onClick={()=>{continueUpdate.current=false;onClose();}}>{msg('desktopUpdate.close')}</button>}
        {recovering?<button ref={primaryActionRef} type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={()=>void run(()=>desktopUpdates.releases())}>{msg('desktopUpdate.releases')}</button>
          :(info?.phase==='ready'||(info?.availableVersion&&info.phase!=='checking'&&!recheckRequired))?<button ref={primaryActionRef} type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={()=>void updateAndRestart()}>{msg('desktopUpdate.updateRestart')}</button>
          :<button ref={primaryActionRef} type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={()=>void run(async()=>{setInfo(previous=>previous?{...previous,phase:'checking',availableVersion:null,notes:null,error:null}:previous);return desktopUpdates.check();})}>{msg('desktopUpdate.check')}</button>}
      </div>
    </footer>
  </section>;
}
