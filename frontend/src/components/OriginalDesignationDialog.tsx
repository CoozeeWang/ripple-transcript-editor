import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function OriginalDesignationDialog({name,busy,error,onCancel,onConfirm}:{name:string;busy:boolean;error:string;onCancel:()=>void;onConfirm:()=>void}) {
  useInterfaceLanguage();
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{ref.current?.showModal();},[]);
 return createPortal(<dialog ref={ref} className="material-preview-dialog audio-project-dialog" aria-label={msg('OriginalDesignationDialog.m0619')} onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
  <div className="dialog-header"><h2>{msg('OriginalDesignationDialog.m0620')}</h2></div>
  <p className="trash-material-name">{name}</p>
  <p className="settings-hint">{msg('OriginalDesignationDialog.m0621')}</p>
  {error&&<p className="form-error" role="alert">{uiMessage(error)}</p>}
  <div className="project-actions audio-project-footer"><button className="cred-btn" disabled={busy} onClick={onCancel}>{msg('OriginalDesignationDialog.m0622')}</button><button className="cred-btn" disabled={busy} onClick={onConfirm}>{msg('OriginalDesignationDialog.m0623')}</button></div>
 </dialog>,document.body);
}
