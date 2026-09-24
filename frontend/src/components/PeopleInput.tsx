import { msg, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';

export function PeopleInput({ names, onChange, disabled = false }: { names: string[]; onChange: (names: string[]) => void; disabled?: boolean }) {
  useInterfaceLanguage();
  const resumeFocus = useRef(false);
  useEffect(() => { if (!disabled && resumeFocus.current) { inputRef.current?.focus(); resumeFocus.current = false; } }, [disabled]);
  const inputRef = useRef<HTMLInputElement>(null);
  const remove = (index: number) => { resumeFocus.current = true; onChange(names.filter((_, i) => i !== index)); inputRef.current?.focus(); };
  const [text, setText] = useState('');
  const add = () => {
    const name = text.trim();
    if (name && !names.includes(name)) { resumeFocus.current = document.activeElement === inputRef.current; onChange([...names, name]); }
    setText('');
  };
  return <div className="people-input">
    {names.map((name, index) => <button className="people-chip" type="button" key={`${name}-${index}`} disabled={disabled} aria-label={msg('PeopleInput.m0624', { v0: name })} title={msg('PeopleInput.m0625')} onKeyDown={e => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault(); e.stopPropagation(); remove(index);
      }
    }}>{name}</button>)}
    <input ref={inputRef} aria-label={msg('PeopleInput.m0626')} placeholder={msg('PeopleInput.namePlaceholder')} disabled={disabled} value={text} onChange={e => setText(e.target.value)} onBlur={add} onKeyDown={e => {
      if (e.key === 'Backspace' && !text && names.length && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault(); e.stopPropagation(); remove(names.length - 1);
      }
      if (e.key === 'Enter') {
        e.preventDefault();e.stopPropagation();
        if (!e.nativeEvent.isComposing && e.keyCode !== 229) add();
      }
    }} />
  </div>;
}
