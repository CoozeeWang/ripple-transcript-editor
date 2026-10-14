import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { interfaceLanguage, msg, useInterfaceLanguage } from '../i18n';
import { nativeDesktopAvailable } from '../lib/desktopFs';
import { ChatGPTSetup } from './ChatGPTSetup';
import { trapDialogFocus } from '../lib/dialogFocus';

type Client = 'chatgpt' | 'claude' | 'workbuddy';
async function invoke<T>(command: string, args?: Record<string, string>): Promise<T> {
  if (!nativeDesktopAvailable()) throw new Error('desktop_required');
  return (window as unknown as {__TAURI__: {core: {invoke: (command: string, args?: Record<string, string>) => Promise<T>}}}).__TAURI__.core.invoke(command, args);
}
export function ConnectorSetup({onSaved}: {onSaved?: () => void}) {
  useInterfaceLanguage();
  const [client, setClient] = useState<Client>('chatgpt');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [exported, setExported] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [revision, setRevision] = useState(0);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [tunnelReady,setTunnelReady]=useState(false);
  useEffect(()=>{let disposed=false;const check=()=>{void invoke<boolean>('connector_tunnel_ready').then(value=>{if(!disposed)setTunnelReady(value);}).catch(()=>{if(!disposed)setTunnelReady(false);});};if(client==='chatgpt')check();const timer=client==='chatgpt'?setInterval(check,5000):undefined;return()=>{disposed=true;clearInterval(timer);};},[client,revision]);
  useEffect(() => {
    let disposed = false;
    void invoke<{client: Client}>('connector_client_status').then(value => {if (!disposed) setClient(value.client);})
      .catch(() => {if (!disposed) setError(true);}).finally(() => {if (!disposed) setBusy(false);});
    return () => {disposed = true;};
  }, []);
  async function select(value: Client) {
    setBusy(true); setError(false); setExported(''); setDeleted(false);
    try {await invoke('connector_client_select', {client: value}); setClient(value);}
    catch {setError(true);} finally {setBusy(false);}
  }
  async function addClient() {
    setBusy(true); setError(false); setExported(''); setDeleted(false);
    try {const result = await invoke<string>('connector_client_add', {client, language: interfaceLanguage()}); setExported(result === 'cancelled' ? '' : result);}
    catch {setError(true);} finally {setBusy(false);}
  }
  async function deleteClient(target: Client) {
    setBusy(true); setDeleteError(''); setDeleted(false);
    try {
      await invoke('connector_client_delete', {client: target});
      setConfirmDelete(null); setDeleted(true); setExported(''); setError(false);
      if (target === 'chatgpt') { setTunnelReady(false); setRevision(value => value + 1); }
      // Do not reconnect the shared editor lease: other clients keep working.
    } catch (error) {
      setDeleteError(String(error) === 'connector_client_busy' ? 'connector.deleteBusy' : 'connector.deleteError');
    } finally { setBusy(false); }
  }
  const clientName = client === 'workbuddy' ? 'WorkBuddy' : msg(client === 'chatgpt' ? 'connector.chatgptWeb' : 'connector.claudeDesktop');
  return <div className="connector-setup" aria-busy={busy}>
    <div className="connector-client-selection">
      <div className="cred-profile__fields"><label className="cred-field">
        <span className="cred-field__label">{msg('connector.software')}</span>
        <span className="cred-field__input"><select value={client} disabled={busy} onChange={event => void select(event.target.value as Client)}>
          <option value="chatgpt">{msg('connector.chatgptWeb')}</option><option value="claude">{msg('connector.claudeDesktop')}</option><option value="workbuddy">WorkBuddy</option>
        </select></span><span className="cred-field__hint">{msg('connector.softwareHint')}</span>
      </label></div>
      {client !== 'chatgpt' && <>
        <ol className="settings-hint connector-steps"><li>{msg(`connector.${client}Step1`)}</li><li>{msg(`connector.${client}Step2`)}</li><li>{msg(client === 'workbuddy' ? 'connector.workbuddyStep3' : 'connector.localStep3')}</li></ol>
      </>}
      <div className="cred-profile__actions connector-config-actions">
        {client !== 'chatgpt' && <button type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={() => void addClient()}>{msg(`connector.${client}Add`)}</button>}
        <button ref={deleteButtonRef} type="button" className="cred-btn cred-btn--danger" disabled={busy} onClick={() => {setConfirmDelete(client); setDeleteError('');}}>{msg('connector.deleteConfiguration')}</button>
      </div>
      {deleted && <p className="settings-hint" role="status">{msg('connector.configurationDeleted', {client:clientName})}</p>}
      {exported && <p className="settings-hint" role="status">{msg(`connector.added_${exported}`)}</p>}
      {error && <p className="settings-hint connector-error" role="alert">{msg(`connector.addError_${client}`)}</p>}
    </div>
    {client === 'chatgpt' && !busy && <ChatGPTSetup key={revision} onSaved={() => {setTunnelReady(false); onSaved?.();}} tunnelReady={tunnelReady}/>}
    {confirmDelete && <DeleteConnectorDialog clientName={clientName} busy={busy} error={deleteError} opener={deleteButtonRef}
      onCancel={() => {setConfirmDelete(null); setDeleteError('');}}
      onDelete={() => void deleteClient(confirmDelete)} />}
  </div>;
}

function DeleteConnectorDialog({clientName,busy,error,opener,onCancel,onDelete}: {
  clientName:string; busy:boolean; error:string; opener:{current:HTMLButtonElement|null}; onCancel:()=>void; onDelete:()=>void;
}) {
  const ref=useRef<HTMLDialogElement>(null), cancelRef=useRef<HTMLButtonElement>(null);
  const titleId=useId(), descriptionId=useId();
  useEffect(() => {
    const dialog=ref.current, previous=document.activeElement, trigger=opener.current;
    dialog?.showModal(); cancelRef.current?.focus();
    return () => {if(dialog?.open)dialog.close();if(trigger?.isConnected)trigger.focus();else if(previous instanceof HTMLElement && previous.isConnected)previous.focus();};
  },[opener]);
  useEffect(() => {if(error && !busy)cancelRef.current?.focus();},[busy,error]);
  return createPortal(<dialog ref={ref} className="material-preview-dialog audio-project-dialog connector-delete-dialog"
    aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={trapDialogFocus}
    onCancel={event => {event.preventDefault();event.stopPropagation();if(!busy)onCancel();}}>
    <div className="dialog-header"><h2 id={titleId}>{msg('connector.deleteTitle',{client:clientName})}</h2></div>
    <p id={descriptionId} className="settings-hint">{msg('connector.deleteDescription')}</p>
    <p className="settings-hint">{msg('connector.deleteRemoteHint')}</p>
    {error && <p className="form-error" role="alert">{msg(error)}</p>}
    <div className="project-actions audio-project-footer">
      <button ref={cancelRef} type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>{msg('connector.cancelDelete')}</button>
      <button type="button" className="button button--danger" disabled={busy} onClick={onDelete}>{msg(busy?'connector.deletingConfiguration':'connector.confirmDelete')}</button>
    </div>
  </dialog>,document.body);
}
