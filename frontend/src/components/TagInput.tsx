import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TagPill } from './TagPill';
import { msg } from '../i18n';
import { normalizeTagName, suggestTags, type ProjectTag } from '../lib/tags';
export function TagInput({ onCommit, onCancel, availableTags = [], assignedIds = [] }: {
    onCommit: (name: string) => void;
    onCancel: () => void;
    availableTags?: readonly ProjectTag[];
    assignedIds?: readonly string[];
}) {
    const [value, setValue] = useState(''), [error, setError] = useState(false), [active, setActive] = useState(-1), input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null), composing = useRef(false), id = useId();
    const suggestions = suggestTags(availableTags, value, assignedIds), selected = suggestions[active];
    useEffect(() => { input.current?.focus(); }, []);
    useLayoutEffect(() => {
        if (!suggestions.length || !popup.current || !input.current) return;
        const position = () => {
            const rect = input.current!.getBoundingClientRect(), menu = popup.current!;
            menu.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
            menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
            const below = window.innerHeight - rect.bottom - 14, above = rect.top - 14, upwards = below < Math.min(menu.scrollHeight, 180) && above > below;
            menu.style.maxHeight = `${Math.max(0, Math.min(200, upwards ? above : below))}px`;
            menu.style.top = `${upwards ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6}px`;
        };
        position(); const observer = new ResizeObserver(position); observer.observe(input.current); observer.observe(popup.current);
        window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
        return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
    }, [value, suggestions.length]);
    useLayoutEffect(() => { popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
    return <span className="tag-entry" onClick={e => e.stopPropagation()}><input ref={input} role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls={suggestions.length ? id : undefined} aria-activedescendant={selected ? `${id}-${selected.id}` : undefined} aria-label={msg('tags.input')} value={value} maxLength={120} onChange={e => { setValue(e.target.value); setError(false); setActive(-1); }} onBlur={onCancel} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229)
                return;
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
                e.preventDefault();
                setActive(old => old < 0 ? (e.key === 'ArrowDown' ? 0 : suggestions.length - 1) : (old + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (e.key === 'Enter' && selected) { onCommit(selected.name); return; }
                const name = normalizeTagName(value);
                if (!name) {
                    onCancel();
                    return;
                }
                if (Array.from(name).some(c => c.charCodeAt(0) < 32)) {
                    setError(true);
                    return;
                }
                onCommit(name);
            }
        }}/>{suggestions.length > 0 && createPortal(<div ref={popup} id={id} className="tag-suggestions" role="listbox" aria-label={msg('tags.suggestions')} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }} onMouseDown={e => e.preventDefault()} onClick={e => e.stopPropagation()}>{suggestions.map((tag, index) => <div id={`${id}-${tag.id}`} key={tag.id} role="option" aria-selected={active === index} onPointerMove={() => setActive(index)} onClick={() => { if (!composing.current) onCommit(tag.name); }}><TagPill name={tag.name}/></div>)}</div>, document.body)}{error && <span role="alert">{msg('tags.invalidName')}</span>}</span>;
}
