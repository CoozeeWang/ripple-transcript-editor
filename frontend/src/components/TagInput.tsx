import { useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import { TagCandidatesContext } from '../lib/tagCandidates';
import { createPortal } from 'react-dom';
import { tagErrorMessage } from '../lib/tagErrors';
import { TagPill } from './TagPill';
import { msg } from '../i18n';
import { tagPath, normalizeTagName, sortTags, suggestTags, type ProjectTag } from '../lib/tags';
export function TagInput({ onCommit, onCancel, availableTags: suppliedTags, assignedIds = [], libraryMode = false, disabled = false }: {
    libraryMode?:boolean;
    disabled?:boolean;
    onCommit: (name: string, tagId?:string) => void | Promise<void>;
    onCancel: (reason: 'escape' | 'blur') => void;
    availableTags?: readonly ProjectTag[];
    assignedIds?: readonly string[];
}) {
    const candidates = useContext(TagCandidatesContext), availableTags = suppliedTags ?? candidates;
    const [value, setValue] = useState(''),[submitting,setSubmitting]=useState(false),[focused,setFocused]=useState(true), [error, setError] = useState(''), [active, setActive] = useState(-1), input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null), composing = useRef(false), pending=useRef(false),restoreCommit=useRef(false), id = useId();
    const submit=(name:string,id?:string)=>{
        if(pending.current||disabled)return;
        try {const result=id?onCommit(name,id):onCommit(name);if(result&&typeof result.then==='function'){pending.current=true;setSubmitting(true);void result.then(()=>{if(libraryMode){setValue('');setActive(-1);restoreCommit.current=true}},error=>setError(tagErrorMessage(error))).finally(()=>{pending.current=false;setSubmitting(false)})}}
        catch(error){setError(tagErrorMessage(error))}
    };
    useLayoutEffect(()=>{if(!submitting&&(error||restoreCommit.current)){restoreCommit.current=false;input.current?.focus()}},[error,submitting]);
    const cancel=(reason:'escape'|'blur')=>{if(libraryMode){setValue('');setActive(-1);setError('')}onCancel(reason)};
    const suggestions = !focused?[]:value.trim() ? suggestTags(availableTags, value, assignedIds)
        : sortTags(availableTags.filter(tag => !assignedIds.includes(tag.id)), 'name', 1, () => 0), selected = suggestions[active];
    useLayoutEffect(() => { input.current?.focus(); }, []);
    useLayoutEffect(() => {
        if (!suggestions.length || !popup.current || !input.current) return;
        const position = () => {
            const rect = input.current!.getBoundingClientRect(), menu = popup.current!;
            // Narrow transcript columns can leave only a few characters before the
            // action buttons. Keep full-path choices readable without moving the input.
            menu.style.width = `${Math.min(Math.max(rect.width, 180), window.innerWidth - 16)}px`;
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
    const parentPath = (tag: ProjectTag) => {
        const path = tagPath({ schemaVersion: 3, tags: [...availableTags], groups: [] }, tag.id);
        return path.slice(0, path.lastIndexOf('/') + 1);
    };
    return <span className={libraryMode?'tag-library-create-entry':'tag-entry'} onClick={e => e.stopPropagation()}><input ref={input} disabled={submitting||disabled} role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls={suggestions.length ? id : undefined} aria-activedescendant={selected ? `${id}-${selected.id}` : undefined} aria-label={msg(libraryMode?'tags.newTag':'tags.input')} placeholder={libraryMode?msg('tags.newTag'):undefined} value={value} maxLength={1024} onChange={e => { setValue(e.target.value); setError(''); setActive(-1); }} onFocus={()=>setFocused(true)} onBlur={() => {setFocused(false);if(!pending.current)cancel('blur')}} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229)
                return;
            if (e.key === 'Escape') {
                e.preventDefault();
                cancel('escape');
            }
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
                e.preventDefault();
                setActive(old => old < 0 ? (e.key === 'ArrowDown' ? 0 : suggestions.length - 1) : (old + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
            }
            if (e.key === 'Enter' || e.key === ' '&&!libraryMode) {
                e.preventDefault();
                if (e.key === 'Enter' && selected) { submit(selected.name,selected.id); return; }
                const name = normalizeTagName(value);
                if (!name) {
                    cancel('escape');
                    return;
                }
                if (Array.from(name).some(c => c.charCodeAt(0) < 32)) {
                    setError(msg('tags.invalidName'));
                    return;
                }
                submit(name);
            }
        }}/>{suggestions.length > 0 && createPortal(<div ref={popup} id={id} className="tag-suggestions" role="listbox" aria-label={msg('tags.suggestions')} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }} onMouseDown={e => e.preventDefault()} onClick={e => e.stopPropagation()}>{suggestions.map((tag, index) => <div id={`${id}-${tag.id}`} key={tag.id} role="option" aria-selected={active === index} onPointerMove={() => setActive(index)} onClick={() => { if (!composing.current) submit(tag.name,tag.id); }}><TagPill name={tag.name}/><small className="tag-suggestion-path">{parentPath(tag)}</small></div>)}</div>, document.body)}{error && <span role="alert">{error}</span>}</span>;
}
