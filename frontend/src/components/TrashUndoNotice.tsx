import { msg, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';

export function TrashUndoNotice({ busy, onUndo, onDismiss }: { busy:boolean; onUndo:()=>void; onDismiss:()=>void }) {
  useInterfaceLanguage();
  const root=useRef<HTMLDivElement>(null);
  const dismiss=useRef(onDismiss);
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  useEffect(()=>{dismiss.current=onDismiss;},[onDismiss]);
  useEffect(()=>{
    if(busy||hovered||focused)return;
    const timer=window.setTimeout(()=>dismiss.current(),6000);
    return()=>window.clearTimeout(timer);
  },[busy,hovered,focused]);
  useEffect(()=>{
    const outside=(event:Event)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))dismiss.current();};
    const key=(event:KeyboardEvent)=>{if(['Enter',' ','Escape'].includes(event.key))outside(event);};
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);};
  },[]);
  return <div ref={root} className="project-trash-undo" role="status" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false);}}>
    <span>{msg('TrashUndoNotice.m1079')}</span><button className="cred-btn" disabled={busy} onClick={onUndo}>{msg('TrashUndoNotice.m1080')}</button><button className="icon-button" aria-label={msg('TrashUndoNotice.m1081')} data-tip={msg('TrashUndoNotice.m1082')} disabled={busy} onClick={onDismiss}>×</button>
  </div>;
}
