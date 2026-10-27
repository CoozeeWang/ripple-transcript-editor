import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { trapDialogFocus } from '../lib/dialogFocus';

export function DeleteSessionDialog({ name, busy, changed, error, onCancel, onDelete }: {
  name: string; busy: boolean; changed: boolean; error: string;
  onCancel: () => void; onDelete: () => void;
}) {
  useInterfaceLanguage();
  const ref = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const title = useId(), description = useId();
  useEffect(() => {
    const modal = ref.current, previous = document.activeElement;
    modal?.showModal(); cancel.current?.focus();
    return () => {
      if (modal?.open) modal.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<dialog ref={ref} className="material-preview-dialog audio-project-dialog"
    aria-labelledby={title} aria-describedby={description} onKeyDown={trapDialogFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="dialog-header"><h2 id={title}>{msg('sessionTrash.deleteTitle')}</h2></div>
    <p className="trash-material-name">{name}</p>
    <p id={description} className="settings-hint">{msg('sessionTrash.deleteDescription')}</p>
    {(changed || error) && <p className="form-error" role="alert">{changed ? msg('sessionTrash.changed') : uiMessage(error)}</p>}
    <div className="project-actions audio-project-footer">
      <button ref={cancel} className="button button--secondary" disabled={busy} onClick={onCancel}>{msg('sessionTrash.cancel')}</button>
      <button className="button button--danger" disabled={busy || changed} onClick={onDelete}>{msg('sessionTrash.confirm')}</button>
    </div>
  </dialog>, document.body);
}
