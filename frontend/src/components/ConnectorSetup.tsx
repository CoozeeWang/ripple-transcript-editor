import { useEffect, useState } from 'react';
import { interfaceLanguage, msg } from '../i18n';
import { nativeDesktopAvailable } from '../lib/desktopFs';
import { ChatGPTSetup } from './ChatGPTSetup';

type Client = 'chatgpt' | 'claude' | 'workbuddy';
async function invoke<T>(command: string, args?: Record<string, string>): Promise<T> {
  if (!nativeDesktopAvailable()) throw new Error('desktop_required');
  return (window as unknown as {__TAURI__: {core: {invoke: (command: string, args?: Record<string, string>) => Promise<T>}}}).__TAURI__.core.invoke(command, args);
}
export function ConnectorSetup({onSaved}: {onSaved?: () => void}) {
  const [client, setClient] = useState<Client>('chatgpt');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [exported, setExported] = useState('');
  useEffect(() => {
    let disposed = false;
    void invoke<{client: Client}>('connector_client_status').then(value => {if (!disposed) setClient(value.client);})
      .catch(() => {if (!disposed) setError(true);}).finally(() => {if (!disposed) setBusy(false);});
    return () => {disposed = true;};
  }, []);
  async function select(value: Client) {
    setBusy(true); setError(false); setExported('');
    try {await invoke('connector_client_select', {client: value}); setClient(value); onSaved?.();}
    catch {setError(true);} finally {setBusy(false);}
  }
  async function addClient() {
    setBusy(true); setError(false); setExported('');
    try {const result = await invoke<string>('connector_client_add', {client, language: interfaceLanguage()}); setExported(result === 'cancelled' ? '' : result);}
    catch {setError(true);} finally {setBusy(false);}
  }
  return <div className="connector-setup" aria-busy={busy}>
    <div className="connector-client-selection">
      <div className="cred-profile__fields"><label className="cred-field">
        <span className="cred-field__label">{msg('connector.software')}</span>
        <span className="cred-field__input"><select value={client} disabled={busy} onChange={event => void select(event.target.value as Client)}>
          <option value="chatgpt">{msg('connector.chatgptWeb')}</option><option value="claude">{msg('connector.claudeDesktop')}</option><option value="workbuddy">WorkBuddy</option>
        </select></span><span className="cred-field__hint">{msg('connector.softwareHint')}</span>
      </label></div>
      {client === 'chatgpt' ? <p className="settings-hint">{msg('connector.chatgptSteps')}</p> : <>
        <ol className="settings-hint connector-steps"><li>{msg(`connector.${client}Step1`)}</li><li>{msg(`connector.${client}Step2`)}</li><li>{msg('connector.localStep3')}</li></ol>
      </>}
      <div className="cred-profile__actions"><button type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={() => void addClient()}>{msg(`connector.${client}Add`)}</button></div>
      {exported && <p className="settings-hint" role="status">{msg(`connector.added_${exported}`)}</p>}
      {error && <p className="settings-hint connector-error" role="alert">{msg(`connector.addError_${client}`)}</p>}
    </div>
    {client === 'chatgpt' && !busy && <ChatGPTSetup onSaved={onSaved}/>}
  </div>;
}
