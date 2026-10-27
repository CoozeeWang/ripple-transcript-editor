import { msg, uiMessage, useInterfaceLanguage } from '../i18n';

/** Dismiss only this feedback; the operation's saved result is owned elsewhere. */
export function FeedbackNotice({ text, onDismiss, error = false }: { text: string; onDismiss: () => void; error?: boolean }) {
  useInterfaceLanguage();
  return <p className={`settings-hint feedback-notice notice-row${error ? ' feedback-notice--error' : ''}`} role={error ? 'alert' : 'status'}>
    <span className="notice-row__message">{uiMessage(text)}</span><button type="button" className="feedback-dismiss" aria-label={msg('notice.dismiss')} onClick={onDismiss}>×</button>
  </p>;
}
