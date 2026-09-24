import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectRecording } from '../lib/projectStore';
import { ProjectIcon } from './ProjectIcon';
export function AssociateAudioDialog({name,anchor,recordings,busy,error,onClose,onConfirm}:{name:string;anchor:DOMRect;recordings:ProjectRecording[];busy:boolean;error:string;onClose:()=>void;onConfirm:(id:string)=>void}){
  useInterfaceLanguage();
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{ref.current?.showModal();},[]);
 const width=Math.min(320,window.innerWidth-32);
 return createPortal(<dialog ref={ref} className="associate-audio-popover" style={{left:Math.max(16,Math.min(anchor.right-width,window.innerWidth-width-16)),top:Math.max(16,Math.min(anchor.bottom+6,window.innerHeight-330))}} aria-label={msg('AssociateAudioDialog.m0341', { v0: name })} onCancel={e=>{e.preventDefault();if(!busy)onClose();}} onClick={e=>{if(e.target===e.currentTarget&&!busy){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
 <p className="section-label">{msg('AssociateAudioDialog.m0342')}</p>
 {recordings.length?<div className="associate-audio-list">{recordings.map(r=><button key={r.id} disabled={busy} onClick={()=>onConfirm(r.id)}><ProjectIcon kind="audio"/><span>{r.name}</span></button>)}</div>:<p className="settings-hint">{msg('AssociateAudioDialog.m0343')}</p>}
 {error&&<p className="form-error" role="alert">{uiMessage(error)}</p>}
 </dialog>,document.body);
}
