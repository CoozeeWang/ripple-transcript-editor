import { useState, type ReactNode } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { blocksHumanEditing, ownsEditing, type AIEditActivity } from '../lib/aiEditOwnership';

export function AIEditingNotice({ activities, onEnd, children, isCurrent = () => true }: {
  activities: AIEditActivity[]; onEnd: (id: string) => Promise<unknown>; children?: ReactNode;
  isCurrent?: (task: AIEditActivity) => boolean;
}) {
  useInterfaceLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const visible = activities.filter(task => blocksHumanEditing(task) || task.state === 'paused' || task.state === 'failed' || task.state === 'ended' && task.reason !== 'user_ended' && task.reason !== 'clarification_required' && task.reason !== 'prepare_failed');
  const end = async (id: string) => { setBusy(id); try { await onEnd(id); } finally { setBusy(null); } };
  if (!visible.length && !children) return null;
  return <section className="ai-editing-region" aria-label={msg('aiEditing.title')}>
    {visible.map(task => {
      const active = ownsEditing(task);
      const ending = !active && task.inFlight > 0;
      const client = ({ chatgpt: 'ChatGPT', claude: 'Claude', workbuddy: 'WorkBuddy' })[task.client] ?? 'AI';
      return <div className="ai-editing-notice" key={task.task_id}>
        <svg className="ai-editing-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>
        <div className="ai-editing-copy" role="status" aria-live="polite">
          <span>{ending ? msg('aiEditing.ending') : active ? msg(isCurrent(task) ? 'aiEditing.locked' : 'aiEditing.background', { client, recording: task.target?.recording ?? task.version }) : task.state === 'paused' ? msg('aiEditing.paused') : task.state === 'failed' ? msg('aiEditing.failed') : msg('aiEditing.ended')}</span>
          <span className="ai-editing-detail">{task.target ? `${task.target.recording} · ${task.version}` : task.version}
            {' · '}{msg(`aiEditing.${!task.total ? 'preparing' : active ? task.state : 'counts'}`, { processed: task.processed, saved: task.saved, total: task.total })}</span>
        </div>
        <button type="button" className="ai-editing-end" disabled={busy === task.task_id || ending} onClick={() => void end(task.task_id)}>{msg(ending ? 'aiEditing.endingAction' : active || task.state === 'paused' ? 'aiEditing.end' : 'aiEditing.dismiss')}</button>
      </div>;
    })}
    {children}
  </section>;
}
