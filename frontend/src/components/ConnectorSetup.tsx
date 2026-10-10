import { useEffect, useState } from 'react';
import { msg } from '../i18n';
import { nativeDesktopAvailable } from '../lib/desktopFs';

interface PairState { paired: boolean; available: boolean; pair_code?: string; expires_at?: number; revoked?: boolean }
async function invoke<T>(command: string): Promise<T> {
  if (!nativeDesktopAvailable()) throw new Error('desktop_required');
  return (window as unknown as { __TAURI__: { core: { invoke: (name: string) => Promise<T> } } }).__TAURI__.core.invoke(command);
}
export function ConnectorSetup({ onSaved, onRevoked }: { onSaved?: () => void; onRevoked?: () => void }) {
  const [saved, setSaved] = useState<PairState>({paired:false,available:false});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let disposed = false;
    void invoke<PairState>('connector_pair_status').then(value => { if (!disposed) setSaved(value); })
      .catch(() => { if (!disposed) setError(true); }).finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!saved.pair_code || saved.paired) return;
    let disposed = false;
    const timer = setInterval(() => {
      if (Date.now()/1000 >= (saved.expires_at ?? 0)) { setExpired(true); return; }
      void invoke<PairState>('connector_pair_status').then(value => {
        if (!disposed && value.paired) { setSaved(value); onSaved?.(); }
      }).catch(() => { if (!disposed) setError(true); });
    }, 2500);
    return () => { disposed = true; clearInterval(timer); };
  }, [saved.pair_code, saved.paired, saved.expires_at, onSaved]);
  async function act(command: string) {
    setBusy(true); setError(false); setExpired(false);
    try {
      const value = await invoke<PairState>(command);
      setSaved(value);
      if (command === 'connector_pair_revoke') onRevoked?.();
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <div className="cred-profile connector-setup-card" aria-busy={busy}>
    <div className="cred-profile__head"><span className="cred-profile__name">{msg('connector.pairTitle')}</span></div>
    <p className="settings-hint" role="status">{msg(busy ? 'connector.loadingSetup' : saved.paired ? 'connector.paired' : !saved.available && !error ? 'connector.servicePending' : 'connector.pairHint')}</p>
    {saved.pair_code && !saved.paired && <div className="cred-profile__fields">
      <div className="cred-field"><span className="cred-field__label">{msg('connector.pairCode')}</span>
        <span className="cred-field__input"><output className="connector-pair-code">{saved.pair_code.match(/.{1,4}/g)?.join('-')}</output></span>
        <span className="cred-field__hint">{msg(expired ? 'connector.pairExpired' : 'connector.pairCodeHint')}</span>
      </div>
    </div>}
    <div className="cred-profile__actions">
      {saved.available && !saved.paired && <button type="button" className="cred-btn cred-btn--primary" disabled={busy} onClick={() => void act('connector_pair_begin')}>{msg(saved.pair_code ? 'connector.pairAgain' : 'connector.pairStart')}</button>}
      {(saved.paired || saved.pair_code || saved.revoked) && <button type="button" className="cred-btn" disabled={busy} onClick={() => void act('connector_pair_revoke')}>{msg('connector.pairRevoke')}</button>}
      {error && <button type="button" className="cred-btn" disabled={busy} onClick={() => void act('connector_pair_status')}>{msg('connector.pairRetry')}</button>}
    </div>
    {error && <p className="settings-hint connector-error" role="alert">{msg('connector.pairError')}</p>}
  </div>;
}
