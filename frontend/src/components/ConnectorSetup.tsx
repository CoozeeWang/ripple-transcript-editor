import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { interfaceLanguage, msg, useInterfaceLanguage } from '../i18n';
import { nativeDesktopAvailable } from '../lib/desktopFs';
import { ChatGPTSetup, type ChatGPTSetupHandle } from './ChatGPTSetup';
import { trapDialogFocus } from '../lib/dialogFocus';
import { useTransientState } from '../hooks/useTransientState';
import { FeedbackNotice } from './FeedbackNotice';

type Client = 'chatgpt' | 'claude' | 'workbuddy';
type ClientStatus = {client:Client; configured:Record<Client, boolean | null>};
async function invoke<T>(command: string, args?: Record<string, string>): Promise<T> {
  if (!nativeDesktopAvailable()) throw new Error('desktop_required');
  return (window as unknown as {__TAURI__: {core: {invoke: (command: string, args?: Record<string, string>) => Promise<T>}}}).__TAURI__.core.invoke(command, args);
}
export function ConnectorSetup({onSaved, enabled = true}: {onSaved?: () => void; enabled?: boolean}) {
  useInterfaceLanguage();
  const [client, setClient] = useState<Client>('chatgpt');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [exported, setExported] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleted, setDeleted] = useTransientState(false, false);
  const [revision, setRevision] = useState(0);
  const [chatgptEditing, setChatgptEditing] = useState(false);
  const chatgptSetupRef = useRef<ChatGPTSetupHandle>(null);
  const [configured,setConfigured]=useState<ClientStatus['configured'] | null>(null);
  const selectRef=useRef<HTMLSelectElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [tunnelReady,setTunnelReady]=useState(false);
  useEffect(()=>{let disposed=false;const check=()=>{void invoke<boolean>('connector_tunnel_ready').then(value=>{if(!disposed)setTunnelReady(value);}).catch(()=>{if(!disposed)setTunnelReady(false);});};if(client==='chatgpt')check();const timer=client==='chatgpt'?setInterval(check,5000):undefined;return()=>{disposed=true;clearInterval(timer);};},[client,revision]);
  useEffect(() => {
    let disposed = false;
    void invoke<ClientStatus>('connector_client_status').then(value => {if (!disposed) {setClient(value.client);setManualOpen(value.client === 'claude');setConfigured(value.configured);}})
      .catch(() => {if (!disposed) setError(true);}).finally(() => {if (!disposed) setBusy(false);});
    return () => {disposed = true;};
  }, []);
  async function refreshConfiguration() {
    try {const value=await invoke<ClientStatus>('connector_client_status');setConfigured(value.configured);}
    catch {setConfigured(null);}
  }
  async function select(value: Client) {
    setChatgptEditing(false);
    setManualOpen(value === 'claude');
    setBusy(true); setError(false); setActionError(''); setExported(''); setDeleted(false);
    try {await invoke('connector_client_select', {client: value}); setClient(value);await refreshConfiguration();}
    catch {setError(true);} finally {setBusy(false);}
  }
  async function addClient() {
    if (client === 'claude') setManualOpen(true);
    setBusy(true); setError(false); setActionError(''); setExported(''); setDeleted(false);
    try {const result = await invoke<string>('connector_client_add', {client, language: interfaceLanguage()}); setExported(result === 'cancelled' ? '' : result);if(result === 'claude_manual')setManualOpen(true);await refreshConfiguration();}
    catch (error) {setError(true);if(client === 'claude')setManualOpen(true);setActionError(String(error) === 'export_failed' ? 'export' : String(error) === 'claude_open_failed' ? 'open' : '');await refreshConfiguration();} finally {setBusy(false);}
  }
  async function claudeManual(action: 'export' | 'reveal') {
    setBusy(true); setError(false); setActionError(''); setExported('');
    try {
      if (action === 'export') {
        if (await invoke<boolean>('connector_client_export', {client:'claude'})) setExported('claude_exported');
      } else { await invoke('connector_client_reveal'); }
      await refreshConfiguration();
    } catch {setError(true);setActionError(action);} finally {setBusy(false);}
  }
  async function deleteClient(target: Client) {
    setBusy(true); setDeleteError(''); setDeleted(false);
    try {
      await invoke('connector_client_delete', {client: target});
      setConfigured(value=>value ? {...value,[target]:false} : null);
      setConfirmDelete(null); setDeleted(true); setExported(''); setError(false);
      if (target === 'chatgpt') { setTunnelReady(false); setRevision(value => value + 1); }
      // Do not reconnect the shared editor lease: other clients keep working.
    } catch (error) {
      setDeleteError(String(error) === 'connector_client_busy' ? 'connector.deleteBusy' : 'connector.deleteError');
    } finally { setBusy(false); }
  }
  const clientName = client === 'chatgpt' ? 'ChatGPT' : client === 'claude' ? 'Claude' : 'WorkBuddy';
  const configurationLabel=(target:Client)=>msg(!configured ? 'connector.configurationUnknown' : configured[target] === true ? 'connector.configurationPresent' : configured[target] === false ? 'connector.configurationAbsent' : 'connector.configurationUnknown');
  return <fieldset className="connector-settings-controls" disabled={!enabled}>
    <div className="connector-setup" aria-busy={busy} inert={!enabled}>
    <div className="connector-client-selection">
      <div className="cred-profile__fields"><label className="cred-field">
        <span className="cred-field__label">{msg('connector.software')}</span>
        <span className="cred-field__input"><select ref={selectRef} value={client} disabled={busy} onChange={event => void select(event.target.value as Client)}>
          <option value="chatgpt">{msg('connector.chatgptWeb')} · {configurationLabel('chatgpt')}</option><option value="claude">{msg('connector.claudeDesktop')} · {configurationLabel('claude')}</option><option value="workbuddy">WorkBuddy · {configurationLabel('workbuddy')}</option>
        </select></span><span className="cred-field__hint">{msg('connector.softwareHint')}</span>
      </label></div>
      {client !== 'chatgpt' && <>
        <ol className="settings-hint connector-steps"><li>{msg(`connector.${client}Step1`)}</li><li>{msg(`connector.${client}Step2`)}</li><li>{msg(client === 'workbuddy' ? 'connector.workbuddyStep3' : 'connector.localStep3')}</li></ol>
      </>}
      <div className="cred-profile__actions connector-config-actions">
        {client !== 'chatgpt' && <button type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={() => void addClient()}>{msg(`connector.${client}Add`)}</button>}
        {client === 'chatgpt' && configured?.chatgpt === true && <button type="button" className="cred-btn" disabled={busy || chatgptEditing} onClick={() => chatgptSetupRef.current?.edit()}>{msg('connector.editSetup')}</button>}
        {configured?.[client] === true && <button ref={deleteButtonRef} type="button" className="cred-btn cred-btn--danger" disabled={busy} onClick={() => {setConfirmDelete(client); setDeleteError('');}}>{msg('connector.deleteConfiguration',{client:clientName})}</button>}
      </div>
      {deleted && <FeedbackNotice text={msg('connector.configurationDeleted', {client:clientName})} onDismiss={() => setDeleted(false)}/>}
      {exported && <FeedbackNotice text={msg(`connector.added_${exported}`)} onDismiss={() => setExported('')}/>}
      {error && <p className="settings-hint connector-error" role="alert">{actionError === 'export' ? msg('connector.claudeExportError') : actionError === 'open' ? msg('connector.claudeOpenError') : actionError === 'reveal' ? msg('connector.claudeRevealError') : msg(`connector.addError_${client}`)}</p>}
      {client === 'claude' && <details className="connector-step-help" open={manualOpen} onToggle={event => setManualOpen(event.currentTarget.open)}>
        <summary>{msg('connector.claudeManualTitle')}</summary>
        <p className="settings-hint">{msg('connector.claudeLocalConfigurationHint')}</p>
        <p className="settings-hint">{msg('connector.claudeManualSteps')}</p>
        <div className="cred-profile__actions">
          <button type="button" className="cred-btn" disabled={busy} onClick={() => void claudeManual('export')}>{msg('connector.claudeExport')}</button>
          <button type="button" className="cred-btn" disabled={busy || configured?.claude !== true} onClick={() => void claudeManual('reveal')}>{msg('connector.claudeReveal')}</button>
        </div>
      </details>}
    </div>
    {client === 'chatgpt' && !busy && <ChatGPTSetup key={revision} ref={chatgptSetupRef} onEditingChange={setChatgptEditing} onSaved={() => {setTunnelReady(false);void refreshConfiguration(); onSaved?.();}} tunnelReady={tunnelReady}/>}
    {enabled && confirmDelete && <DeleteConnectorDialog clientName={clientName} busy={busy} error={deleteError} opener={deleteButtonRef} fallback={selectRef}
      onCancel={() => {setConfirmDelete(null); setDeleteError('');}}
      onDelete={() => void deleteClient(confirmDelete)} />}
  </div></fieldset>;
}

function DeleteConnectorDialog({clientName,busy,error,opener,fallback,onCancel,onDelete}: {
  clientName:string; busy:boolean; error:string; opener:{current:HTMLButtonElement|null}; fallback:{current:HTMLSelectElement|null}; onCancel:()=>void; onDelete:()=>void;
}) {
  const ref=useRef<HTMLDialogElement>(null), cancelRef=useRef<HTMLButtonElement>(null);
  const titleId=useId(), descriptionId=useId();
  useEffect(() => {
    const dialog=ref.current, previous=document.activeElement, trigger=opener.current, selection=fallback.current;
    dialog?.showModal(); cancelRef.current?.focus();
    return () => {if(dialog?.open)dialog.close();if(trigger?.isConnected)trigger.focus();else if(selection?.isConnected)selection.focus();else if(previous instanceof HTMLElement && previous.isConnected)previous.focus();};
  },[opener,fallback]);
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
