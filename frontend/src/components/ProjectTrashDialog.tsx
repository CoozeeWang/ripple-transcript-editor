import { msg, uiMessage, useInterfaceLanguage, interfaceLanguage } from '../i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OpenProject } from '../lib/projectStore';
import { ProjectIcon } from './ProjectIcon';
import { trapDialogFocus } from '../lib/dialogFocus';

export function DeleteMaterialDialog({ name, audio, hasDocuments, referenced, busy, error, onCancel, onDelete }: {
 name:string; audio:boolean; hasDocuments:boolean; referenced:boolean; busy:boolean; error?:string; onCancel:()=>void; onDelete:(keepDocuments:boolean)=>void;
}) {
  useInterfaceLanguage();
 const ref=useRef<HTMLDialogElement>(null);const [keep,setKeep]=useState(true);const optionGroup=useId();
 useEffect(() => {
    const modal = ref.current;
    const previous = document.activeElement;
    modal?.showModal();
    return () => {
      if (modal?.open) modal.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
 return createPortal(<dialog ref={ref} className="material-preview-dialog audio-project-dialog" aria-label={msg('ProjectTrashDialog.m0873')} onKeyDown={trapDialogFocus} onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
  <div className="dialog-header"><h2>{msg('ProjectTrashDialog.m0874')}{audio?msg('ProjectTrashDialog.m0875'):msg('ProjectTrashDialog.m0876')}</h2></div>
  <p className="trash-material-name">{name}</p><p className="settings-hint">{msg('ProjectTrashDialog.m0877')}{!audio&&msg('ProjectTrashDialog.m0878')}{referenced&&msg('ProjectTrashDialog.m0879')}</p>
  {audio&&hasDocuments&&<div className="trash-delete-options"><label><input type="radio" name={optionGroup} tabIndex={keep ? 0 : -1} checked={keep} disabled={busy} onChange={()=>setKeep(true)}/>{msg('ProjectTrashDialog.m0880')}</label><label><input type="radio" name={optionGroup} tabIndex={keep ? -1 : 0} checked={!keep} disabled={busy} onChange={()=>setKeep(false)}/>{msg('ProjectTrashDialog.m0881')}</label></div>}
  {error&&<p className="form-error" role="alert">{uiMessage(error)}</p>}<div className="project-actions audio-project-footer"><button className="button button--secondary" disabled={busy} onClick={onCancel}>{msg('ProjectTrashDialog.m0882')}</button><button className="button button--danger" disabled={busy} onClick={()=>onDelete(keep)}>{msg('ProjectTrashDialog.m0883')}</button></div>
 </dialog>,document.body);
}
export function ProjectTrashDialog({project,busy,error,onClose,onRestore,onClear}:{project:OpenProject;busy:boolean;error?:string;onClose:()=>void;onRestore:(id:string)=>void;onClear:()=>void}){
  useInterfaceLanguage();
 const ref=useRef<HTMLDialogElement>(null);const [confirm,setConfirm]=useState<string | null>(null);
 useEffect(() => {
    const modal = ref.current;
    const previous = document.activeElement;
    modal?.showModal();
    return () => {
      if (modal?.open) modal.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
 const items=project.data.trash??[];
 const signature = JSON.stringify(items.map(item => item.id).sort());
 return createPortal(<><dialog ref={ref} className="material-preview-dialog audio-project-dialog" aria-label={msg('ProjectTrashDialog.m0884')} onKeyDown={trapDialogFocus} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
 <div className="dialog-header"><h2>{msg('ProjectTrashDialog.m0885')}</h2><button className="icon-button" aria-label={msg('ProjectTrashDialog.m0886')} data-tip={msg('ProjectTrashDialog.m0887')} disabled={busy} onClick={onClose}>×</button></div>
 <p className="settings-hint">{msg('ProjectTrashDialog.m0888')}</p>
 {error&&<p className="form-error" role="alert">{uiMessage(error)}</p>}<div className="project-trash-list">{!items.length?<p className="settings-hint">{msg('ProjectTrashDialog.m0889')}</p>:items.map(item=><div className="project-trash-row" key={item.id}><ProjectIcon kind={item.recording.storage==='none'?'document':'audio'}/><div><span>{item.name}</span><small>{project.data.interviews.find(i=>i.id===item.interviewId)?.title} · {new Date(item.deletedAt).toLocaleDateString(interfaceLanguage())}</small></div><button className="cred-btn" disabled={busy} onClick={()=>onRestore(item.id)}>{msg('ProjectTrashDialog.m0890')}</button></div>)}</div>
 <div className="project-actions audio-project-footer">{items.length>0&&<button className="button button--danger" disabled={busy} onClick={()=>setConfirm(signature)}>{msg('ProjectTrashDialog.m0891')}</button>}<button className="button button--secondary" disabled={busy} onClick={onClose}>{msg('ProjectTrashDialog.m0892')}</button></div>
 </dialog>{confirm !== null && <ClearTrashConfirmation count={items.length} changed={confirm !== signature} busy={busy} onCancel={()=>setConfirm(null)} onConfirm={()=>{ if (confirm === signature && !busy) { setConfirm(null); onClear(); } }}/>}</>,document.body);
}

function ClearTrashConfirmation({ count, changed, busy, onCancel, onConfirm }: {
 count: number; changed: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  useInterfaceLanguage();
 const ref = useRef<HTMLDialogElement>(null);
 const cancelRef = useRef<HTMLButtonElement>(null);
 useEffect(() => {
   const dialog = ref.current;
   const previous = document.activeElement;
   dialog?.showModal();
   cancelRef.current?.focus();
   return () => {
     if (dialog?.open) dialog.close();
     if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
   };
 }, []);
 return <dialog ref={ref} className="material-preview-dialog audio-project-dialog" aria-labelledby="clear-trash-title" aria-describedby="clear-trash-description" onKeyDown={trapDialogFocus} onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>
   <div className="dialog-header"><h2 id="clear-trash-title">{msg('ProjectTrashDialog.m0893')}</h2></div>
   <p id="clear-trash-description" className="settings-hint">{msg('review.emptyTrash', { count })}</p>
   {changed && <p className="form-error" role="alert">{msg('ProjectTrashDialog.m0896')}</p>}
   <div className="project-actions audio-project-footer">
     <button ref={cancelRef} className="button button--secondary" disabled={busy} onClick={onCancel}>{msg('ProjectTrashDialog.m0897')}</button>
     <button className="button button--danger" disabled={busy || changed || count === 0} onClick={onConfirm}>{msg('ProjectTrashDialog.m0898')}</button>
   </div>
 </dialog>;
}
