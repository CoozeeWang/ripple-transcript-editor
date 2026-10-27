import { msg, useInterfaceLanguage } from '../i18n';

/** A recent-list failure does not mean the project itself failed to save. */
export function RecentProjectsNotice({ busy, onRetry, onDismiss }: {
  busy: boolean; onRetry: () => void; onDismiss: () => void;
}) {
  useInterfaceLanguage();
  return <div className="project-error-notice project-recents-warning" role="alert">
    <p>{msg('recentProjects.updateFailed')}</p>
    <button type="button" className="button button--secondary" disabled={busy} onClick={onRetry}>{msg('recentProjects.retry')}</button>
    <button type="button" className="notice-dismiss" aria-label={msg('notice.dismiss')} onClick={onDismiss}>×</button>
  </div>;
}
