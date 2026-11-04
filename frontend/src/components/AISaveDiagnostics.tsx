import { useState } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { useTransientState } from '../hooks/useTransientState';
import { safeSaveDiagnostics, type SaveDiagnostics } from '../lib/saveDiagnostics';

/** Status-only inspection: never retries a write or copies the full task response. */
export function AISaveDiagnostics({ onInspect }: { onInspect: () => Promise<unknown> }) {
  useInterfaceLanguage();
  const [busy,setBusy]=useState(false),[result,setResult]=useState<SaveDiagnostics|null>(null),[error,setError]=useState(false);
  const [copied,setCopied]=useTransientState(false,false);
  return <details className="ai-save-diagnostics"><summary>{msg('aiEditing.inspectSave')}</summary>
    <p>{msg('aiEditing.inspectBoundary')}</p>
    <button type="button" className="cred-btn" disabled={busy} onClick={async()=>{
      setBusy(true);setError(false);setResult(null);setCopied(false);
      try {setResult(safeSaveDiagnostics(await onInspect()));} catch {setError(true);} finally {setBusy(false);}
    }}>{msg(busy?'aiEditing.inspectBusy':'aiEditing.inspectSave')}</button>
    {result&&<><p role="status">{msg(`aiEditing.receipt_${result.receipt_status}`)} · {result.checked_at}</p>
      <p>{msg(result.window_save_attempt?'aiEditing.arrivalObserved':'aiEditing.arrivalUnknown')}</p>
      <button type="button" className="cred-btn" onClick={async()=>{try{await navigator.clipboard.writeText(JSON.stringify(result,null,2));setCopied(true);setError(false);}catch{setError(true);}}}>{msg(copied?'CopyProblem.m0381':'aiEditing.copySaveDiagnostics')}</button></>}
    {error&&<p role="alert" className="form-error">{msg('aiEditing.inspectFailed')}</p>}
  </details>;
}
