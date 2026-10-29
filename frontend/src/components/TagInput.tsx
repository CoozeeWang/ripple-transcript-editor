import { useEffect, useRef, useState } from 'react';
import { msg } from '../i18n';
import { normalizeTagName } from '../lib/tags';
export function TagInput({ onCommit, onCancel }: {
    onCommit: (name: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(''), [error, setError] = useState(false), input = useRef<HTMLInputElement>(null), composing = useRef(false);
    useEffect(() => { input.current?.focus(); }, []);
    return <span className="tag-entry" onClick={e => e.stopPropagation()}><input ref={input} aria-label={msg('tags.input')} value={value} maxLength={120} onChange={e => { setValue(e.target.value); setError(false); }} onBlur={onCancel} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229)
                return;
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
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
        }}/>{error && <span role="alert">{msg('tags.invalidName')}</span>}</span>;
}
