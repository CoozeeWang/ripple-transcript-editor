import { useState } from 'react';
import { msg } from '../i18n';
import { nativeDesktopAvailable } from '../lib/desktopFs';

export function ConnectorSetup() {
  const [client, setClient] = useState('');
  const [tunnel, setTunnel] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [linkError, setLinkError] = useState(false);
  const invoke = async (command: string, args?: Record<string, string>) => {
    if (!nativeDesktopAvailable()) throw new Error('desktop_required');
    return (window as unknown as { __TAURI__: { core: { invoke: (name: string, args?: Record<string, string>) => Promise<string> } } }).__TAURI__.core.invoke(command, args);
  };
  return <details className="connector-setup">
    <summary>{msg('connector.setupTitle')}</summary>
    <div className="connector-setup-content">
    <div className="connector-setup-group">
    <p className="settings-hint">{msg('connector.setupHint')}</p>
    <a href="https://platform.openai.com/settings/organization/tunnels" target="_blank" rel="noreferrer" onClick={event => {
      if (!nativeDesktopAvailable()) return;
      event.preventDefault(); setLinkError(false);
      void invoke('connector_open_platform').catch(() => setLinkError(true));
    }}>{msg('connector.platform')}</a>
    {linkError && <p className="settings-hint connector-error" role="alert">{msg('connector.platformError')}</p>}
    </div>
    <div className="connector-setup-group">
    <button type="button" className="button" disabled={status === 'saving'} onClick={() => {
      void invoke('connector_pick_client').then(setClient).catch(() => setStatus('error'));
    }}>{msg('connector.selectClient')}</button>
    <p className="settings-hint">{msg('connector.clientHint')}</p>
    {client && <p className="settings-hint">{msg('connector.clientSelected')}</p>}
    </div>
    <label className="field"><span>{msg('connector.tunnelId')}</span>
      <input value={tunnel} onChange={event => setTunnel(event.target.value)} autoComplete="off" />
      <span className="settings-hint">{msg('connector.tunnelHint')}</span></label>
    <label className="field"><span>{msg('connector.runtimeKey')}</span>
      <input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" />
      <span className="settings-hint">{msg('connector.keyHint')}</span></label>
    <div className="connector-setup-group">
    <button type="button" className="button" disabled={!client || !tunnel || status === 'saving'} onClick={() => {
      setStatus('saving');
      void invoke('connector_setup', { clientPath: client, tunnelId: tunnel.trim(), runtimeKey: key })
        .then(() => { setKey(''); setStatus('saved'); }).catch(() => { setKey(''); setStatus('error'); });
    }}>{msg('connector.saveSetup')}</button>
    {status !== 'idle' && <p className="settings-hint" role="status">{msg(`connector.setup_${status}`)}</p>}
    </div>
    </div>
  </details>;
}
