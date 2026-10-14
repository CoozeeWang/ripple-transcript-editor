import { useEffect, useState } from 'react';
import { Trans } from 'react-i18next';
import { interfaceLanguage, msg, useInterfaceLanguage } from '../i18n';
import { nativeDesktopAvailable } from '../lib/desktopFs';
import { latestTunnelRelease, officialSetupUrl, releaseDownload, TUNNEL_RELEASE_PAGE } from '../lib/tunnelClientRelease';
import type { ClientDownload, ClientPlatform } from '../lib/tunnelClientRelease';

interface SavedSetup { client_path: string; tunnel_id: string; has_key: boolean; configured: boolean }
const empty: SavedSetup = { client_path: '', tunnel_id: '', has_key: false, configured: false };
async function invoke<T>(command: string, args?: Record<string, string>): Promise<T> {
  if (!nativeDesktopAvailable()) throw new Error('desktop_required');
  return (window as unknown as { __TAURI__: { core: { invoke: (name: string, args?: Record<string, string>) => Promise<T> } } }).__TAURI__.core.invoke(command, args);
}
export function ChatGPTSetup({ onSaved, tunnelReady = false }: { onSaved?: () => void; tunnelReady?: boolean }) {
  useInterfaceLanguage();
  const [saved, setSaved] = useState(empty);
  const [client, setClient] = useState('');
  const [tunnel, setTunnel] = useState('');
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [linkError, setLinkError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [platform, setPlatform] = useState<ClientPlatform | null>(null);
  const [download, setDownload] = useState<ClientDownload | null>(null);
  const [releaseStatus, setReleaseStatus] = useState<'checking' | 'ready' | 'missing' | 'failed'>('checking');
  const [refresh, setRefresh] = useState(0);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [addError, setAddError] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptCopyError, setPromptCopyError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void invoke<SavedSetup>('connector_setup_status').then(value => {
      if (disposed) return;
      setSaved(value); setClient(value.client_path); setTunnel(value.tunnel_id); setEditing(!value.configured);
    }).catch(() => { if (!disposed) { setStatus('error'); setEditing(true); } })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    let disposed = false;
    const hostInfo = invoke<ClientPlatform>('connector_client_platform').then(host => { if (!disposed) setPlatform(host); return host; });
    void Promise.all([hostInfo, latestTunnelRelease()]).then(([host, release]) => {
      if (disposed) return;
      const match = releaseDownload(release, host);
      setDownload(match); setReleaseStatus(match ? 'ready' : 'missing');
    }).catch(() => { if (!disposed) { setDownload(null); setReleaseStatus('failed'); } });
    return () => { disposed = true; };
  }, [refresh]);
  function link(url: string, text?: string) {
    return <a href={url} target="_blank" rel="noreferrer" onClick={event => {
      if (!nativeDesktopAvailable()) return;
      event.preventDefault(); setLinkError('');
      if (!officialSetupUrl(url)) { setLinkError(TUNNEL_RELEASE_PAGE); return; }
      void invoke('connector_open_setup_link', {url}).catch(() => setLinkError(url));
    }}>{text}</a>;
  }
  const isMac = platform?.os === 'macos';
  const chip = platform?.arch === 'aarch64' || platform?.arch === 'arm64' ? 'arm64' : platform?.arch === 'x86_64' || platform?.arch === 'amd64' ? 'amd64' : 'unknown';
  const deviceKey = platform && ['macos', 'windows', 'linux'].includes(platform.os) && chip !== 'unknown' ? `connector.device_${platform.os}_${chip}` : 'connector.device_unknown';
  return <div className="connector-setup">
    <div className="cred-profile connector-setup-card connector-guided-card" aria-busy={loading}>
      <div className="cred-profile__head"><span className="cred-profile__name">{msg('connector.guidedTitle')}</span></div>
      <p className="settings-hint" role="status">{loading ? msg('connector.loadingSetup') : saved.configured ? msg('connector.configured') : ''}</p>
      <ol className="connector-guided-steps">
        <li>
          <label className="connector-step-label" htmlFor="chatgpt-tunnel">{msg('connector.tunnelId')}</label>
          <p className="settings-hint"><Trans i18nKey="connector.guidedTunnel" components={{setupLink: link('https://platform.openai.com/settings/organization/tunnels')}} /></p>
          <div className="cred-field__input"><input id="chatgpt-tunnel" value={tunnel} readOnly={!editing} disabled={loading || status === 'saving'} onChange={event => setTunnel(event.target.value)} autoComplete="off" placeholder={msg('connector.tunnelPlaceholder')} /></div>
        </li>
        <li>
          <label className="connector-step-label" htmlFor="chatgpt-client">{msg('connector.clientLabel')}</label>
          <div className="cred-field__input"><input id="chatgpt-client" readOnly value={client.split(/[\\/]/).at(-1) ?? ''} placeholder={msg('connector.clientPlaceholder')}/>
            {editing && <button type="button" className="cred-btn" disabled={loading || status === 'saving'} onClick={() => {
              void invoke<string>('connector_pick_client').then(setClient).catch(error => { if (error !== 'client_selection_cancelled') setStatus('error'); });
            }}>{msg('connector.chooseClient')}</button>}</div>
          <div className="connector-device-row">
            <span className="settings-hint connector-device">{msg('connector.deviceRecommendation', {device:msg(deviceKey)})}</span>
            <button type="button" className="connector-refresh" disabled={releaseStatus === 'checking'} onClick={() => {setReleaseStatus('checking'); setDownload(null); setRefresh(value=>value+1);}}>{msg('connector.refreshDownload')}</button>
          </div>
          <div className="connector-download" aria-live="polite">
            {releaseStatus === 'ready' && download ? <p className="settings-hint">{link(download.url, msg('connector.downloadFile', {file:download.name}))}</p> : <p className="settings-hint">{msg(`connector.release_${releaseStatus}`)}</p>}
            <p className="settings-hint">{msg(isMac || platform?.os === 'linux' ? 'connector.guidedClient' : platform?.os === 'windows' ? 'connector.guidedClientWindows' : 'connector.guidedClientUnknown')}</p>
            {(releaseStatus === 'failed' || releaseStatus === 'missing') && <p className="settings-hint">{link(TUNNEL_RELEASE_PAGE, msg('connector.latestDownloads'))}</p>}
          </div>
          {(isMac || !platform) && <details className="connector-step-help" open><summary>{msg('connector.macAuthorizationTitle')}</summary><p className="settings-hint">{msg('connector.macAuthorization')}</p></details>}
        </li>
        <li>
          <label className="connector-step-label" htmlFor="chatgpt-key">{msg('connector.runtimeKey')}</label>
          <div className="cred-field__input"><input id="chatgpt-key" type="password" value={key} readOnly={!editing} disabled={loading || status === 'saving'} placeholder={saved.has_key ? msg('connector.keySaved') : msg('connector.keyPlaceholder')} onChange={event => setKey(event.target.value)} autoComplete="off" /></div>
          <p className="settings-hint"><Trans i18nKey="connector.guidedKey" components={{setupLink:link('https://platform.openai.com/settings/organization/api-keys')}} /></p>
          {saved.has_key && editing && <p className="settings-hint">{msg('connector.keepSavedKey')}</p>}
          {!loading && <div className="cred-profile__actions">
            {editing ? <>
              <button type="button" className="cred-btn cred-btn--primary" disabled={!client || !tunnel.trim() || (!saved.has_key && !key.trim()) || status === 'saving'} onClick={() => {
                setStatus('saving'); setCopied(false);
                void invoke('connector_setup', { clientPath: client, tunnelId: tunnel.trim(), runtimeKey: key })
                  .then(() => { setSaved({ client_path: client, tunnel_id: tunnel.trim(), has_key: true, configured: true }); setKey(''); setEditing(false); setStatus('saved'); onSaved?.(); })
                  .catch(() => { setKey(''); setStatus('error'); });
              }}>{msg('connector.saveSetup')}</button>
              {saved.configured && <button type="button" className="cred-btn" disabled={status === 'saving'} onClick={() => {
                setClient(saved.client_path); setTunnel(saved.tunnel_id); setKey(''); setEditing(false); setStatus('idle'); setLinkError(''); setCopied(false);
              }}>{msg('connector.cancelSetup')}</button>}
              <span className="settings-hint">{msg('connector.savePrerequisite')}</span>
            </> : <button type="button" className="cred-btn" onClick={() => { setEditing(true); setStatus('idle'); }}>{msg('connector.editSetup')}</button>}
          </div>}
          {status !== 'idle' && <p className={`settings-hint${status === 'error' ? ' connector-error' : ''}`} role="status">{msg(`connector.setup_${status}`)}</p>}
        </li>
        <li>
          <span className="connector-step-label">{msg('connector.guidedChatGPTTitle')}</span>
          <p className="settings-hint">{msg('connector.guidedChatGPT')}</p>
          <div className="cred-profile__actions"><button type="button" className="cred-btn cred-btn--primary" disabled={adding || editing || !saved.configured || !tunnelReady} onClick={() => {
            setAdding(true); setAdded(false); setAddError(false);
            void invoke<string>('connector_client_add', {client:'chatgpt', language:interfaceLanguage()})
              .then(result=>setAdded(result === 'chatgpt')).catch(()=>setAddError(true)).finally(()=>setAdding(false));
          }}>{msg('connector.chatgptAdd')}</button><button type="button" className="cred-btn" disabled={!saved.tunnel_id || editing} onClick={async () => {
            setCopyError(false); setCopied(false);
            try { await navigator.clipboard.writeText(saved.tunnel_id); setCopied(true); }
            catch { setCopyError(true); }
          }}>{msg('connector.copyTunnel')}</button></div>
          {added && <p className="settings-hint" role="status">{msg('connector.added_chatgpt')}</p>}
          {addError && <p className="settings-hint connector-error" role="alert">{msg('connector.addError_chatgpt')}</p>}
          {copied && <p className="settings-hint" role="status">{msg('connector.tunnelCopied')}</p>}
          {copyError && <p className="settings-hint connector-error" role="alert">{msg('connector.copyFailed')}</p>}
          <details className="connector-step-help"><summary>{msg('connector.existingConnectionTitle')}</summary><p className="settings-hint">{msg('connector.existingConnection')}</p></details>
        </li>
      </ol>
      {linkError && <p className="settings-hint connector-error" role="alert">{msg('connector.openLinkError',{url:linkError})}</p>}
    </div>
    <details className="connector-step-help"><summary>{msg('connector.aiSetupTitle')}</summary><p className="settings-hint">{msg('connector.aiSetupHint')}</p><p className="settings-hint connector-guidance connector-setup-prompt">{msg('connector.aiSetupPrompt')}</p><div className="cred-profile__actions"><button type="button" className="cred-btn" onClick={async()=>{
      setPromptCopied(false); setPromptCopyError(false);
      try {await navigator.clipboard.writeText(msg('connector.aiSetupPrompt')); setPromptCopied(true);} catch {setPromptCopyError(true);}
    }}>{msg('connector.copySetupPrompt')}</button></div>{promptCopied && <p className="settings-hint" role="status">{msg('connector.setupPromptCopied')}</p>}{promptCopyError && <p className="settings-hint connector-error" role="alert">{msg('connector.setupPromptCopyFailed')}</p>}</details>
  </div>;
}
