// Synthetic notice review only. No project, credentials, clipboard or provider access.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MaterialImportNotice, type MaterialImportNote } from '../src/components/MaterialImportNotice';
import { LoadErrorNotice, SaveToastNotice } from '../src/components/EditorFeedback';
import { FeedbackNotice } from '../src/components/FeedbackNotice';
import { ProcessingNotice } from '../src/components/ProcessingNotice';
import { ContinuationProgress } from '../src/components/ContinuationProgress';
import { AIEditingNotice } from '../src/components/AIEditingNotice';
import { useTransientState, SUCCESS_FEEDBACK_MS } from '../src/hooks/useTransientState';
import { msg, setInterfaceLanguage, type InterfaceLanguage } from '../src/i18n';
import '../src/styles.css';
import '../src/components/projectSetup.css';

const query = new URLSearchParams(location.search);
const scope = query.get('scope') || 'project';
const language = (query.get('lang') || 'zh-CN') as InterfaceLanguage;
const empty: MaterialImportNote[] = [];
const notes = [{ name: `Synthetic_${'long-recording-name_'.repeat(7)}.docx`, keys: ['materialImport.m1378', 'materialImport.m1379'] },
  { name: 'Synthetic second manuscript.txt', keys: ['materialImport.m1379'] }];
const completed = { task_id: 'synthetic', client: 'chatgpt' as const, key: 'synthetic', version: 'Synthetic v1', version_id: 'm:e', kind: 'text' as const, state: 'completed' as const, processed: 3, saved: 3, total: 3, touched: 1, inFlight: 0, dismissed: false };

export function Review() {
  const [live, setLive] = useState(false);
  const [imported, setImported] = useTransientState(notes, empty, () => live ? SUCCESS_FEEDBACK_MS : null);
  const [saved, setSaved] = useTransientState(true, false, () => live ? SUCCESS_FEEDBACK_MS : null);
  const [error, setError] = useState(true);
  const [toast, setToast] = useState(true);
  const [info, setInfo] = useState(true);
  const [task, setTask] = useState(completed);
  const [audit, setAudit] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      const checks = [...document.querySelectorAll<HTMLElement>('.notice-row,.ai-editing-notice')].map(row => {
        const body = row.querySelector<HTMLElement>('.notice-row__message,.ai-editing-copy')!;
        const close = row.querySelector<HTMLButtonElement>('.notice-row__actions,.notice-dismiss,.feedback-dismiss,.ai-editing-close')!;
        const r = row.getBoundingClientRect(), b = body.getBoundingClientRect(), c = close.getBoundingClientRect();
        return { name: row.className, rightOfText: c.left >= b.right - 1,
          sameRow: c.top < b.top + 32, inside: c.right <= r.right + 1,
          insideViewport: r.left >= -1 && r.right <= innerWidth + 1,
          noOverflow: row.scrollWidth <= row.clientWidth + 1 };
      });
      const value = { status: checks.length && checks.every(item => item.rightOfText && item.sameRow && item.inside && item.insideViewport && item.noOverflow) ? 'passed' : 'failed', scope, language, width: innerWidth, checks };
      if (!active) return;
      setAudit(value);
      const host = window as unknown as { webkit?: { messageHandlers?: { review?: { postMessage: (value: string) => void } } } };
      host.webkit?.messageHandlers?.review?.postMessage(JSON.stringify(value));
    });
    return () => { active = false; };
  }, []);
  return <main className="app-shell" style={{ display: 'block', padding: 24, boxSizing: 'border-box', height: '100vh', overflow: 'auto', width: '100%' }}>
    <h1>Synthetic notice review</h1><p>No real files or services. {scope} · {language}</p>
    <label><input type="checkbox" checked={live} onChange={event => setLive(event.target.checked)}/> Live four-second timers</label>{' '}
    <button onClick={() => { setImported(notes); setSaved(true); setError(true); setToast(true); setInfo(true); setTask({ ...completed, touched: Date.now() }); }}>Publish feedback</button>
    <div style={{ marginTop: 24 }}>
      {scope === 'project' && <><MaterialImportNotice notes={imported} onDismiss={() => setImported(empty)}/>{saved && <ProcessingNotice onDismiss={() => setSaved(false)}>{msg('projectImport.materialsDone')}</ProcessingNotice>}</>}
      {scope === 'editor' && <>{error && <LoadErrorNotice text={msg('projectStore.mediaUnreadable')} onDismiss={() => setError(false)}/>}{toast && <SaveToastNotice toast={{ kind: 'error', text: `${msg('projectStore.mediaUnreadable')} ${'Synthetic_filename_'.repeat(12)}` }} onDismiss={() => setToast(false)}/>}</>}
      {scope === 'settings' && <section className="settings-mcp" style={{ maxWidth: 500 }}>
        {saved && <FeedbackNotice text={msg('notice.diagnosticsExported')} onDismiss={() => setSaved(false)}/>}
        {error && <FeedbackNotice error text={msg('connector.setup_error')} onDismiss={() => setError(false)}/>}
        {info && <FeedbackNotice text={msg('connector.added_claude')} onDismiss={() => setInfo(false)}/>}
      </section>}
      {scope === 'progress' && error && <AIEditingNotice activities={[]} onEnd={async () => {}}>
        <ContinuationProgress embedded tasks={[]} error="synthetic_progress_failure" onAction={async () => {}} onDismissError={() => setError(false)}/>
      </AIEditingNotice>}
      {scope === 'recovery' && <AIEditingNotice activities={[]} onEnd={async () => {}}>
        <ContinuationProgress embedded tasks={[]} error="continuation_journal_unreadable" onAction={async () => {}}/>
      </AIEditingNotice>}
      {scope === 'tasks' && <AIEditingNotice activities={[task]} onEnd={async () => {}} onDismiss={async () => setTask({ ...task, dismissed: true })}/>}
    </div>
    <pre id="audit" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{audit ? JSON.stringify(audit, null, 2) : 'Reviewing…'}</pre>
  </main>;
}
void setInterfaceLanguage(language).then(() => createRoot(document.getElementById('root')!).render(<Review/>));
