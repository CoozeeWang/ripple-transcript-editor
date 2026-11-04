import { msg, useInterfaceLanguage } from '../i18n';

export type RecentRecoveryReason = 'missing' | 'permission' | 'unreadable';
export function RecentProjectRecovery({title,reason,busy,onRecover,onDismiss}: {
  title:string;reason:RecentRecoveryReason;busy:boolean;onRecover:()=>void;onDismiss:()=>void;
}) {
  useInterfaceLanguage();
  return <div className="recent-project-recovery" role="status">
    <p>{msg(reason==='missing'?'ProjectWorkspace.recentMissing':reason==='permission'?'ProjectWorkspace.recentPermission':'ProjectWorkspace.recentUnreadable',{title})}</p>
    <div className="recent-project-recovery__actions">
      <button type="button" className="button button--secondary" disabled={busy} onClick={onRecover}>{msg('ProjectWorkspace.recentRecover')}</button>
      <button type="button" className="button button--secondary" disabled={busy} onClick={onDismiss}>{msg('ProjectWorkspace.recentDismiss')}</button>
    </div>
  </div>;
}
