import { useEffect, useRef, useState } from 'react';
import { msg } from '../i18n';
import { desktopUpdates, desktopUpdatesAvailable, type DesktopUpdateInfo } from '../lib/desktopUpdates';

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  return msg(code === 'update_development' ? 'desktopUpdate.development'
    : code === 'update_busy' ? 'desktopUpdate.workInProgress'
    : code === 'update_check_failed' ? 'desktopUpdate.checkFailed' : 'desktopUpdate.failed');
}
export function UpdateSettings({autoCheck=false,onClose}:{autoCheck?:boolean;onClose?:()=>void}) {
  const [info,setInfo] = useState<DesktopUpdateInfo|null>(null);
  const [error,setError] = useState('');
  const [working,setWorking] = useState(false);
  const action = useRef(false);
  const supported = desktopUpdatesAvailable();
  const check = async () => {
    if(action.current)return;
    action.current=true;setWorking(true);setError('');
    setInfo(previous=>previous?{...previous,phase:'checking',availableVersion:null,notes:null,error:null,releaseUrl:null}:previous);
    try { setInfo(await desktopUpdates.check()); }
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{action.current=false;setWorking(false);}
  };
  useEffect(() => {
    let disposed=false;
    if(supported) void desktopUpdates.status().then(next=>{
      if(disposed)return;
      setInfo(next);
      if(autoCheck&&next.phase==='idle')void check();
    }).catch(e=>{if(!disposed)setError(e instanceof Error?e.message:String(e));});
    return () => { disposed=true; };
  },[supported,autoCheck]);
  useEffect(()=>{
    if(!supported||info?.phase!=='checking')return;
    let disposed=false;
    const timer=window.setInterval(()=>{void desktopUpdates.status().then(next=>{if(!disposed)setInfo(next);}).catch(()=>{});},500);
    return()=>{disposed=true;window.clearInterval(timer);};
  },[supported,info?.phase]);
  if(!supported)return null;
  const busy=working||info?.phase==='checking';
  const openReleases=async()=>{
    if(action.current)return;
    action.current=true;setWorking(true);setError('');
    try{await desktopUpdates.releases();}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{action.current=false;setWorking(false);}
  };
  const hasUpdate=info?.phase==='available'&&Boolean(info.releaseUrl);
  return <section className="settings-block desktop-update-settings" aria-labelledby="desktop-update-title">
    <div className="desktop-update-scroll">
      <header className="desktop-update-header"><h1 id="desktop-update-title">{msg('desktopUpdate.title')}</h1>
        <p>{info?msg(info.build?'desktopUpdate.versionBuild':'desktopUpdate.version',{version:info.currentVersion,build:info.build??''}):msg('desktopUpdate.reading')}</p>
      </header>
      <div className="desktop-update-body">
        {info?.availableVersion&&<p className="desktop-update-version">{msg('desktopUpdate.available',{version:info.availableVersion})}</p>}
        {busy?<p className="settings-hint" role="status">{msg('desktopUpdate.checking')}</p>
          :info?.phase==='current'?<p className="settings-hint" role="status">{msg('desktopUpdate.current')}</p>
          :info?.phase==='unavailable'?<p className="settings-hint" role="status">{msg('desktopUpdate.unavailable')}</p>
          :info?.phase==='no_releases'?<p className="settings-hint" role="status">{msg('desktopUpdate.noReleases')}</p>:null}
        {hasUpdate&&<p className="settings-hint">{msg('desktopUpdate.manualEffect')}</p>}
        {(error||info?.error)&&<p className="form-error" role="alert">{failure(error||info?.error)}</p>}
        {info?.notes&&<details className="desktop-update-notes"><summary>{msg('desktopUpdate.notes')}</summary><p>{info.notes}</p></details>}
      </div>
    </div>
    <footer className="desktop-update-controls">
      <button type="button" className="desktop-update-release-link" disabled={busy} onClick={()=>void (hasUpdate?check():openReleases())}>
        {msg(hasUpdate?'desktopUpdate.checkAgain':'desktopUpdate.releases')}
      </button>
      <div className="desktop-update-actions">
        {onClose&&<button type="button" className="cred-btn" autoFocus onClick={onClose}>{msg('desktopUpdate.close')}</button>}
        <button type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={()=>void (hasUpdate?openReleases():check())}>
          {msg(hasUpdate?'desktopUpdate.openDownload':'desktopUpdate.check')}
        </button>
      </div>
    </footer>
  </section>;
}
