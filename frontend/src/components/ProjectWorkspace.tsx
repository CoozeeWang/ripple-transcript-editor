import { LanguageControl } from './LanguageControl';
import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { chooseDirectory, pickerLocation, OPEN_LAST_PROJECT, restoredInterview, rememberInterview, canRestoreProject } from '../lib/projectPreferences';
import { loadBooleanPreference } from '../lib/preferences';
import { AssociateAudioDialog } from './AssociateAudioDialog';
import { TrashUndoNotice } from './TrashUndoNotice';
import { DeleteMaterialDialog, ProjectTrashDialog } from './ProjectTrashDialog';
import { useAudioStorageChoice } from './useAudioStorageChoice';
import { ProcessingNotice } from './ProcessingNotice';
import { manuscriptImportNotice } from '../lib/materialImport';
import { useEffect, useRef, useState } from 'react';
import App from '../App';
import { prepareMaterials } from '../lib/materialImport';
import { ProjectExportDialog } from './ProjectExportDialog';
import { hasEditorDrafts } from '../lib/editorDrafts';
import { persistActiveModel } from '../localStore';
import { ProjectSetup } from './ProjectSetup';
import { ProjectBoard } from './ProjectBoard';
import { ProjectIcon } from './ProjectIcon';
import { InlineEdit } from './InlineEdit';
import { useDismissable } from '../useDismissable';
import { trashProjectMaterial, restoreProjectMaterial, clearProjectTrash, importProjectMaterials, findExistingManuscripts, importExistingManuscript, acquireProjectEditor, openProject, permit, forgetRecentProject, recentProjects, recordingDirectory, reassignManuscript, relinkMedia, rememberProject, resolveMedia, saveProject,
  type ExistingManuscript, type OpenProject, type ProjectRecording } from '../lib/projectStore';
import './projectWorkspace.css';

