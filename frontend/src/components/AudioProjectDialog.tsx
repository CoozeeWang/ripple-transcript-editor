import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { chooseDirectory } from '../lib/projectPreferences';
import { useEffect, useRef, useState } from 'react';
import { createProject, importProjectMaterials, openProject, permit, type OpenProject, type ProjectRecording } from '../lib/projectStore';
import { defaultMetadata } from '../localStore';
import { ProjectIcon } from './ProjectIcon';

export function AudioProjectDialog({ file, onCancel, onDone }: {
  file: FileSystemFileHandle; onCancel: () => void;
  onDone: (project: OpenProject, sessionId: string, recording: ProjectRecording) => Promise<void>;
}) {
  useInterfaceLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [target, setTarget] = useState<OpenProject | null>(null);
  const [title, setTitle] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [parent, setParent] = useState<FileSystemDirectoryHandle | null>(null);

  const [storage, setStorage] = useState<'copy' | 'reference'>('copy');
  const [phase, setPhase] = useState<'ready' | 'created' | 'saved'>('ready');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const partial = useRef<OpenProject | null>(null);
  const completed = useRef<{ project: OpenProject; sessionId: string; recording: ProjectRecording } | null>(null);
  const lock = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : msg('AudioProjectDialog.m0344')); }
    finally { lock.current = false; setBusy(false); }
  };
  const choose = () => void run(async () => {
    const directory = await chooseDirectory(mode === 'new' ? 'save-project' : 'open-project');
    await permit(directory, 'readwrite');
    if (mode === 'new') setParent(directory);
    else { setTarget(await openProject(directory)); setSessionId(''); }
  });
  const save = () => void run(async () => {
    if (!completed.current) {
      if (mode === 'new' && !partial.current) await permit(parent!, 'readwrite');
      const project = mode === 'new' ? partial.current ?? await createProject(parent!, title.trim()) : target!;
      if (mode === 'new') { partial.current = project; setPhase('created'); }
      const id = sessionId || crypto.randomUUID();
      const session = project.data.interviews.find(s => s.id === id) ?? { id, title: sessionName.trim(), metadata: { ...defaultMetadata(sessionName.trim()), id }, recordings: [] };
      const previous = new Set(session.recordings.map(r => r.id));
      const next = await importProjectMaterials(project, [{ id: crypto.randomUUID(), kind: 'audio', name: file.name, handle: file, group: id, audioId: '' }], storage, undefined, [session]);
      const recording = next.data.interviews.find(s => s.id === id)!.recordings.find(r => !previous.has(r.id))!;
      completed.current = { project: next, sessionId: id, recording }; setPhase('saved');
    }
    const result = completed.current;
    await onDone(result.project, result.sessionId, result.recording);
  });
  const fixed = busy || phase !== 'ready';
  return <dialog ref={dialog} className="material-preview-dialog audio-project-dialog" aria-labelledby="audio-project-title" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}>
    <div className="dialog-header"><h2 id="audio-project-title">{msg('AudioProjectDialog.m0345')}</h2><button type="button" className="icon-button" aria-label={msg('AudioProjectDialog.m0346')} disabled={busy} onClick={onCancel}>×</button></div>
    <p className="audio-project-file"><ProjectIcon kind="audio"/>{file.name}</p>
    <div className="audio-project-options"><label><input type="radio" name="audio-destination" checked={mode === 'new'} disabled={fixed} onChange={() => { setMode('new'); setSessionId(''); }}/>{msg('AudioProjectDialog.m0347')}</label><label><input type="radio" name="audio-destination" checked={mode === 'existing'} disabled={fixed} onChange={() => { setMode('existing'); setSessionId(''); }}/>{msg('AudioProjectDialog.m0348')}</label></div>
    <div className="audio-project-fields">
      {mode === 'new' && <label className="field"><span>{msg('AudioProjectDialog.m0349')}</span><input value={title} disabled={fixed} onChange={e => setTitle(e.target.value)}/></label>}
      <div className="project-actions"><button className="cred-btn" disabled={fixed} onClick={choose}>{mode === 'new' ? msg('AudioProjectDialog.m0350') : msg('AudioProjectDialog.m0351')}</button><span className="settings-hint">{mode === 'new' ? parent?.name : target?.data.title}</span></div>
      {mode === 'existing' && target && <label className="field"><span>{msg('AudioProjectDialog.m0352')}</span><select value={sessionId} disabled={fixed} onChange={e => setSessionId(e.target.value)}><option value="">{msg('AudioProjectDialog.m0353')}</option>{target.data.interviews.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      {!sessionId && <label className="field"><span>{msg('AudioProjectDialog.m0354')}</span><input value={sessionName} disabled={fixed} placeholder={msg('AudioProjectDialog.m0355')} onChange={e => setSessionName(e.target.value)}/></label>}
      <label className="field"><span>{msg('AudioProjectDialog.m0356')}</span><select value={storage} disabled={fixed} onChange={e => setStorage(e.target.value as 'copy' | 'reference')}><option value="copy">{msg('AudioProjectDialog.m0357')}</option><option value="reference">{msg('AudioProjectDialog.m0358')}</option></select></label>
      <p className="settings-hint">{storage === 'copy' ? msg('AudioProjectDialog.m0359') : msg('AudioProjectDialog.m0360')}</p>
      {error && <p role="alert" className="form-error">{uiMessage(error)}</p>}
    </div>
    <div className="project-actions audio-project-footer"><button className="button button--secondary" disabled={busy} onClick={onCancel}>{msg('AudioProjectDialog.m0361')}</button><button className="button button--primary" disabled={busy || (phase !== 'saved' && ((mode === 'new' ? !title.trim() || !parent : !target) || (!sessionId && !sessionName.trim())))} onClick={save}>{busy ? msg('AudioProjectDialog.m0362') : phase === 'saved' ? msg('AudioProjectDialog.m0363') : msg('AudioProjectDialog.m0364')}</button></div>
  </dialog>;
}
