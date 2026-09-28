import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
type Storage = 'copy' | 'reference';
export function AudioStorageDialog({ names, referenceable, selectReference, finish }: { names: string[]; referenceable: boolean; selectReference?: () => Promise<boolean>; finish: (value: Storage | null) => void }) {
  useInterfaceLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [storage, setStorage] = useState<Storage>('copy');
  const [referenceReady, setReferenceReady] = useState(referenceable);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const canReselect = Boolean(!referenceReady && selectReference && typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function');
  const chooseReference = async () => {
    if (referenceReady) { setStorage('reference'); return; }
    if (!canReselect || checking) return;
    setChecking(true); setError('');
    try { if (await selectReference?.()) { setReferenceReady(true); setStorage('reference'); } }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setChecking(false); }
  };
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog ref={dialog} className="material-preview-dialog audio-project-dialog" aria-label={msg('AudioStorageDialog.m0365')} onCancel={e => { e.preventDefault(); if (!checking) finish(null); }}>
    <div className="dialog-header"><h2>{msg('AudioStorageDialog.m0366')}</h2></div>
    <p className="settings-hint audio-storage-filename">{names.length === 1 ? names[0] : msg('AudioStorageDialog.m0367', { v0: names.length })}</p>
    <label className="setup-storage"><input type="radio" name="incoming-audio-storage" disabled={checking} checked={storage === 'copy'} onChange={() => setStorage('copy')}/><span>{msg('AudioStorageDialog.m0368')}<small>{msg('AudioStorageDialog.m0369')}</small></span></label>
    <label className="setup-storage"><input type="radio" name="incoming-audio-storage" checked={storage === 'reference'} disabled={(!referenceReady && !canReselect) || checking} onChange={() => void chooseReference()}/><span>{msg('AudioStorageDialog.m0370')}<small>{msg('AudioStorageDialog.m0371')}</small>{!referenceReady && <small>{msg(canReselect ? 'AudioStorageDialog.reselectHint' : 'AudioStorageDialog.m0372')}</small>}</span></label>
    {error && <p className="form-error audio-storage-feedback" role="alert">{uiMessage(error)}</p>}
    {checking && <p className="settings-hint audio-storage-feedback" role="status">{msg('AudioStorageDialog.checking')}</p>}
    <div className="project-actions audio-project-footer"><button className="button button--secondary" disabled={checking} onClick={() => finish(null)}>{msg('AudioStorageDialog.m0373')}</button><button className="button button--primary" disabled={checking} onClick={() => finish(storage)}>{msg('AudioStorageDialog.m0374')}</button></div>
  </dialog>, document.body);
}
