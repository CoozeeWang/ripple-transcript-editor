import { useLayoutEffect, useRef, useState } from 'react';
import { msg } from '../i18n';

export function NewGroupInput({ busy, onCreate, onCancel, libraryMode=false, value, onValueChange, keepDraftOnBlur }: {
    value?: string;
    onValueChange?: (value: string) => void;
    keepDraftOnBlur?: (target: EventTarget | null) => boolean;
    libraryMode?: boolean;
    busy: boolean;
    onCreate: (name: string) => Promise<void>;
    onCancel: (reason: 'escape' | 'blur') => void;
}) {
    const input = useRef<HTMLInputElement>(null), composing = useRef(false), pending = useRef(false);
    const [draft, setDraft] = useState(''), [error, setError] = useState('');
    const name = value ?? draft, setName = onValueChange ?? setDraft;
    useLayoutEffect(() => { input.current?.focus(); }, []);
    useLayoutEffect(() => { if (error) input.current?.focus(); }, [error]);
    return <span className="new-group-entry"><input ref={input} aria-label={msg('tags.groupName')} placeholder={libraryMode?msg('tags.newGroup'):undefined} maxLength={120} value={name} disabled={busy} onChange={e => { setName(e.target.value); setError(''); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onBlur={event => { if (!pending.current) {if (!keepDraftOnBlur?.(event.relatedTarget)) setName('');setError('');onCancel('blur');} }} onKeyDown={e => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229 || pending.current) return;
            if (e.key === 'Escape') { e.preventDefault(); setName('');setError('');onCancel('escape'); }
            if (e.key === 'Enter') {
                e.preventDefault(); if (!name.trim()) return;
                pending.current = true;
                void onCreate(name.trim()).then(()=>{setName('');queueMicrotask(()=>input.current?.focus())},error => setError(error instanceof Error ? error.message : msg('tags.saveFailed'))).finally(() => { pending.current = false; });
            }
        }}/>{error && <span className="tag-error" role="alert">{error}</span>}</span>;
}
