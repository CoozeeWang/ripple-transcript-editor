import { createPortal } from 'react-dom';
import { msg, useInterfaceLanguage } from '../i18n';
import './processingNotice.css';

/** Keep transient progress outside document flow so saving never moves the page. */
export function ProcessingNotice({ children, onDismiss }: { children: string; onDismiss?: () => void }) {
  useInterfaceLanguage();
  return createPortal(<p className={`processing-notice${onDismiss ? ' notice-row processing-notice--dismissible' : ''}`} role="status">
    <span className="notice-row__message">{children}</span>{onDismiss && <button type="button" className="notice-dismiss" aria-label={msg('notice.dismiss')} onClick={onDismiss}>×</button>}
  </p>, document.body);
}
