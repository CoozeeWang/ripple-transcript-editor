import { useLayoutEffect, useRef, useState } from 'react';
import type { TagLibrary } from '../lib/tags';
import { msg } from '../i18n';
import { TagInput } from './TagInput';
import { NewGroupInput } from './NewGroupInput';
type Mode = 'search' | 'create' | 'group';
export function TagLibraryInput({ library, query, onQuery, readOnly, onCreate, onCreateGroup, allowGroup = true }: {
    library: TagLibrary; query: string; onQuery: (query: string) => void; readOnly: boolean; allowGroup?: boolean;
    onCreate?: (name: string, id?: string) => Promise<void>; onCreateGroup?: (name: string) => Promise<void>;
}) {
    const [mode, setMode] = useState<Mode>('search'), [creating, setCreating] = useState(false), [groupDraft, setGroupDraft] = useState('');
    const activeMode = mode === 'group' && !allowGroup ? 'search' : mode;
    const search = useRef<HTMLInputElement>(null), previous = useRef(activeMode);
    useLayoutEffect(() => {
        if (previous.current !== activeMode && activeMode === 'search') search.current?.focus(); previous.current = activeMode;
        let cancelled = false;
        if (!allowGroup && mode === 'group') queueMicrotask(() => { if (!cancelled) setMode('search'); });
        return () => { cancelled = true; };
    }, [activeMode, mode, allowGroup]);
    const change = (next: Mode) => { if (creating || next === activeMode || next === 'group' && !allowGroup) return; onQuery(''); setMode(next); };
    const submit = async (action: (() => Promise<void>) | undefined) => { if (!action || readOnly) throw Error(msg('tags.saveFailed')); setCreating(true); try { await action(); } finally { setCreating(false); } };
    return <div className="tag-search"><div className="tag-library-input">
        {activeMode === 'search' ? <input ref={search} value={query} aria-label={msg('tags.search')} placeholder={msg('tags.search')} onChange={event => onQuery(event.target.value)}/>
            : activeMode === 'create' ? <TagInput libraryMode disabled={readOnly && !creating} availableTags={library.tags} onCancel={() => {}} onCommit={(name, id) => submit(onCreate ? () => onCreate(name, id) : undefined)}/>
                : <NewGroupInput libraryMode value={groupDraft} onValueChange={setGroupDraft} keepDraftOnBlur={target => target instanceof Element && !!target.closest('[data-tag-view],[data-tag-input-mode]')}
                    busy={creating || readOnly} onCancel={() => {}} onCreate={name => submit(onCreateGroup ? () => onCreateGroup(name) : undefined)}/>}
        <span className="tag-input-modes">{(['search', 'create', 'group'] as const).map(item => {
            const unavailable = item === 'group' && !allowGroup;
            return <span key={item} className="tag-mode-option" data-tag-input-mode={item} data-action-tip={unavailable ? msg('tags.groupModeUnavailable') : undefined} tabIndex={unavailable ? 0 : undefined}>
                <button type="button" aria-label={msg(item === 'search' ? 'tags.search' : item === 'create' ? 'tags.newTag' : 'tags.newGroup')} aria-pressed={activeMode === item}
                    data-tip={unavailable ? undefined : msg(item === 'search' ? 'tags.search' : item === 'create' ? 'tags.newTag' : 'tags.newGroup')}
                    disabled={creating || unavailable || item !== 'search' && readOnly} onPointerDown={event => event.preventDefault()} onClick={() => change(item)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        {item === 'group' ? <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3"/>
                            : item === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></> : <path d="M12 4v16M4 12h16"/>}
                    </svg>
                </button>
            </span>;
        })}</span>
    </div></div>;
}
