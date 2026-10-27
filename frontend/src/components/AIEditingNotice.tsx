import { useState, type ReactNode } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { blocksHumanEditing, ownsEditing, visibleAIActivities, type AIEditActivity } from '../lib/aiEditOwnership';
import { useExpiredFeedback } from '../hooks/useExpiredFeedback';

const receipt = (task: AIEditActivity) => JSON.stringify([task.task_id, task.touched, task.saved, task.total]);

export function AIEditingNotice({ activities, onEnd, onDismiss, children, isCurrent = () => true }: {
  activities: AIEditActivity[]; onEnd: (id: string) => Promise<unknown>; onDismiss?: (id: string) => Promise<unknown>; children?: ReactNode;
  isCurrent?: (task: AIEditActivity) => boolean;
}) {
  useInterfaceLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const candidates = visibleAIActivities(activities);
  const expired = useExpiredFeedback(candidates.filter(task => task.state === 'completed' && !blocksHumanEditing(task)).map(receipt));
  const visible = candidates.filter(task => task.state !== 'completed' || blocksHumanEditing(task) || !expired.has(receipt(task)));
  const run = async (task: AIEditActivity) => {
    setBusy(task.task_id);
    try { await (blocksHumanEditing(task) ? onEnd(task.task_id) : onDismiss?.(task.task_id)); }
    catch { /* The window runtime retains the actionable failure. */ }
    finally { setBusy(null); }
  };
  // Recovery errors must remain visible even when no task could be recovered.
  if (!visible.length) return children ? <>{children}</> : null;
  return <section className="ai-editing-region" aria-label={msg('aiEditing.title')}>
    {visible.map(task => {
      const active = ownsEditing(task);
      const ending = task.state === 'ended' && task.inFlight > 0;
      const protectedTask = blocksHumanEditing(task);
      const complete = task.state === 'completed';
      const client = ({ chatgpt: 'ChatGPT', claude: 'Claude', workbuddy: 'WorkBuddy' })[task.client] ?? 'AI';
      return <div className={`ai-editing-notice${complete ? ' is-completed' : ''}`} key={task.task_id}>
        {!complete && <svg className="ai-editing-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>}
        <div className="ai-editing-copy" role="status" aria-live="polite">
          <span>{complete ? msg('aiEditing.completed', { saved: task.saved, total: task.total, count: task.total }) : ending ? msg('aiEditing.ending') : task.state === 'failed' ? msg('aiEditing.failed') : task.state === 'paused' ? msg('aiEditing.paused') : active ? msg(isCurrent(task) ? 'aiEditing.locked' : 'aiEditing.background', { client, recording: task.target?.recording ?? task.version }) : msg('aiEditing.ended')}</span>
          <span className="ai-editing-detail">{task.target ? `${task.target.recording} · ${task.version}` : task.version}
            {!complete && <> · {msg(`aiEditing.${!task.total ? 'preparing' : active ? task.state : 'counts'}`, { processed: task.processed, saved: task.saved, total: task.total, count: task.total })}</>}</span>
          {protectedTask && !ending && <span className="ai-editing-detail">{msg('aiEditing.endHelp')}</span>}
        </div>
        <button type="button" className={protectedTask ? 'ai-editing-end' : 'ai-editing-close'} disabled={busy === task.task_id || ending} onClick={() => void run(task)} aria-label={protectedTask ? undefined : msg('aiEditing.dismiss')}>
          {protectedTask ? msg(ending ? 'aiEditing.endingAction' : 'aiEditing.end') : '×'}
        </button>
      </div>;
    })}
    {children}
  </section>;
}
