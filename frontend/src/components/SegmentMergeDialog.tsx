import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { msg, useInterfaceLanguage } from '../i18n';
import { trapDialogFocus, useModalDialog } from '../lib/dialogFocus';

export function SegmentMergeDialog({ changed, readOnly, onCancel, onConfirm }: {
  changed: boolean; readOnly: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  useInterfaceLanguage();
  const ref = useRef<HTMLDialogElement>(null), title = useId(), description = useId();
  useModalDialog(ref);
  return createPortal(<dialog ref={ref} className="material-preview-dialog audio-project-dialog"
    aria-labelledby={title} aria-describedby={description} onKeyDown={trapDialogFocus}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div className="dialog-header"><h2 id={title}>{msg('SegmentItem.m0954')}</h2></div>
    <p id={description} className="settings-hint">{msg('useEditor.m1114')}</p>
    {(changed || readOnly) && <p className="form-error" role="alert">{msg('segmentMerge.changed')}</p>}
    <div className="project-actions audio-project-footer">
      <button data-dialog-initial-focus className="button button--secondary" onClick={onCancel}>{msg('Dialogs.m0474')}</button>
      <button className="button button--primary" disabled={changed || readOnly} onClick={onConfirm}>{msg('Dialogs.m0475')}</button>
    </div>
  </dialog>, document.body);
}
