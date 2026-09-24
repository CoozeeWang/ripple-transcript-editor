import { msg, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { registerEditorDraft } from '../lib/editorDrafts';

export function ProjectFileName({ name, label, editing, disabled, onOpen, onRename, onFinish }: {
  name: string; label: string; editing: boolean; disabled: boolean;
  onOpen: () => void; onRename: (name: string) => void; onFinish: () => void;
}) {
  useInterfaceLanguage();
  const [draft, setDraft] = useState(name);
  const [wasEditing, setWasEditing] = useState(editing);
  if (editing !== wasEditing) { setWasEditing(editing); if (editing) setDraft(name); }
  const input = useRef<HTMLInputElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const restoreKeyboardFocus = useRef(false);
  useEffect(() => {
    if (!editing && !disabled && restoreKeyboardFocus.current) {
      restoreKeyboardFocus.current = false;
      openButton.current?.focus();
    }
  }, [editing, disabled]);
  const finished = useRef(false);
  useEffect(() => { if (editing && !disabled) { finished.current = false; input.current?.focus(); input.current?.select(); } }, [editing, name, disabled]);
  useEffect(() => registerEditorDraft(() => editing && draft !== name), [editing, draft, name]);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onFinish();
    if (save && draft.trim() && draft.trim() !== name) onRename(draft.trim());
  };
  return editing ? <input ref={input} className="project-file-name-edit" aria-label={msg('ProjectFileName.m0766', { v0: label })} value={draft} disabled={disabled}
    onChange={e => setDraft(e.target.value)} onBlur={() => finish(true)} onKeyDown={e => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); restoreKeyboardFocus.current = true; finish(e.key === 'Enter'); }
    }}/> : <button ref={openButton} type="button" className="project-file-open" disabled={disabled} aria-label={msg('ProjectFileName.m0767', { v0: label, v1: name })} data-tip={msg('ProjectFileName.m0768')} data-tip-pos="top" onClick={onOpen}>{name}</button>;
}
