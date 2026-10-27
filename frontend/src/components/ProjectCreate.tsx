import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { chooseDirectory } from '../lib/projectPreferences';
import { createProject, permit, type OpenProject } from '../lib/projectStore';
import { recordProblem } from '../lib/diagnostics';
import './projectCreate.css';

/** A project must exist on disk before sessions or materials can be added. */
export function ProjectCreate({ onDone, onCancel, onBusyChange }: {
  onDone: (project: OpenProject) => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  useInterfaceLanguage();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!busy) input.current?.focus(); }, [busy]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (name.trim() || inFlight.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [name]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const title = name.trim();
    if (!title || inFlight.current || composing.current) return;
    if (title === '.' || title === '..' || /[\\/]/.test(title)) {
      setError('projectStore.m1397'); return;
    }
    inFlight.current = true;
    setBusy(true); setError(''); onBusyChange?.(true);
    try {
      const parent = await chooseDirectory('save-project');
      await permit(parent, 'readwrite');
      const project = await createProject(parent, title);
      onDone(project);
    } catch (error) {
      if ((error as { name?: string })?.name !== 'AbortError') {
        const message = error instanceof Error ? error.message : '';
        recordProblem('save', error);
        setError(message === msg('projectStore.m1397') ? 'projectStore.m1397'
          : message === msg('projectStore.m1398') ? 'projectStore.m1398' : 'ProjectCreate.saveFailed');
      }
    } finally {
      inFlight.current = false; setBusy(false); onBusyChange?.(false);
    }
  }

  return <form className="project-create" aria-labelledby={`${id}-heading`} aria-busy={busy}
    onSubmit={event => void save(event)} onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}>
    <h1 id={`${id}-heading`}>{msg('ProjectCreate.heading')}</h1>
    <p id={`${id}-hint`} className="project-create__hint">{msg('ProjectCreate.hint')}</p>
    <label htmlFor={`${id}-name`}>{msg('ProjectCreate.name')}</label>
    <input ref={input} id={`${id}-name`} value={name} maxLength={120} disabled={busy}
      autoComplete="off" aria-describedby={`${id}-hint`} onChange={event => setName(event.target.value)} />
    {error && <div className="project-error-notice" role="alert">
      <p>{msg(error)}</p><button type="button" className="notice-dismiss" aria-label={msg('notice.dismiss')} onClick={() => setError('')}>×</button>
    </div>}
    <div className="project-create__actions">
      <button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>{msg('ProjectCreate.cancel')}</button>
      <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>{msg(busy ? 'ProjectCreate.saving' : 'ProjectCreate.save')}</button>
    </div>
    <span className="sr-only" role="status">{busy ? msg('ProjectCreate.saving') : ''}</span>
  </form>;
}
