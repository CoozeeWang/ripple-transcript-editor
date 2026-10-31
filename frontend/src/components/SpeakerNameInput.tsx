import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {registerEditorDraft} from '../lib/editorDrafts';

/** Keep typing local; save/navigation boundaries flush the final name. */
export function SpeakerNameInput({value, readOnly, label, onCommit}:{value:string;readOnly:boolean;label:string;onCommit:(name:string)=>void}) {
  const [draft,setDraft]=useState(value);
  const latest=useRef(value), committed=useRef(value), callback=useRef(onCommit);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const composing=useRef(false);
  useLayoutEffect(()=>{callback.current=onCommit;},[onCommit]);
  useEffect(()=>{
    if(value!==committed.current){latest.current=value;committed.current=value;setDraft(value);}
  },[value]);
  const flush=()=>{
    clearTimeout(timer.current);
    if(latest.current===committed.current)return;
    committed.current=latest.current;callback.current(latest.current);
  };
  useEffect(()=>{
    const remove=registerEditorDraft(()=>latest.current!==committed.current);
    const handler=()=>flush();window.addEventListener('te:flush-drafts',handler);
    return()=>{remove();clearTimeout(timer.current);window.removeEventListener('te:flush-drafts',handler);};
  },[]);
  const schedule=()=>{clearTimeout(timer.current);if(!composing.current)timer.current=setTimeout(flush,300);};
  return <input value={draft} aria-label={label} data-action-tip={draft} readOnly={readOnly}
    onChange={event=>{latest.current=event.target.value;setDraft(latest.current);window.dispatchEvent(new Event("te:draft-dirty"));schedule();}}
    onCompositionStart={()=>{composing.current=true;clearTimeout(timer.current);}}
    onCompositionEnd={()=>{composing.current=false;schedule();}}
    onBlur={flush} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing)flush();}}/>;
}
