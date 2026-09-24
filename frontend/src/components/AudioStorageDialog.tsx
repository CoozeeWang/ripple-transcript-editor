import { msg, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
type Storage = 'copy' | 'reference';
export function AudioStorageDialog({ names, referenceable, finish }: { names: string[]; referenceable: boolean; finish: (value: Storage | null) => void }) {
  useInterfaceLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [storage, setStorage] = useState<Storage>('copy');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog ref={dialog} className="material-preview-dialog audio-project-dialog" aria-label={msg('AudioStorageDialog.m0365')} onCancel={e => { e.preventDefault(); finish(null); }}>
    <div className="dialog-header"><h2>{msg('AudioStorageDialog.m0366')}</h2></div>
    <p className="settings-hint">{names.length === 1 ? names[0] : msg('AudioStorageDialog.m0367', { v0: names.length })}</p>
    <label className="setup-storage"><input type="radio" name="incoming-audio-storage" checked={storage === 'copy'} onChange={() => setStorage('copy')}/><span>{msg('AudioStorageDialog.m0368')}<small>{msg('AudioStorageDialog.m0369')}</small></span></label>
    <label className="setup-storage"><input type="radio" name="incoming-audio-storage" checked={storage === 'reference'} disabled={!referenceable} onChange={() => setStorage('reference')}/><span>{msg('AudioStorageDialog.m0370')}<small>{msg('AudioStorageDialog.m0371')}</small></span></label>
    {!referenceable && <p className="settings-hint">{msg('AudioStorageDialog.m0372')}</p>}
    <div className="project-actions audio-project-footer"><button className="button button--secondary" onClick={() => finish(null)}>{msg('AudioStorageDialog.m0373')}</button><button className="button button--primary" onClick={() => finish(storage)}>{msg('AudioStorageDialog.m0374')}</button></div>
  </dialog>, document.body);
}