type Picker = Window & {
  showDirectoryPicker: (options: { mode: string }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker: (options: { multiple: boolean; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>;
};
export function ProjectWorkspace() {
  useInterfaceLanguage();
  const audioStorage = useAudioStorageChoice();
  const [trashOpen,setTrashOpen]=useState(false);
  const [undoTrash,setUndoTrash]=useState<string|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<{recording:ProjectRecording;modelId?:string;name:string;hasDocuments:boolean;sessionId:string}|null>(null);
  const [project, setProject] = useState<OpenProject | null>(null);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof recentProjects>>>([]);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ directory: FileSystemDirectoryHandle; recording: ProjectRecording; title: string } | null>(null);
  const [association, setAssociation] = useState<{ source: string; modelId: string; name: string; anchor:DOMRect } | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const recentRef = useRef<HTMLDivElement>(null);
  useDismissable(recentRef, recentOpen, () => setRecentOpen(false));
  const [settings, setSettings] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const restoreSettingsFocus = useRef(false);
  useEffect(() => {
    if (!settings && restoreSettingsFocus.current) {
      restoreSettingsFocus.current = false;
      settingsButton.current?.focus();
    }
  }, [settings]);
  const [showProgress, setShowProgress] = useState(false);
  const [quietSaving, setQuietSaving] = useState(false);
  const [restoreOnStartup] = useState(() => loadBooleanPreference(OPEN_LAST_PROJECT, false));
  const [busy, setBusy] = useState(restoreOnStartup);
  const [error, setError] = useState('');
  const errorNotice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorNotice.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  }, [error]);
  const [creating, setCreating] = useState(false);
  const [materialTarget, setMaterialTarget] = useState<string | null | undefined>(undefined);
  const [editingDescription, setEditingDescription] = useState<string | null>(null);
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false);
  const [importNotice, setImportNotice] = useState<string[]>([]);
  const [legacyCandidates, setLegacyCandidates] = useState<{ interviewId: string; items: ExistingManuscript[] } | null>(null);
  const busyRef = useRef(restoreOnStartup);
  const editorLease = useRef<(() => void) | null>(null);
  useEffect(() => () => { editorLease.current?.(); }, []);
  const current = useRef(project);
  useEffect(() => {
    let cancelled = false;
    const restore = restoreOnStartup;
    void (async () => {
      try {
        const items = await recentProjects();
        if (cancelled) return;
        setRecent(items);
        if (restore && items[0]) {
          if (!await canRestoreProject(items[0].directory)) {
            if (!cancelled) setError(msg('ProjectWorkspace.m0899'));
            return;
          }
          const next = await openProject(items[0].directory);
          if (!cancelled) { setInterviewId(restoredInterview(next)); setProject(next); current.current = next; }
        }
      } catch { if (!cancelled) setError(msg('ProjectWorkspace.m0900')); }
      finally { if (!cancelled && restore) { busyRef.current = false; setBusy(false); } }
    })();
    return () => { cancelled = true; };
  }, [restoreOnStartup]);
  useEffect(() => {
    const id = interviewId ?? project?.data.interviews[0]?.id;
    if (project && id && project.data.interviews.some(i => i.id === id)) rememberInterview(project.data.id, id);
  }, [project, interviewId]);
  const publish = async (next: OpenProject) => {
    setProject(next); current.current = next;
    try { await rememberProject(next); setRecent(await recentProjects()); } catch { /* Project itself is safely stored. */ }
  };
  const run = async (work: () => Promise<void>, progress = true) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setShowProgress(progress); setQuietSaving(!progress); setBusy(true); setError('');
    try { await work(); } catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : msg('ProjectWorkspace.m0901')); }
    finally { busyRef.current = false; setBusy(false); setShowProgress(false); setQuietSaving(false); }
  };
  const chooseProject = (directory?: FileSystemDirectoryHandle) => run(async () => {
    const handle = directory ?? await chooseDirectory('open-project');
    await permit(handle, 'readwrite');
    const next = await openProject(handle);
    setInterviewId(restoredInterview(next)); setImportNotice([]); setMaterialTarget(undefined); await publish(next); setLegacyCandidates(null); setArchiving(false);
  });
  const interview = project?.data.interviews.find(i => i.id === (interviewId ?? project.data.interviews[0]?.id));
  const enterRecording = async (project: OpenProject, recording: ProjectRecording, targetId: string, modelId?: string) => {
    if (!project || !targetId) return;
    const target = project.data.interviews.find(i => i.id === targetId);
    if (!target) throw new Error(msg('ProjectWorkspace.m0902'));
    const release = await acquireProjectEditor(project.data.id);
    let opened = false;
    try {
    // Request access during the user gesture, but missing media must not block manuscripts.
    try { await permit(await resolveMedia(project, targetId, recording), 'read'); } catch { /* Editor displays offline media notice. */ }
    const directory = await recordingDirectory(project, targetId, recording);
    if (modelId) await persistActiveModel(directory, recording.file, modelId);
    setInterviewId(targetId); setEditor({ directory, recording, title: target.title });
    editorLease.current = release; opened = true;
    } finally { if (!opened) release(); }
  };
  const openRecording = (recording: ProjectRecording, targetId = interviewId, modelId?: string) => run(async () => { if (project && targetId) await enterRecording(project, recording, targetId, modelId); });
  const checkManuscripts = async (targetId: string, recordings: ProjectRecording[], folder?: FileSystemDirectoryHandle) => {
    const parent = folder ?? await chooseDirectory('open-audio-folder', 'read');
    const items = await findExistingManuscripts(parent, recordings);
    setLegacyCandidates({ interviewId: targetId, items });
    if (!items.length) setError(msg('ProjectWorkspace.m0903'));
  };
  const returnHome = () => {
    if (busy) return;
    const dirty = creating || materialTarget !== undefined || hasEditorDrafts() || (project && descriptionDrafts[project.data.id] !== undefined && descriptionDrafts[project.data.id] !== project.data.description);
    if (dirty && !window.confirm(msg('ProjectWorkspace.m0904'))) return;
    setTrashOpen(false);setDeleteTarget(null);setUndoTrash(null);setProject(null); current.current = null; setCreating(false); setMaterialTarget(undefined); setInterviewId(null); setRecentOpen(false); setImportNotice([]); setError(''); setAssociation(null); setArchiving(false); setDescriptionDrafts({});
  };
  if (settings) return <App onReturnToProjects={() => { restoreSettingsFocus.current = true; setSettings(false); }} openSettingsInitially={settings} />;
  if (editor && project) return <App key={`${project.data.id}:${editor.recording.id}`} projectDirectory={editor.directory}
    projectLabel={project.data.title} interviewTitle={editor.title} recordingLabel={editor.recording.name}
    interviewMetadata={interview?.metadata} onExportProjectFiles={() => { setEditor(null); editorLease.current?.(); editorLease.current = null; setArchiving(true); }} onReturnToProjects={() => { setEditor(null); editorLease.current?.(); editorLease.current = null; }} />;
  const welcoming = !project && !creating;
  return <main className={`project-home${welcoming ? ' project-home--welcome' : ''}${quietSaving ? ' project-home--quiet-saving' : ''}`}>
    {!welcoming && <header className="project-home__header">
      {!welcoming && <button type="button" className="brand project-brand-home" aria-label={msg('ProjectWorkspace.m0905')} data-tip={msg('ProjectWorkspace.m0906')} data-tip-pos="bottom" disabled={busy} onClick={returnHome}><img className="brand-mark" src="/ripple-icon.svg" alt="" /><div><p className="product-name">Ripple</p><p className="file-name">Transcription Editor</p></div></button>}
      <nav aria-label={msg('ProjectWorkspace.m0907')}>
        <button ref={settingsButton} type="button" className="icon-button" aria-label={msg('ProjectWorkspace.m0908')} data-tip={msg('ProjectWorkspace.m0909')} data-tip-pos="bottom" disabled={busy || creating || materialTarget !== undefined} onClick={() => setSettings(true)}><svg
                className="toolbar-button-icon"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg></button>
        <LanguageControl />
      </nav>
    </header>}
    {audioStorage.dialog}<section className="project-home__content" aria-busy={busy}>
      {error && !welcoming && <div ref={errorNotice} className="project-error-notice" role="alert" aria-atomic="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg>
        <p>{uiMessage(error)}</p>
      </div>}
      {busy && showProgress && <ProcessingNotice>{msg('ProjectWorkspace.m0910')}</ProcessingNotice>}
      {!project ? <>
        {creating ? <ProjectSetup onBusyChange={setBusy} onCancel={() => setCreating(false)} onDone={next => { void publish(next); setCreating(false); setInterviewId(next.data.interviews[0]?.id ?? null); }} /> : <section className="project-welcome" aria-label={msg('ProjectWorkspace.m0911')}>
          <div className="project-welcome__identity">
            <img src="/ripple-icon.svg" alt="" width="80" height="80" />
            <div className="project-welcome__title"><h1>Ripple</h1><p>{msg('ProjectWorkspace.m0912')}</p></div>
          </div>
          <div className="project-welcome__actions">
            <button className="welcome-card" disabled={busy} onClick={() => setCreating(true)}><ProjectIcon kind="plus" /><span>{msg('ProjectWorkspace.m0914')}</span></button>
            <button className="welcome-card" disabled={busy} onClick={() => void chooseProject()}><ProjectIcon kind="project" /><span>{msg('ProjectWorkspace.m0915')}</span></button>
            <div className="recent-dock" ref={recentRef}>
              <button className="recent-dock__btn" aria-label={msg('ProjectWorkspace.m0916')} title={msg('ProjectWorkspace.m0917')} aria-expanded={recentOpen} aria-controls="welcome-recent-projects" disabled={busy} onClick={() => setRecentOpen(open => !open)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              </button>
              {recentOpen && <section id="welcome-recent-projects" className="recent-pop project-welcome__recent"><h2>{msg('ProjectWorkspace.m0918')}</h2>
          {!recent.length ? <p className="settings-hint">{msg('ProjectWorkspace.m0919')}</p> : <div className="project-list">{recent.map(item => <div className="project-recent-row" key={item.id}>
            <button className="project-list__item" disabled={busy} onClick={() => void chooseProject(item.directory)}><ProjectIcon kind="project" /><strong>{item.title}</strong></button>
            <button type="button" className="icon-button project-recent-remove" disabled={busy}
              aria-label={msg('ProjectWorkspace.m0920', { v0: item.title })} title={msg('ProjectWorkspace.m0921')}
              onClick={() => void run(async () => { await forgetRecentProject(item.id); setRecent(await recentProjects()); })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>)}</div>}
</section>}
            </div>
            <LanguageControl welcome />
          </div>
          {error && <div ref={errorNotice} className="project-error-notice project-welcome__error" role="alert" aria-atomic="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg>
            <p>{uiMessage(error)}</p>
          </div>}
        </section>}
      </> : <>
        {deleteTarget&&<DeleteMaterialDialog name={deleteTarget.name} audio={!deleteTarget.modelId} referenced={!deleteTarget.modelId&&deleteTarget.recording.storage==='reference'} hasDocuments={deleteTarget.hasDocuments} busy={busy} error={error} onCancel={()=>setDeleteTarget(null)} onDelete={keepDocuments=>void run(async()=>{const next=await trashProjectMaterial(current.current!,deleteTarget.sessionId,deleteTarget.recording.id,{modelId:deleteTarget.modelId,keepDocuments});await publish(next);setUndoTrash(next.data.trash!.at(-1)!.id);setDeleteTarget(null);},false)}/>}
        {trashOpen&&<ProjectTrashDialog project={project} busy={busy} error={error} onClose={()=>setTrashOpen(false)} onRestore={id=>void run(async()=>{await publish(await restoreProjectMaterial(current.current!,id));if(undoTrash===id)setUndoTrash(null);},false)} onClear={()=>void run(async()=>{await publish(await clearProjectTrash(current.current!));setUndoTrash(null);},false)}/>}
        {undoTrash&&project.data.trash?.some(t=>t.id===undoTrash)&&!trashOpen&&<TrashUndoNotice key={undoTrash} busy={busy} onUndo={()=>void run(async()=>{await publish(await restoreProjectMaterial(current.current!,undoTrash));setUndoTrash(null);},false)} onDismiss={()=>setUndoTrash(null)}/>}
        <div className="setup-title project-saved-title" hidden={materialTarget !== undefined}><ProjectIcon kind="project" /><div className="project-title-content"><div className="project-title-row"><div className="project-title-heading"><h1><InlineEdit doubleClick disabled={busy} value={project.data.title} ariaLabel={msg('ProjectWorkspace.m0922')} onCommit={next => { void run(async () => { if (!next.trim()) throw new Error(msg('ProjectWorkspace.m0923')); await publish(await saveProject(project, { ...project.data, title: next.trim() })); }); }} /></h1>
          <span className="project-interview-count">{msg('review.sessionCount', { count: project.data.interviews.length })}</span></div><div className="project-title-actions">
          <button type="button" className="icon-button" aria-label={msg('ProjectWorkspace.m0925')} data-tip={msg('ProjectWorkspace.m0926')} data-tip-pos="bottom" disabled={busy} onClick={()=>{setError('');setTrashOpen(true);}}><ProjectIcon kind="trash"/></button>
          {project.data.interviews.length > 0 && <button type="button" className="icon-button" aria-label={msg('ProjectWorkspace.m0927')} data-tip={msg('ProjectWorkspace.m0928')} data-tip-pos="bottom" aria-expanded={archiving} disabled={busy} onClick={() => { setArchiving(true); }}>
            <svg className="toolbar-button-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          </button>}</div>
        </div>
        {editingDescription === project.data.id ? <form className="project-description-editor" onSubmit={e => { e.preventDefault(); void run(async () => {
          const description = descriptionDrafts[project.data.id] ?? project.data.description;
          await publish(await saveProject(project, { ...project.data, description }));
          setEditingDescription(null);
          setDescriptionDrafts(previous => { const next = { ...previous }; delete next[project.data.id]; return next; });
        }, false); }}>
          <textarea autoFocus aria-label={msg('ProjectWorkspace.m0929')} disabled={busy} value={descriptionDrafts[project.data.id] ?? project.data.description} onChange={e => setDescriptionDrafts(previous => ({ ...previous, [project.data.id]: e.target.value }))}/>
          <div className="project-actions"><button type="button" className="cred-btn" disabled={busy} onClick={() => { setEditingDescription(null); setDescriptionDrafts(previous => { const next = { ...previous }; delete next[project.data.id]; return next; }); }}>{msg('ProjectWorkspace.m0930')}</button><button className="cred-btn" disabled={busy}>{msg('ProjectWorkspace.m0931')}</button></div>
        </form> : <button type="button" className={`project-description-display${project.data.description ? '' : ' is-empty'}`} aria-label={msg('ProjectWorkspace.m0932')} title={msg('ProjectWorkspace.m0933')} disabled={busy} onDoubleClick={() => setEditingDescription(project.data.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingDescription(project.data.id); } }}>{project.data.description || msg('ProjectWorkspace.m0934')}</button>}
        </div></div>
        {materialTarget !== undefined ? <ProjectSetup onBusyChange={setBusy} project={project} interviewId={materialTarget ?? undefined} onCancel={() => setMaterialTarget(undefined)} onDone={next => { void publish(next); setMaterialTarget(undefined); setInterviewId(materialTarget ?? next.data.interviews.at(-1)?.id ?? null); }} /> : <>
        {importNotice.length>0&&<div className="project-import-notices" role="status">{importNotice.map((note,index)=><p key={index}>{note}</p>)}</div>}
        <ProjectBoard key={project.data.id} project={project} selected={interviewId ?? project.data.interviews[0]?.id ?? null} busy={busy} select={setInterviewId}
          save={interviews => { void run(async () => {
            const snapshot = current.current!;
            setProject({ ...snapshot, data: { ...snapshot.data, interviews } });
            try { await publish(await saveProject(snapshot, { ...snapshot.data, interviews })); }
            catch (error) { setProject(snapshot); throw error; }
          }, false); }}
          createSession={async session => {
            const snapshot = current.current!;
            await publish(await saveProject(snapshot, { ...snapshot.data, interviews: [...snapshot.data.interviews, session] }));
            setInterviewId(session.id);
          }}
          importDocuments={async (id, files, kind = 'manuscript', audioId, referenceable = true) => {
            const materials = await prepareMaterials(files.map(handle => ({ handle, group: id })));
            if (materials.some(item => item.kind !== kind)) throw new Error(kind === 'audio' ? msg('ProjectWorkspace.m0935') : msg('ProjectWorkspace.m0936'));
            const storage = kind === 'audio' ? await audioStorage.choose(materials.map(i=>i.name), referenceable) : 'copy';
            if (!storage) return;
            const snapshot = current.current!;
            const recording = audioId ? snapshot.data.interviews.find(session => session.id === id)?.recordings.find(item => item.id === audioId && item.storage !== 'none') : undefined;
            if (audioId && !recording) throw new Error(msg('ProjectWorkspace.m0937'));
            const linked = materials.map(item => ({ ...item, audioId: audioId ?? '' }));
            if (recording) linked.unshift({ id: recording.id, existingRecordingId: recording.id, name: recording.name, kind: 'audio', group: id, audioId: '', handle: {} as FileSystemFileHandle });
            await publish(await importProjectMaterials(snapshot, linked, storage, id));
            setImportNotice(materials.flatMap(item => { const note = manuscriptImportNotice(item); return note ? [`${item.name}：${note}`] : []; }));
          }}
          add={id => setMaterialTarget(id ?? null)} open={(recording, modelId) => { void openRecording(recording, interviewId ?? project.data.interviews[0]?.id, modelId); }} run={run}
          legacy={recording => { void run(() => checkManuscripts(interviewId ?? project.data.interviews[0].id, [recording])); }}
          remove={(recording,model,hasDocuments=false)=>{setError('');setDeleteTarget({recording,modelId:model?.id,name:model?.label||model?.sourceName||model?.engine||recording.name,hasDocuments,sessionId:interviewId??project.data.interviews[0].id});}}
          detach={async (recording, modelId) => { const snapshot=current.current!; await publish(await reassignManuscript(snapshot, interviewId ?? snapshot.data.interviews[0].id, recording.id, '', modelId)); }}
          associate={(recording,model,anchor) => { setError('');setInterviewId(interviewId ?? project.data.interviews[0].id); setAssociation({ source: recording.id, modelId:model.id, name:model.label||model.sourceName||model.engine,anchor }); }}
          relink={recording => { void run(async () => { const [handle] = await (window as unknown as Picker).showOpenFilePicker({ ...await pickerLocation('open-audio', 'read'), multiple: false }); if (handle) await publish(await relinkMedia(project, interviewId ?? project.data.interviews[0].id, recording, handle)); }); }} />
            {interview && legacyCandidates?.interviewId === interview.id && legacyCandidates.items.map((candidate, index) => <div className="project-section project-import-existing" key={`${candidate.recordingId}:${index}`}>
              <strong>{msg('ProjectWorkspace.m0938')}</strong>
              <p>{candidate.directory.name}</p>
              <p className="settings-hint">{msg('review.importSummary', { originals: msg('review.originalCount', { count: candidate.manifest.models.filter(m => m.original).length }), revisions: msg('review.revisionCount', { count: candidate.manifest.models.reduce((n, m) => n + m.edits.length, 0) }), details: msg('review.importDetails') })}</p>
              <div className="project-actions"><button className="button button--secondary" disabled={busy} onClick={() => void run(async () => {
                const snapshot = current.current!;
                const recording = snapshot.data.interviews.find(i => i.id === interview.id)!.recordings.find(r => r.id === candidate.recordingId)!;
                await publish(await importExistingManuscript(snapshot, interview.id, recording, candidate));
                setLegacyCandidates(previous => previous ? { ...previous, items: previous.items.filter(item => item.recordingId !== candidate.recordingId) } : null);

              })}>{msg('ProjectWorkspace.m0941')}</button><button className="cred-btn" disabled={busy} onClick={() => { setLegacyCandidates(null); }}>{msg('ProjectWorkspace.m0942')}</button></div>
            </div>)}
            {interview && association && <AssociateAudioDialog anchor={association.anchor} name={association.name} recordings={interview.recordings.filter(r=>r.storage!=='none')} busy={busy} error={error} onClose={()=>setAssociation(null)} onConfirm={target=>void run(async()=>{await publish(await reassignManuscript(current.current!,interview.id,association.source,target,association.modelId));setAssociation(null);},false)}/>}


        </>}
      </>}
    </section>
    {project && archiving && <ProjectExportDialog project={project} onClose={() => setArchiving(false)} />}
  </main>;
}
