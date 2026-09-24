import { createPortal } from 'react-dom';
import './processingNotice.css';

/** Keep transient progress outside document flow so saving never moves the page. */
export function ProcessingNotice({ children }: { children: string }) {
  return createPortal(<p className="processing-notice" role="status">{children}</p>, document.body);
}
