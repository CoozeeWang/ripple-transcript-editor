import {useLayoutEffect,useRef,useState} from 'react';
import type {TagLibrary} from '../lib/tags';
import {msg} from '../i18n';
import {TagInput} from './TagInput';
/** Search and create share geometry, but never share an unsubmitted value or submit implicitly. */
export function TagLibraryInput({library,query,onQuery,readOnly,onCreate}:{
 library:TagLibrary;query:string;onQuery:(query:string)=>void;readOnly:boolean;onCreate?:(name:string,id?:string)=>Promise<void>;
}) {
 const [mode,setMode]=useState<'search'|'create'>('search'),[creating,setCreating]=useState(false),search=useRef<HTMLInputElement>(null),previous=useRef(mode);
 useLayoutEffect(()=>{if(previous.current!==mode&&mode==='search')search.current?.focus();previous.current=mode},[mode]);
 const change=(next:'search'|'create')=>{if(creating||next===mode)return;onQuery('');setMode(next)};
 return <div className="tag-search"><div className="tag-library-input">
  {mode==='search'?<input ref={search} value={query} aria-label={msg('tags.search')} placeholder={msg('tags.search')} onChange={e=>onQuery(e.target.value)}/>:<TagInput libraryMode disabled={readOnly&&!creating} availableTags={library.tags} onCancel={()=>{}} onCommit={async(name,id)=>{if(!onCreate||readOnly)throw new Error(msg('tags.saveFailed'));setCreating(true);try{await onCreate(name,id)}finally{setCreating(false)}}}/>}
  <span className="tag-input-modes"><button type="button" aria-label={msg('tags.search')} aria-pressed={mode==='search'} data-tip={msg('tags.search')} disabled={creating} onClick={()=>change('search')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg></button><button type="button" aria-label={msg('tags.newTag')} aria-pressed={mode==='create'} data-tip={msg('tags.newTag')} disabled={creating||readOnly||!onCreate} onClick={()=>change('create')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg></button></span>
 </div></div>;
}
