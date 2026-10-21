import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { msg, useInterfaceLanguage } from '../i18n';
import { trapDialogFocus, useModalDialog } from '../lib/dialogFocus';
import { ProjectIcon } from './ProjectIcon';
import type { ProjectInterview } from '../lib/projectStore';

export function MoveRecordingsDialog({ source, sessions, count, names, busy, error, onCancel, onConfirm }: {
  source: ProjectInterview; sessions: ProjectInterview[]; count: number; names: string[]; busy: boolean; error: string;
  onCancel: () => void; onConfirm: (target: string) => void;
}) {
  useInterfaceLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState('');
  useModalDialog(ref);
  return createPortal(<dialog ref={ref} tabIndex={-1} className="material-preview-dialog audio-project-dialog recording-move-dialog"
    aria-label={msg('recordingMove.title')} onKeyDown={trapDialogFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="dialog-header"><h2>{msg('recordingMove.title')}</h2></div>
    <div className="recording-move-body">
      <div className="recording-move-material">
        <ProjectIcon kind="audio"/>
        <div><p className="recording-move-name">{count === 1 ? names[0] : msg('recordingMove.selection', { count })}</p>
          <p className="recording-move-origin">{msg('recordingMove.origin', { source: source.title })}</p>
        </div>
      </div>
      {count > 1 && <ul className="recording-move-names">{names.map((name,index) => <li key={index}>{name}</li>)}</ul>}
      <p className="recording-move-summary">{msg('recordingMove.summary')}</p>
      <fieldset disabled={busy} className="recording-move-destinations trash-delete-options">
        <legend>{msg('recordingMove.destination')}</legend>
        {sessions.filter(session => session.id !== source.id).map(session => <label key={session.id} className={target === session.id ? 'is-selected' : ''}>
          <input type="radio" name="recording-move-target" value={session.id} checked={target === session.id}
            onChange={() => setTarget(session.id)} /><span>{session.title}</span>
        </label>)}
      </fieldset>
      <p className="settings-hint">{msg('recordingMove.metadata')}</p>
      {busy && <p className="recording-move-feedback" role="status">{msg('recordingMove.working')}</p>}
      {error && <p className="recording-move-feedback form-error" role="alert">{error}</p>}
    </div>
    <div className="project-actions audio-project-footer">
      <button className="cred-btn" data-dialog-initial-focus disabled={busy} onClick={onCancel}>{msg('recordingMove.cancel')}</button>
      <button className="cred-btn" disabled={busy || !sessions.some(session => session.id === target && session.id !== source.id)}
        onClick={() => onConfirm(target)}>{msg('recordingMove.confirm')}</button>
    </div>
  </dialog>, document.body);
}
