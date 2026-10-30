import { useLayoutEffect, useRef, useState } from 'react';
import type { TagLibrary } from '../lib/tags';
import { msg } from '../i18n';
import { TagInput } from './TagInput';
import { NewGroupInput } from './NewGroupInput';
type Mode = 'search' | 'create' | 'group';
export function TagLibraryInput({ library, query, onQuery, readOnly, onCreate, onCreateGroup }: {
    library: TagLibrary; query: string; onQuery: (query: string) => void; readOnly: boolean;
    onCreate?: (name: string, id?: string) => Promise<void>; onCreateGroup?: (name: string) => Promise<void>;
}) {
    const [mode, setMode] = useState<Mode>('search'), [creating, setCreating] = useState(false), search = useRef<HTMLInputElement>(null), previous = useRef(mode);
    useLayoutEffect(() => { if (previous.current !== mode && mode === 'search') search.current?.focus(); previous.current = mode; }, [mode]);
    const change = (next: Mode) => { if (creating || next === mode) return; onQuery(''); setMode(next); };
    const submit = async (action: (() => Promise<void>) | undefined) => { if (!action || readOnly) throw Error(msg('tags.saveFailed')); setCreating(true); try { await action(); } finally { setCreating(false); } };
    return <div className="tag-search"><div className="tag-library-input">
        {mode === 'search' ? <input ref={search} value={query} aria-label={msg('tags.search')} placeholder={msg('tags.search')} onChange={event => onQuery(event.target.value)}/>
            : mode === 'create' ? <TagInput libraryMode disabled={readOnly && !creating} availableTags={library.tags} onCancel={() => {}} onCommit={(name, id) => submit(onCreate ? () => onCreate(name, id) : undefined)}/>
                : <NewGroupInput libraryMode busy={creating || readOnly} onCancel={() => {}} onCreate={name => submit(onCreateGroup ? () => onCreateGroup(name) : undefined)}/>}
        <span className="tag-input-modes">{(['search', 'create', 'group'] as const).map(item => <button type="button" key={item} aria-label={msg(item === 'search' ? 'tags.search' : item === 'create' ? 'tags.newTag' : 'tags.newGroup')} aria-pressed={mode === item} data-tip={msg(item === 'search' ? 'tags.search' : item === 'create' ? 'tags.newTag' : 'tags.newGroup')} disabled={creating || item !== 'search' && readOnly} onClick={() => change(item)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {item === 'group' ? <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3"/> : <><path d="M3 4h6l7 7-6 6-7-7Z"/><circle cx="6.5" cy="7.5" r=".6"/>{item === 'search' ? <><circle cx="17" cy="16" r="4"/><path d="m20 19 3 3"/></> : <path d="M18 13v9m-4.5-4.5h9"/>}</>}
            </svg>
        </button>)}</span>
    </div></div>;
}
