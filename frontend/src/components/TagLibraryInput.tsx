import { useLayoutEffect, useRef, useState } from 'react';
import { msg } from '../i18n';
import type { TagLibrary } from '../lib/tags';
import { TagInput } from './TagInput';

/** Search or create a project tag; neither action assigns a segment implicitly. */
export function TagLibraryInput({ library, query, onQuery, readOnly, onCreate }: {
    library: TagLibrary; query: string; onQuery: (query: string) => void; readOnly: boolean;
    onCreate?: (name: string, id?: string) => Promise<void>;
}) {
    const [mode,setMode]=useState<'search'|'create'>('search'),[creating,setCreating]=useState(false);
    const search=useRef<HTMLInputElement>(null),previous=useRef(mode);
    useLayoutEffect(()=>{if(previous.current!==mode&&mode==='search')search.current?.focus();previous.current=mode},[mode]);
    const submit=async(name:string,id?:string)=>{
        if(!onCreate||readOnly)throw Error(msg('tags.saveFailed'));
        setCreating(true);try{await onCreate(name,id)}finally{setCreating(false)}
    };
    return <div className="tag-search"><div className="tag-library-input">
        {mode==='search'?<input ref={search} value={query} aria-label={msg('tags.search')} placeholder={msg('tags.search')} onChange={event=>onQuery(event.target.value)}/>
            :<TagInput libraryMode disabled={readOnly&&!creating} availableTags={library.tags} onCancel={()=>{}} onCommit={submit}/>}
        <span className="tag-input-modes">{(['search','create']as const).map(item=><span key={item} className="tag-mode-option" data-tag-input-mode={item}>
            <button type="button" aria-label={msg(item==='search'?'tags.search':'tags.newTag')} aria-pressed={mode===item} data-tip={msg(item==='search'?'tags.search':'tags.newTag')}
                disabled={creating||item==='create'&&readOnly} onPointerDown={event=>event.preventDefault()} onClick={()=>{if(!creating&&mode!==item){onQuery('');setMode(item)}}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{item==='search'?<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>:<path d="M12 4v16M4 12h16"/>}</svg>
            </button>
        </span>)}</span>
    </div></div>;
}
