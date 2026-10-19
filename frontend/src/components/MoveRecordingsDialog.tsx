import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { msg, useInterfaceLanguage } from '../i18n';
import { trapDialogFocus, useModalDialog } from '../lib/dialogFocus';
import type { ProjectInterview } from '../lib/projectStore';

export function MoveRecordingsDialog({ source, sessions, count, busy, error, onCancel, onConfirm }: {
  source: ProjectInterview; sessions: ProjectInterview[]; count: number; busy: boolean; error: string;
  onCancel: () => void; onConfirm: (target: string) => void;
}) {
  useInterfaceLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState('');
  useModalDialog(ref);
  return createPortal(<dialog ref={ref} tabIndex={-1} className="material-preview-dialog audio-project-dialog"
    aria-label={msg('recordingMove.title')} onKeyDown={trapDialogFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="dialog-header"><h2>{msg('recordingMove.title')}</h2></div>
    <p>{msg('recordingMove.summary', { count, source: source.title })}</p>
    <fieldset disabled={busy} className="recording-move-destinations">
      <legend>{msg('recordingMove.destination')}</legend>
      {sessions.filter(session => session.id !== source.id).map(session => <label key={session.id}>
        <input type="radio" name="recording-move-target" value={session.id} checked={target === session.id}
          onChange={() => setTarget(session.id)} />{session.title}
      </label>)}
    </fieldset>
    <p className="settings-hint">{msg('recordingMove.metadata')}</p>
    {busy && <p role="status">{msg('recordingMove.working')}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="project-actions audio-project-footer">
      <button className="cred-btn" data-dialog-initial-focus disabled={busy} onClick={onCancel}>{msg('recordingMove.cancel')}</button>
      <button className="cred-btn" disabled={busy || !sessions.some(session => session.id === target && session.id !== source.id)}
        onClick={() => onConfirm(target)}>{msg('recordingMove.confirm')}</button>
    </div>
  </dialog>, document.body);
}
