import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { msg } from '../i18n';
import { normalizeTagName } from '../lib/tags';

/** Edits an existing project entity; cancellation never creates or merges a tag. */
export function InlineTagName({ name, enabled, onRename, children, canBegin, onEditingChange, focusable = false, maxLength = 120, label, row = false }: {
    row?: boolean;
    label?:string;
    maxLength?: number;
    name: string;
    enabled: boolean;
    onRename?: (name: string) => Promise<void>;
    children: ReactNode;
    canBegin?: (time: number) => boolean;
    onEditingChange?: (editing: boolean) => void;
    focusable?: boolean;
}) {
    const [editing, setEditing] = useState(false), [draft, setDraft] = useState(name), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const root = useRef<HTMLSpanElement>(null), input = useRef<HTMLInputElement>(null), composing = useRef(false), pending = useRef(false), restore = useRef(false), dragUntil = useRef(0);
    const returnContainer=useRef<HTMLElement|null>(null);
    useLayoutEffect(() => {
        if (editing) { input.current?.focus(); input.current?.select(); }
        else if (restore.current) {
            restore.current = false;
            (root.current?.querySelector<HTMLElement>('button') ?? (root.current?.tabIndex === 0 ? root.current : root.current?.closest<HTMLElement>('.tag-pill')))?.focus({ preventScroll: true });
        }
    }, [editing]);
    useLayoutEffect(() => { if (error && !busy) input.current?.focus(); }, [error, busy]);
    useEffect(() => {
        if (enabled || !editing || pending.current) return;
        let cancelled = false;
        queueMicrotask(() => { if (!cancelled && !pending.current) { setEditing(false); setError(''); onEditingChange?.(false); } });
        return () => { cancelled = true; };
    }, [enabled, editing, onEditingChange]);
    const finish = (focus: boolean) => { restore.current = focus; setEditing(false); setError(''); onEditingChange?.(false);
        // A confirmed merge can replace the edited stable ID and unmount this editor.
        // Restore within its original segment/list only if normal focus restoration had no target.
        if(focus&&typeof requestAnimationFrame==='function')requestAnimationFrame(()=>{
            if(document.querySelector('dialog[open]')||document.activeElement!==document.body)return;
            const container=returnContainer.current;
            if(container?.isConnected)container.querySelector<HTMLElement>('.tag-name-edit[tabindex="0"], .library-filter, button:not(:disabled)')?.focus({preventScroll:true});
        });
    };
    const begin = () => { returnContainer.current=root.current?.closest<HTMLElement>('.segment,.library-list')??null;setDraft(name); setError(''); setEditing(true); onEditingChange?.(true); };
    return <span ref={root} role={focusable && enabled && onRename && !editing ? 'button' : undefined} tabIndex={focusable && enabled && onRename && !editing ? 0 : undefined} className={'tag-name-edit' + (row ? ' tag-name-edit--row' : '') + (editing ? ' is-editing' : focusable && enabled ? ' is-trigger' : '')}
        onKeyDown={event => { if (!editing && event.key === 'F2' && enabled && onRename && canBegin?.(event.timeStamp) !== false) { event.preventDefault(); event.stopPropagation(); begin(); } }}
        onDragStart={() => { dragUntil.current = performance.now() + 500; }} onDragEnd={() => { dragUntil.current = performance.now() + 500; }}
        onDoubleClick={event => {
            if (!enabled || !onRename || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || performance.now() < dragUntil.current || canBegin?.(event.timeStamp) === false) return;
            event.preventDefault(); event.stopPropagation(); begin();
        }}>
        {editing ? <><input ref={input} value={draft} maxLength={maxLength} size={Math.min(24, Math.max(4, draft.length + 1))} aria-label={label??msg('tags.renameTag')} disabled={busy} onChange={event => { setDraft(event.target.value); setError(''); }}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onBlur={() => { if (!pending.current) finish(false); }} onKeyDown={event => {
                event.stopPropagation();
                if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229 || pending.current) return;
                if (event.key === 'Escape') { event.preventDefault(); finish(true); }
                if (event.key === 'Enter' && enabled) {
                    event.preventDefault(); const next = normalizeTagName(draft);
                    if (!next || Array.from(next).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) { setError(msg('tags.invalidName')); return; }
                    if (next === name) { finish(true); return; }
                    pending.current = true; setBusy(true);
                    void onRename!(next).then(() => finish(true), error => setError(error instanceof Error ? error.message : msg('tags.saveFailed'))).finally(() => { pending.current = false; setBusy(false); });
                }
            }}/>{error && <span role="alert" className="tag-name-error">{error}</span>}</> : children}
    </span>;
}
