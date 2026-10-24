import { useEffect } from 'react';
import { normalizeInterfaceLanguage, setInterfaceLanguage, useInterfaceLanguage } from '../i18n';
import { desktopUpdateInvoke } from '../lib/desktopUpdates';
import { trapDialogFocus } from '../lib/dialogFocus';
import { UpdateSettings } from './UpdateSettings';
import './updateWindow.css';

export function UpdateWindow() {
  useInterfaceLanguage();
  const close=()=>{ void desktopUpdateInvoke('update_close').catch(()=>{}); };
  useEffect(()=>{
    let disposed=false,unlisten:(()=>void)|undefined;
    const api=(window as unknown as {__TAURI__?:{event?:{listen:(name:string,handler:(event:{payload:string})=>void)=>Promise<()=>void>}}}).__TAURI__?.event;
    void api?.listen('desktop-update-language',event=>{void setInterfaceLanguage(normalizeInterfaceLanguage(event.payload));}).then(remove=>{if(disposed)remove();else unlisten=remove;});
    return()=>{disposed=true;unlisten?.();};
  },[]);
  return <main className="desktop-update-window" role="dialog" aria-labelledby="desktop-update-title" tabIndex={-1}
    onKeyDown={event=>{trapDialogFocus(event);if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();close();}}}>
    <UpdateSettings autoCheck onClose={close}/>
  </main>;
}
