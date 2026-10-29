import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import type { Problem } from '../lib/diagnostics';
import { CopyProblem } from './CopyProblem';

export function LoadErrorNotice({ text, onDismiss, problem }: { text: string; onDismiss: () => void; problem?: Problem }) {
  useInterfaceLanguage();
  return <div className="notice notice-row" role="alert">
    <span className="notice-row__message">{uiMessage(text)}</span>
    <div className="notice-row__actions"><CopyProblem problem={problem}/><button type="button" className="notice-dismiss" aria-label={msg('notice.dismiss')} onClick={onDismiss}>×</button></div>
  </div>;
}

export function SaveToastNotice({ toast, onDismiss }: { toast: { kind: 'error' | 'ok'; text: string }; onDismiss: () => void }) {
  useInterfaceLanguage();
  return <div className={`save-toast save-toast--${toast.kind} notice-row`} role={toast.kind === 'error' ? 'alert' : 'status'}>
    <span className="save-toast__dot" aria-hidden="true" />
    <span className="notice-row__message">{uiMessage(toast.text)}</span>
    <div className="notice-row__actions">{toast.kind === 'error' && <CopyProblem operation="save"/>}<button type="button" className="notice-dismiss" aria-label={msg('notice.dismiss')} onClick={onDismiss}>×</button></div>
  </div>;
}
