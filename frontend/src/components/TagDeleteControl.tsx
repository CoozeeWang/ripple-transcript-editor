import {useId,useLayoutEffect,useRef,useState} from 'react';
import {msg} from '../i18n';
import {useDismissable} from '../useDismissable';
import {ActionIcon} from './ActionIcon';
/** The trash only reveals choices. Neither opening nor dismissing mutates data. */
export function TagDeleteControl({name,count,disabled,onDelete}:{name:string;count:number;disabled:boolean;onDelete:(branch:boolean)=>Promise<void>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLSpanElement>(null),trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null),pending=useRef(false),id=useId();
 const close=(focus=false)=>{if(pending.current)return;setOpen(false);setError('');if(focus)trigger.current?.focus()};
 useDismissable(root,open,()=>close());
 useLayoutEffect(()=>{if(open)popup.current?.scrollIntoView?.({block:'nearest'})},[open]);
 const choose=async(branch:boolean)=>{
  if(disabled||pending.current)return;
  pending.current=true;setBusy(true);setError('');
  try{await onDelete(branch);setOpen(false);queueMicrotask(()=>{if(trigger.current?.isConnected)trigger.current.focus();else document.querySelector<HTMLElement>('.library-list .library-filter, .tag-list-head button')?.focus()})}
  catch{setError(msg('tags.saveFailed'))}
  finally{pending.current=false;setBusy(false)}
 };
 return <span ref={root} className="tag-delete-control" onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))close()}} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close(true)}if(e.repeat&&(e.key==='Enter'||e.key===' '))e.preventDefault()}}>
  <button ref={trigger} type="button" className="library-delete" disabled={disabled||busy} aria-label={`${msg('tags.deleteTag')}: ${name}`} aria-expanded={open} aria-controls={open?id:undefined} data-tip={msg('tags.deleteTag')} onClick={e=>{if(e.detail<2&&!pending.current){setError('');setOpen(value=>!value)}}}><ActionIcon kind="trash"/></button>
  {open&&<div ref={popup} id={id} className="tag-delete-options" role="group" aria-label={msg('tags.deleteOptions',{name})}>
   <div className="tag-delete-actions"><button type="button" disabled={disabled||busy} data-action-tip={msg('tags.deleteNodeHint')} onClick={e=>{if(e.detail<2)void choose(false)}}>{msg('tags.deleteNode')}</button>{count>1&&<button type="button" disabled={disabled||busy} aria-label={msg('tags.deleteBranchDescription',{name,count})} data-action-tip={msg('tags.deleteBranchHint',{count})} onClick={e=>{if(e.detail<2)void choose(true)}}>{msg('tags.deleteBranch')}</button>}</div>
   {error&&<p role="alert" className="tag-error">{error}</p>}
  </div>}
 </span>;
}
