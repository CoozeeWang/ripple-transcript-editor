import { useEffect, useState } from 'react';
import { msg } from '../i18n';
import { nativeDesktopAvailable } from '../lib/desktopFs';

interface SavedSetup { client_path: string; tunnel_id: string; has_key: boolean; configured: boolean }
const empty: SavedSetup = { client_path: '', tunnel_id: '', has_key: false, configured: false };
async function invoke<T>(command: string, args?: Record<string, string>): Promise<T> {
  if (!nativeDesktopAvailable()) throw new Error('desktop_required');
  return (window as unknown as { __TAURI__: { core: { invoke: (name: string, args?: Record<string, string>) => Promise<T> } } }).__TAURI__.core.invoke(command, args);
}
export function ChatGPTSetup({ onSaved }: { onSaved?: () => void }) {
  const [saved, setSaved] = useState(empty);
  const [client, setClient] = useState('');
  const [tunnel, setTunnel] = useState('');
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [linkError, setLinkError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void invoke<SavedSetup>('connector_setup_status').then(value => {
      if (disposed) return;
      setSaved(value); setClient(value.client_path); setTunnel(value.tunnel_id); setEditing(!value.configured);
    }).catch(() => { if (!disposed) { setStatus('error'); setEditing(true); } })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);
  return <details className="connector-setup">
    <summary>{msg('connector.setupTitle')}</summary>
    <div className="cred-profile connector-setup-card" aria-busy={loading}>
      <div className="cred-profile__head"><span className="cred-profile__name">{msg('connector.connectionProfile')}</span></div>
      <p className="settings-hint">{msg('connector.setupHint')}</p>
      <p className="settings-hint connector-platform"><a href="https://platform.openai.com/settings/organization/tunnels" target="_blank" rel="noreferrer" onClick={event => {
        if (!nativeDesktopAvailable()) return;
        event.preventDefault(); setLinkError(false);
        void invoke('connector_open_platform').catch(() => setLinkError(true));
      }}>{msg('connector.platform')}</a></p>
      {linkError && <p className="settings-hint connector-error" role="alert">{msg('connector.platformError')}</p>}
      <p className="settings-hint" role="status">{loading ? msg('connector.loadingSetup') : saved.configured ? msg('connector.configured') : ''}</p>
      {!loading && <>
      <div className="cred-profile__fields">
        <label className="cred-field"><span className="cred-field__label">{msg('connector.clientLabel')}</span>
          <span className="cred-field__input"><input readOnly value={client.split(/[\\/]/).at(-1) ?? ''} />
            {editing && <button type="button" className="cred-btn" disabled={status === 'saving'} onClick={() => {
              void invoke<string>('connector_pick_client').then(setClient).catch(() => setStatus('error'));
            }}>{msg('connector.chooseClient')}</button>}</span>
          {<span className="cred-field__hint">{msg('connector.clientHint')}</span>}
        </label>
        <label className="cred-field"><span className="cred-field__label">{msg('connector.tunnelId')}</span>
          <span className="cred-field__input"><input value={tunnel} readOnly={!editing} disabled={status === 'saving'} onChange={event => setTunnel(event.target.value)} autoComplete="off" /></span>
          {<span className="cred-field__hint">{msg('connector.tunnelHint')}</span>}
        </label>
        <label className="cred-field"><span className="cred-field__label">{msg('connector.runtimeKey')}</span>
          <span className="cred-field__input"><input type="password" value={key} readOnly={!editing} disabled={status === 'saving'} placeholder={saved.has_key ? msg('connector.keySaved') : ''} onChange={event => setKey(event.target.value)} autoComplete="off" /></span>
          {<span className="cred-field__hint">{msg('connector.keyHint')}</span>}
        </label>
      </div>
      <div className="cred-profile__actions">
        {editing ? <>
          <button type="button" className="cred-btn cred-btn--primary" disabled={!client || !tunnel.trim() || (!saved.has_key && !key.trim()) || status === 'saving'} onClick={() => {
            setStatus('saving');
            void invoke('connector_setup', { clientPath: client, tunnelId: tunnel.trim(), runtimeKey: key })
              .then(() => { setSaved({ client_path: client, tunnel_id: tunnel.trim(), has_key: true, configured: true }); setKey(''); setEditing(false); setStatus('saved'); onSaved?.(); })
              .catch(() => { setKey(''); setStatus('error'); });
          }}>{msg('connector.saveSetup')}</button>
          {saved.configured && <button type="button" className="cred-btn" disabled={status === 'saving'} onClick={() => {
            setClient(saved.client_path); setTunnel(saved.tunnel_id); setKey(''); setEditing(false); setStatus('idle'); setLinkError(false);
          }}>{msg('connector.cancelSetup')}</button>}
        </> : <button type="button" className="cred-btn" onClick={() => { setEditing(true); setStatus('idle'); }}>{msg('connector.editSetup')}</button>}
      </div>
      {status !== 'idle' && <p className={`settings-hint${status === 'error' ? ' connector-error' : ''}`} role="status">{msg(`connector.setup_${status}`)}</p>}
      </>}
    </div>
  </details>;
}
