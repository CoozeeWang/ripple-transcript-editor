import { createSegmentLinkDelivery, type SegmentLinkReceiver } from '../lib/segmentLinkDelivery';
import { resolveLinkProject } from '../lib/segmentLinkProject';
import { parseSegmentLink, type SegmentTarget } from '../lib/segmentTransfer';
import { nextSegmentLink } from '../lib/segmentLinkBridge';
import { resolveSegmentTarget } from '../lib/segmentTarget';
import { blocksHumanEditing } from '../lib/aiEditOwnership';
import { ActionIcon } from './ActionIcon';
import { restoreProjectTagTransaction, transactProjectTags } from '../lib/projectTagRepository';
import { recordProblem } from '../lib/diagnostics';
import { selectAudioReferences } from '../lib/audioReferenceSelection';
import { nativeDesktopAvailable, nativeAccessStatus } from '../lib/desktopFs';
import { LanguageControl } from './LanguageControl';
import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { chooseDirectory, pickerLocation, OPEN_LAST_PROJECT, restoredInterview, rememberInterview, canRestoreProject } from '../lib/projectPreferences';
import { loadBooleanPreference } from '../lib/preferences';
import { AssociateAudioDialog } from './AssociateAudioDialog';
import { TrashUndoNotice } from './TrashUndoNotice';
import { DeleteSessionDialog } from './DeleteSessionDialog';
import { DeleteMaterialDialog, ProjectTrashDialog } from './ProjectTrashDialog';
import { useAudioStorageChoice } from './useAudioStorageChoice';
import { ProcessingNotice } from './ProcessingNotice';
import { MaterialImportNotice, type MaterialImportNote } from './MaterialImportNotice';
import { SUCCESS_FEEDBACK_MS, useTransientState } from '../hooks/useTransientState';
import { ProjectImportStatus } from './ProjectImportStatus';
import { manuscriptImportNoticeKeys } from '../lib/materialImport';
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConnectorContext } from '../hooks/connectorContext';
import App from '../App';
import { prepareMaterials } from '../lib/materialImport';
import { ProjectExportDialog } from './ProjectExportDialog';
import { hasEditorDrafts } from '../lib/editorDrafts';
import { persistActiveModel } from '../localStore';
import { ProjectSetup } from './ProjectSetup';
import { ProjectCreate } from './ProjectCreate';
import { RecentProjectsNotice } from './RecentProjectsNotice';
import { ProjectBoard } from './ProjectBoard';
import { ProjectIcon } from './ProjectIcon';
import { InlineEdit } from './InlineEdit';
import { useDismissable } from '../useDismissable';
import { moveProjectRecordings, trashProjectInterview, trashProjectMaterial, restoreProjectTrashItem, clearProjectTrash, importProjectMaterials, findExistingManuscripts, importExistingManuscript, acquireProjectEditor, openProject, permit, forgetRecentProject, recentProjects, recordingDirectory, reassignManuscript, relinkMedia, rememberProject, resolveMedia, saveProject, saveRecordingDuration,
  type ExistingManuscript, type OpenProject, type ProjectInterview, type ProjectRecording, type ProjectImportStage } from '../lib/projectStore';
import './projectWorkspace.css';

type Picker = Window & {
  showDirectoryPicker: (options: { mode: string }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker: (options: { multiple: boolean; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>;
};
const NO_IMPORT_NOTES: MaterialImportNote[] = [];
export function ProjectWorkspace() {
  const aiConnector = useContext(ConnectorContext);
  useInterfaceLanguage();
  const audioStorage = useAudioStorageChoice();
  const [trashOpen,setTrashOpen]=useState(false);
  const [sessionDelete,setSessionDelete]=useState<{session:ProjectInterview;revision:number}|null>(null);
  const focusProjectSelection=useRef(false);
  const [undoTrash,setUndoTrash]=useState<string|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<{recording:ProjectRecording;modelId?:string;name:string;hasDocuments:boolean;sessionId:string}|null>(null);
  const [project, setProject] = useState<OpenProject | null>(null);
  const reportProject = aiConnector?.reportProject;
  useLayoutEffect(() => { reportProject?.(project?.data.id ?? ''); }, [reportProject, project?.data.id]);
  const [mediaRevision, setMediaRevision] = useState(0);
  const assertRecordingMutable = (session: string, recording: string) => {
    if (aiConnector?.state.targetLocked?.('', recording, session, project?.data.id)) throw Error(msg('aiEditing.inUse'));
  };
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof recentProjects>>>([]);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ directory: FileSystemDirectoryHandle; recording: ProjectRecording; title: string; originalModelId?: string } | null>(null);
  const [linkOpenSequence, setLinkOpenSequence] = useState(0);
  const [linkTarget, setLinkTarget] = useState<SegmentTarget | null>(null);
  const linkReceiver = useRef<SegmentLinkReceiver | null>(null);
  const registerLinkReceiver = useCallback((receiver: SegmentLinkReceiver | null) => { linkReceiver.current = receiver; }, []);
  const deliverLink = useRef(createSegmentLinkDelivery(nextSegmentLink));
  const [association, setAssociation] = useState<{ source: string; modelId: string; name: string; anchor:DOMRect } | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentWriteFailure, setRecentWriteFailure] = useState<string | null>(null);
  const recentWriteAttempt = useRef(0);
  const [recentRecovery, setRecentRecovery] = useState<{id:string;title:string;reason:'missing'|'permission'|'unreadable'} | null>(null);
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
  const exportButton = useRef<HTMLButtonElement>(null);
  const [importNotice, setImportNotice] = useTransientState<MaterialImportNote[]>(NO_IMPORT_NOTES, NO_IMPORT_NOTES, notes => notes.length ? SUCCESS_FEEDBACK_MS : null);
  const [successNotice, setSuccessNotice] = useTransientState<string | null>(null, null);
  const clearPageFeedback = (preserveSuccess = false) => {
    setImportNotice(NO_IMPORT_NOTES);
    if (!preserveSuccess) setSuccessNotice(null);
    setUndoTrash(null);
  };
  const [importStage, setImportStage] = useState<ProjectImportStage | null>(null);
  const importController = useRef<AbortController | null>(null);
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
          if (next.data.id !== items[0].id) throw new Error(msg('ProjectWorkspace.recentProjectMismatch'));
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
  const updateRecent = async (next: OpenProject) => {
    const attempt = ++recentWriteAttempt.current;
    try {
      await rememberProject(next);
      const items = await recentProjects();
      if (attempt === recentWriteAttempt.current) {
        setRecent(items);
        if (current.current?.data.id === next.data.id) setRecentWriteFailure(null);
      }
    } catch (error) {
      recordProblem('save', error);
      if (attempt === recentWriteAttempt.current && current.current?.data.id === next.data.id) setRecentWriteFailure(next.data.id);
    }
  };
  const publish = async (next: OpenProject) => {
    setProject(next); current.current = next;
    await updateRecent(next);
  };
  const run = async (work: () => Promise<void>, progress = true) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setShowProgress(progress); setQuietSaving(!progress); setBusy(true); setError(''); setImportNotice(NO_IMPORT_NOTES); setSuccessNotice(null);
    try { await work(); } catch (e) { if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : msg('ProjectWorkspace.m0901')); }
    finally { busyRef.current = false; setBusy(false); setShowProgress(false); setQuietSaving(false); setImportStage(null); }
  };
  const projectHasAIWork = () => Boolean(aiConnector?.state.activities?.some(blocksHumanEditing));
  const openChosenProject = async (directory?: FileSystemDirectoryHandle, expectedId?: string) => {
    if (projectHasAIWork()) throw Error(msg('ProjectWorkspace.openProjectAI'));
    let handle = directory;
    if (handle && expectedId && nativeDesktopAvailable()) {
      const status = await nativeAccessStatus(handle);
      if (status !== 'granted') {
        setRecentRecovery({id:expectedId,title:recent.find(item=>item.id===expectedId)?.title ?? handle.name,reason:status});
        return false;
      }
    }
    handle ??= await chooseDirectory('open-project');
    await permit(handle, 'readwrite');
    let next: OpenProject;
    try { next = await openProject(handle); }
    catch (error) {
      if (directory && expectedId) {
        setRecentRecovery({id:expectedId,title:recent.find(item=>item.id===expectedId)?.title ?? handle.name,
          reason:(error as {name?:string})?.name==='NotFoundError'?'missing':'unreadable'});
        return false;
      }
      throw error;
    }
    if (expectedId && next.data.id !== expectedId) throw new Error(msg('ProjectWorkspace.recentProjectMismatch'));
    if (projectHasAIWork()) throw Error(msg('ProjectWorkspace.openProjectAI'));
    clearPageFeedback();
    setRecentRecovery(null); setRecentOpen(false); setInterviewId(restoredInterview(next)); setImportNotice(NO_IMPORT_NOTES); setMaterialTarget(undefined);
    setEditingDescription(null); setDescriptionDrafts({}); setCreating(false);
    setEditor(null); editorLease.current?.(); editorLease.current = null;
    await publish(next); setLegacyCandidates(null); setArchiving(false);
    return true;
  };
  const chooseProject = (directory?: FileSystemDirectoryHandle, expectedId?: string) => run(async () => { await openChosenProject(directory, expectedId); });
  const openProjectFromEditor = async (recentId?: string) => {
    if (busyRef.current) throw Error(msg('ProjectWorkspace.openProjectBusy'));
    if (projectHasAIWork()) throw Error(msg('ProjectWorkspace.openProjectAI'));
    busyRef.current = true; setBusy(true);
    try {
      const item = recentId ? (await recentProjects()).find(entry => entry.id === recentId) : undefined;
      if (recentId && !item) throw Error(msg('ProjectWorkspace.m0919'));
      const opened = await openChosenProject(item?.directory, item?.id);
      if (!opened) { setEditor(null); editorLease.current?.(); editorLease.current = null; }
    }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (editor || settings) return;
    const onOpenProject = (recentId?: string) => {
      if (busyRef.current) { setError(msg('ProjectWorkspace.openProjectBusy')); return; }
      if (projectHasAIWork()) { setError(msg('ProjectWorkspace.openProjectAI')); return; }
      const dirty = creating || materialTarget !== undefined || hasEditorDrafts() ||
        (project && descriptionDrafts[project.data.id] !== undefined && descriptionDrafts[project.data.id] !== project.data.description);
      if (dirty) { setError(msg('ProjectWorkspace.openProjectUnsaved')); return; }
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      const item = recentId ? recent.find(entry => entry.id === recentId) : undefined;
      if (recentId && !item) { setError(msg('ProjectWorkspace.m0919')); return; }
      void chooseProject(item?.directory, item?.id);
    };
    const onOpenDirectory = () => onOpenProject();
    const onOpenRecent = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === 'string') onOpenProject(id);
    };
    window.addEventListener('ripple-open-project', onOpenDirectory);
    window.addEventListener('ripple-open-recent-project', onOpenRecent);
    return () => { window.removeEventListener('ripple-open-project', onOpenDirectory); window.removeEventListener('ripple-open-recent-project', onOpenRecent); };
  });
  const interview = project?.data.interviews.find(i => i.id === (interviewId ?? project.data.interviews[0]?.id));
  const canDeleteSession = (session: ProjectInterview) => !session.recordings.some(recording =>
    aiConnector?.state.targetLocked?.('', recording.id, session.id, project?.data.id));
  const restoreTrash = async (id: string) => {
    const snapshot = current.current!;
    const restoredSession = snapshot.data.sessionTrash?.find(item => item.id === id)?.interview;
    const next = await restoreProjectTrashItem(snapshot, id);
    await publish(next);
    if (restoredSession) { setInterviewId(restoredSession.id); focusProjectSelection.current = true; }
    if (undoTrash === id) setUndoTrash(null);
  };
  useEffect(() => {
    if (!focusProjectSelection.current || trashOpen || sessionDelete || busy) return;
    focusProjectSelection.current = false;
    const selected = Array.from(document.querySelectorAll<HTMLElement>('[data-session-id]')).find(row => row.dataset.sessionId === interviewId);
    (selected ?? document.querySelector<HTMLElement>('.setup-session-add'))?.focus();
  }, [project, interviewId, trashOpen, sessionDelete, busy]);
  const enterRecording = async (project: OpenProject, recording: ProjectRecording, targetId: string, modelId?: string, editId?: string) => {
    if (!project || !targetId) return;
    const target = project.data.interviews.find(i => i.id === targetId);
    if (!target) throw new Error(msg('ProjectWorkspace.m0902'));
    const release = await acquireProjectEditor(project.data.id);
    let opened = false;
    try {
    // Request access during the user gesture, but missing media must not block manuscripts.
    try { await permit(await resolveMedia(project, targetId, recording), 'read'); } catch { /* Editor displays offline media notice. */ }
    const directory = await recordingDirectory(project, targetId, recording);
    if (modelId) await persistActiveModel(directory, recording.file, modelId, editId === "original" ? undefined : editId);
    clearPageFeedback();
    setInterviewId(targetId); setEditor({ directory, recording, title: target.title, originalModelId: editId === "original" ? modelId : undefined });
    editorLease.current = release; opened = true;
    } finally { if (!opened) release(); }
  };
  const openRecording = (recording: ProjectRecording, targetId = interviewId, modelId?: string, editId?: string) => run(async () => { if (project && targetId) { await enterRecording(project, recording, targetId, modelId, editId); setLinkTarget(null); } });
  const openSegmentLink = async (raw: string) => {
    const target = parseSegmentLink(raw);
    if (busyRef.current || projectHasAIWork()) throw Error(msg('ProjectWorkspace.openProjectBusy'));
    const next = await resolveLinkProject(target.project,current.current,await recentProjects(),{
      access:nativeAccessStatus, open:openProject, permit:directory => permit(directory,'readwrite'),
      choose:async () => window.confirm(msg('segmentTransfer.reselect')) ? chooseDirectory('open-project') : null,
    });
    if (!next) return;
    const {session,recording,model,version} = await resolveSegmentTarget(next,target);
    const resolvedTarget = {...target,recording:recording.id,model,version};
    // Retain the existing editor lease until the target is ready. Failure must leave the source protected.
    const previousLease = editorLease.current;
    const reuseLease = current.current?.data.id === next.data.id && previousLease;
    const release = reuseLease || await acquireProjectEditor(next.data.id);
    let opened = false;
    try {
      const directory = await recordingDirectory(next,session.id,recording);
      await persistActiveModel(directory,recording.file,model,version === 'original' ? undefined : version);
      await publish(next);
      setInterviewId(session.id);
      setEditor({directory,recording,title:session.title,originalModelId:version === 'original' ? model : undefined});
      editorLease.current = release;
      if (previousLease && previousLease !== release) previousLease();
      opened = true;
    } finally { if (!opened && release !== previousLease) release(); }
    setLinkTarget(resolvedTarget);
    setLinkOpenSequence(previous => previous + 1);
  };
  const linkPoll = useRef<() => Promise<void>>(async () => {});
  useLayoutEffect(() => {
    linkPoll.current = async () => {
      const ready = () => !busyRef.current && !settings && !document.querySelector('dialog[open], [role="dialog"]') && (!editor || !!linkReceiver.current?.ready());
      try {
        await deliverLink.current({ready, open:async raw => {
          if (editor) { await linkReceiver.current?.open(raw); return; }
          if (creating || materialTarget !== undefined || hasEditorDrafts() || (project && descriptionDrafts[project.data.id] !== undefined && descriptionDrafts[project.data.id] !== project.data.description)) {
            setError(msg('ProjectWorkspace.openProjectUnsaved')); return;
          }
          await openSegmentLink(raw);
        }});
      } catch (error) { setError(error instanceof Error ? error.message : msg('segmentTransfer.openFailed')); }
    };
  });
  useEffect(() => {
    const timer = window.setInterval(() => void linkPoll.current(),750);
    return () => window.clearInterval(timer);
  }, []);
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
    clearPageFeedback();
    setRecentWriteFailure(null);
    setTrashOpen(false);setSessionDelete(null);setDeleteTarget(null);setUndoTrash(null);setProject(null); current.current = null; setCreating(false); setMaterialTarget(undefined); setInterviewId(null); setRecentOpen(false); setImportNotice(NO_IMPORT_NOTES); setError(''); setAssociation(null); setArchiving(false); setDescriptionDrafts({});
  };
  if (settings) return <App onReturnToProjects={() => { restoreSettingsFocus.current = true; setSettings(false); }} openSettingsInitially={settings} />;
  if (editor && project) return <App registerSegmentLinkReceiver={registerLinkReceiver} onOpenSegmentLink={openSegmentLink} initialSegmentTarget={linkTarget ?? undefined} initialOriginalModelId={editor.originalModelId} key={`${project.data.id}:${editor.recording.id}:${linkOpenSequence}`} projectDirectory={editor.directory}
    tagLibrary={project.data.tagLibrary} tagStorage={{
      transact:async(version,operation)=>{
        if(projectHasAIWork())throw Error(msg('ProjectWorkspace.openProjectAI'));
        const snapshot=current.current;if(!snapshot||snapshot.data.id!==project.data.id)throw Error('project_changed');
        const result=await transactProjectTags(snapshot,version,operation);await publish(result.project);return result;
      },
      restore:async(receipt,redo)=>{
        if(projectHasAIWork())throw Error(msg('ProjectWorkspace.openProjectAI'));
        const snapshot=current.current;if(!snapshot||snapshot.data.id!==project.data.id)throw Error('project_changed');
        const next=await restoreProjectTagTransaction(snapshot,receipt,redo);await publish(next);return next;
      },
    }}
    connectorProject={() => current.current} projectInterviewId={interview!.id} projectRecordingId={editor.recording.id}
    projectLabel={project.data.title} interviewTitle={editor.title} recordingLabel={interview?.recordings.find(item=>item.id===editor.recording.id)?.name ?? editor.recording.name}
    onAudioDuration={async seconds => {
      const snapshot = current.current;
      if (!snapshot || snapshot.data.id !== project.data.id) return;
      try {
        const next = await saveRecordingDuration(snapshot, editor.recording.id, editor.recording.fingerprint, seconds);
        if (next !== snapshot && current.current?.data.id === snapshot.data.id && current.current.data.revision <= next.data.revision) await publish(next);
      } catch (error) {
        setError(msg('audioDuration.saveFailed'));
        throw error;
      }
    }}
    onRenameInterview={async title => {
      const snapshot = current.current!;
      const interviews = snapshot.data.interviews.map(session => ({...session, recordings: session.recordings.map(recording =>
        recording.id===editor.recording.id ? {...recording, name:title.trim()} : recording)}));
      await publish(await saveProject(snapshot, {...snapshot.data, interviews}));
    }}
    interviewMetadata={interview?.metadata} recordingDraft={interview?.recordings.find(item => item.id === editor.recording.id)?.draft}
    saveRecordingDraft={async draft => {
      const snapshot = current.current!;
      const session = snapshot.data.interviews.find(item => item.id === interview?.id);
      const recording = session?.recordings.find(item => item.id === editor.recording.id);
      if (!session || !recording) throw new Error(msg('ProjectWorkspace.m0902'));
      if (JSON.stringify(recording.draft) === JSON.stringify(draft)) return;
      const interviews = snapshot.data.interviews.map(item => item.id === session.id
        ? { ...item, recordings: item.recordings.map(entry => entry.id === recording.id ? { ...entry, draft } : entry) }
        : item);
      await publish(await saveProject(snapshot, { ...snapshot.data, interviews }));
    }} onExportProjectFiles={() => { setEditor(null); editorLease.current?.(); editorLease.current = null; setArchiving(true); }} onOpenProject={openProjectFromEditor} onReturnToProjects={() => { setEditor(null); editorLease.current?.(); editorLease.current = null; }} />;
  const welcoming = !project && !creating;
  return <main className={`project-home${welcoming ? ' project-home--welcome' : ''}${quietSaving ? ' project-home--quiet-saving' : ''}${project && materialTarget === undefined ? ' project-home--board' : ''}`}>
    {!welcoming && <header className="project-home__header">
      {!welcoming && <button type="button" className="brand project-brand-home" aria-label={msg('ProjectWorkspace.m0905')} data-tip={msg('ProjectWorkspace.m0906')} data-tip-pos="bottom" disabled={busy} onClick={returnHome}><img className="brand-mark" src="/ripple-icon.svg" alt="" /><div><p className="product-name">Ripple</p><p className="file-name">Transcription Editor</p></div></button>}
      <nav aria-label={msg('ProjectWorkspace.m0907')}>
        {project && <button type="button" className="icon-button" aria-label={msg('ProjectWorkspace.m0925')} data-tip={msg('ProjectWorkspace.m0926')} data-tip-pos="bottom" disabled={busy || creating || materialTarget !== undefined} onClick={()=>{setError('');setTrashOpen(true);}}><ActionIcon kind="trash"/></button>}
        <button ref={settingsButton} type="button" className="icon-button" aria-label={msg('ProjectWorkspace.m0908')} data-tip={msg('ProjectWorkspace.m0909')} data-tip-pos="bottom" disabled={busy || creating || materialTarget !== undefined} onClick={() => { clearPageFeedback(); setSettings(true); }}><ActionIcon kind="settings"/></button>
        <LanguageControl />
      </nav>
    </header>}
    {audioStorage.dialog}<section className="project-home__content" aria-busy={busy}>
      {project?.finderIconWarning && <p role="status" className="settings-hint">{msg('ProjectWorkspace.finderIconWarning')}</p>}
      {project && recentWriteFailure === project.data.id && <RecentProjectsNotice busy={busy}
        onRetry={()=>void run(async()=>{const snapshot=current.current;if(snapshot)await updateRecent(snapshot);},false)} onDismiss={()=>setRecentWriteFailure(null)}/>}
      {recentRecovery && <div className="project-error-notice recent-project-recovery" role="status">
        <p>{msg(recentRecovery.reason==='missing'?'ProjectWorkspace.recentMissing':recentRecovery.reason==='permission'?'ProjectWorkspace.recentPermission':'ProjectWorkspace.recentUnreadable',{title:recentRecovery.title})}</p>
        <div className="recent-project-recovery__actions">
          <button type="button" className="button button--secondary" disabled={busy} onClick={()=>chooseProject(undefined,recentRecovery.id)}>{msg('ProjectWorkspace.recentRecover')}</button>
          <button type="button" className="button button--secondary" disabled={busy} onClick={()=>setRecentRecovery(null)}>{msg('ProjectWorkspace.recentDismiss')}</button>
        </div>
      </div>}
      {error && !welcoming && <div ref={errorNotice} className="project-error-notice" role="alert" aria-atomic="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg>
        <p>{uiMessage(error)}</p><button type="button" className="notice-dismiss" aria-label={msg('notice.dismiss')} onClick={()=>setError('')}>×</button>
      </div>}
      {busy && showProgress && !importStage && <ProcessingNotice>{msg('ProjectWorkspace.m0910')}</ProcessingNotice>}
      {successNotice && <ProcessingNotice onDismiss={()=>setSuccessNotice(null)}>{uiMessage(successNotice)}</ProcessingNotice>}
      {!project ? <>
        {creating ? <ProjectCreate onBusyChange={setBusy} onCancel={() => setCreating(false)} onDone={next => { focusProjectSelection.current = true; void publish(next); setCreating(false); setInterviewId(null); }} /> : <section className="project-welcome" aria-label={msg('ProjectWorkspace.m0911')}>
          <div className="project-welcome__identity">
            <img src="/ripple-icon.svg" alt="" width="80" height="80" />
            <div className="project-welcome__title"><h1>Ripple</h1><p>{msg('ProjectWorkspace.m0912')}</p></div>
          </div>
          <div className="project-welcome__actions">
            <button className="welcome-card" disabled={busy} onClick={() => { setError(''); setCreating(true); }}><ProjectIcon kind="plus" /><span>{msg('ProjectWorkspace.m0914')}</span></button>
            <button className="welcome-card" disabled={busy} onClick={() => void chooseProject()}><ProjectIcon kind="project" /><span>{msg('ProjectWorkspace.m0915')}</span></button>
            <div className="recent-dock" ref={recentRef}>
              <button className="recent-dock__btn" aria-label={msg('ProjectWorkspace.m0916')} data-tip={msg('ProjectWorkspace.m0917')} aria-expanded={recentOpen} aria-controls="welcome-recent-projects" disabled={busy} onClick={() => setRecentOpen(open => !open)}>
                <ActionIcon kind="clock"/>
              </button>
              {recentOpen && <section id="welcome-recent-projects" className="recent-pop project-welcome__recent"><h2>{msg('ProjectWorkspace.m0918')}</h2>
          {!recent.length ? <p className="settings-hint">{msg('ProjectWorkspace.m0919')}</p> : <div className="project-list">{recent.map(item => <div className="project-recent-row" key={item.id}>
            <button className="project-list__item" disabled={busy} onClick={() => void chooseProject(item.directory, item.id)}><ProjectIcon kind="project" /><strong>{item.title}</strong></button>
            <button type="button" className="icon-button project-recent-remove" disabled={busy}
              aria-label={msg('ProjectWorkspace.m0920', { v0: item.title })} data-action-tip={msg('ProjectWorkspace.m0921')}
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
            <p>{uiMessage(error)}</p><button type="button" className="notice-dismiss" aria-label={msg('notice.dismiss')} onClick={()=>setError('')}>×</button>
          </div>}
        </section>}
      </> : <>
        {deleteTarget&&<DeleteMaterialDialog name={deleteTarget.name} audio={!deleteTarget.modelId} referenced={!deleteTarget.modelId&&deleteTarget.recording.storage==='reference'} hasDocuments={deleteTarget.hasDocuments} busy={busy} error={error} onCancel={()=>setDeleteTarget(null)} onDelete={keepDocuments=>void run(async()=>{assertRecordingMutable(deleteTarget.sessionId,deleteTarget.recording.id);const next=await trashProjectMaterial(current.current!,deleteTarget.sessionId,deleteTarget.recording.id,{modelId:deleteTarget.modelId,keepDocuments});await publish(next);setUndoTrash(next.data.trash!.at(-1)!.id);setDeleteTarget(null);},false)}/>}
        {sessionDelete && <DeleteSessionDialog name={sessionDelete.session.title} busy={busy} changed={project.data.revision !== sessionDelete.revision} error={error}
          onCancel={() => { setSessionDelete(null); setError(''); }} onDelete={() => void run(async () => {
            const snapshot = current.current!;
            if (snapshot.data.revision !== sessionDelete.revision) throw Error(msg('sessionTrash.changed'));
            const session = snapshot.data.interviews.find(item => item.id === sessionDelete.session.id);
            if (!session) throw Error(msg('sessionTrash.missing'));
            session.recordings.forEach(recording => assertRecordingMutable(session.id, recording.id));
            const position = snapshot.data.interviews.findIndex(item => item.id === session.id);
            const next = await trashProjectInterview(snapshot, session.id);
            await publish(next); clearPageFeedback();
            setInterviewId(next.data.interviews[Math.min(position, next.data.interviews.length - 1)]?.id ?? null);
            setUndoTrash(next.data.sessionTrash!.at(-1)!.id);
            focusProjectSelection.current = true; setSessionDelete(null);
          }, false)}/>}
        {trashOpen&&<ProjectTrashDialog project={project} busy={busy} error={error} onClose={()=>setTrashOpen(false)} onRestore={id=>void run(()=>restoreTrash(id),false)} onClear={()=>void run(async()=>{await publish(await clearProjectTrash(current.current!));setUndoTrash(null);},false)}/>}
        {undoTrash&&(project.data.trash?.some(t=>t.id===undoTrash)||project.data.sessionTrash?.some(t=>t.id===undoTrash))&&!trashOpen&&<TrashUndoNotice key={undoTrash} busy={busy} onUndo={()=>void run(()=>restoreTrash(undoTrash),false)} onDismiss={()=>setUndoTrash(null)}/>}
        <div className="setup-title project-saved-title" hidden={materialTarget !== undefined}><ProjectIcon kind="project" /><div className="project-title-content"><div className="project-title-row"><div className="project-title-heading"><h1><InlineEdit doubleClick disabled={busy} value={project.data.title} ariaLabel={msg('ProjectWorkspace.m0922')} onCommit={next => { void run(async () => { if (!next.trim()) throw new Error(msg('ProjectWorkspace.m0923')); await publish(await saveProject(project, { ...project.data, title: next.trim() })); }); }} /></h1>
          </div><div className="project-title-actions">
          {project.data.interviews.length > 0 && <button ref={exportButton} type="button" className="icon-button" aria-label={msg('ProjectWorkspace.m0927')} data-tip={msg('ProjectWorkspace.m0928')} data-tip-pos="bottom" aria-expanded={archiving} disabled={busy} onClick={() => { setArchiving(true); }}>
            <ActionIcon kind="export"/>
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
        </form> : <button type="button" className={`project-description-display${project.data.description ? '' : ' is-empty'}`} aria-label={msg('ProjectWorkspace.m0932')} data-action-tip={msg('ProjectWorkspace.m0933')} disabled={busy} onDoubleClick={() => setEditingDescription(project.data.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingDescription(project.data.id); } }}>{project.data.description || msg('ProjectWorkspace.m0934')}</button>}
        </div></div>
        {materialTarget !== undefined ? <ProjectSetup onBusyChange={setBusy} project={project} interviewId={materialTarget ?? undefined} onCancel={() => setMaterialTarget(undefined)} onDone={next => { void publish(next); setSuccessNotice(msg('projectImport.materialsDone')); setMaterialTarget(undefined); setInterviewId(materialTarget ?? next.data.interviews.at(-1)?.id ?? null); }} /> : <>
        {importStage && <ProjectImportStatus stage={importStage} onCancel={() => importController.current?.abort()} />}
        <MaterialImportNotice notes={importNotice} onDismiss={()=>setImportNotice(NO_IMPORT_NOTES)} />
        <ProjectBoard deleteSession={session=>{setError('');setSessionDelete({session,revision:project.data.revision});}} canDeleteSession={canDeleteSession} key={project.data.id} project={project} mediaRevision={mediaRevision} selected={interviewId ?? project.data.interviews[0]?.id ?? null} busy={busy} select={(id,preserveFeedback)=>{setError('');clearPageFeedback(preserveFeedback);setInterviewId(id);}}
          save={interviews => { void run(async () => {
            const snapshot = current.current!;
            setProject({ ...snapshot, data: { ...snapshot.data, interviews } });
            try { await publish(await saveProject(snapshot, { ...snapshot.data, interviews })); }
            catch (error) { setProject(snapshot); throw error; }
          }, false); }}
          moveRecordings={async (source, target, ids) => {
            ids.forEach(id => assertRecordingMutable(source, id));
            const next = await moveProjectRecordings(current.current!, source, target, ids);
            await publish(next);
            setMediaRevision(value => value + 1);
            setSuccessNotice(msg('recordingMove.done', { target: next.data.interviews.find(session => session.id === target)!.title }));
          }}
          createSession={async session => {
            const snapshot = current.current!;
            await publish(await saveProject(snapshot, { ...snapshot.data, interviews: [...snapshot.data.interviews, session] }));
            setInterviewId(session.id);
          }}
          importDocuments={async (id, files, kind = 'manuscript', audioId, referenceable = true) => {
            const materials = await prepareMaterials(files.map(handle => ({ handle, group: id })));
            if (materials.some(item => item.kind !== kind)) throw new Error(kind === 'audio' ? msg('ProjectWorkspace.m0935') : msg('ProjectWorkspace.m0936'));
            const storage = kind === 'audio' ? await audioStorage.choose(materials.map(i=>i.name), referenceable, async()=>{ const selected=await selectAudioReferences(materials.map(i=>i.handle)); if(!selected)return false; materials.forEach((item,index)=>{item.handle=selected[index];}); return true; }) : 'copy';
            if (!storage) return;
            if (kind === 'audio') { setImportNotice(NO_IMPORT_NOTES); setSuccessNotice(null); importController.current = new AbortController(); setImportStage('preparing'); }
            const snapshot = current.current!;
            const recording = audioId ? snapshot.data.interviews.find(session => session.id === id)?.recordings.find(item => item.id === audioId && item.storage !== 'none') : undefined;
            if (audioId && !recording) throw new Error(msg('ProjectWorkspace.m0937'));
            const linked = materials.map(item => ({ ...item, audioId: audioId ?? '' }));
            if (recording) linked.unshift({ id: recording.id, existingRecordingId: recording.id, name: recording.name, kind: 'audio', group: id, audioId: '', handle: {} as FileSystemFileHandle });
            const imported = kind === 'audio'
              ? await importProjectMaterials(snapshot, linked, storage, id, undefined, setImportStage, importController.current!.signal)
              : await importProjectMaterials(snapshot, linked, storage, id);
            importController.current = null;
            await publish(imported);
            if (kind === 'audio') setSuccessNotice(msg('projectImport.audioDone'));
            setImportNotice(materials.flatMap(item => { const keys = manuscriptImportNoticeKeys(item); return keys.length ? [{ name: item.name, keys }] : []; }));
          }}
          add={id => { clearPageFeedback(); setMaterialTarget(id ?? null); }} open={(recording, modelId, editId) => { void openRecording(recording, interviewId ?? project.data.interviews[0]?.id, modelId, editId); }} run={run}
          legacy={recording => { void run(() => checkManuscripts(interviewId ?? project.data.interviews[0].id, [recording])); }}
          remove={(recording,model,hasDocuments=false)=>{setError('');setDeleteTarget({recording,modelId:model?.id,name:model?.label||model?.sourceName||model?.engine||recording.name,hasDocuments,sessionId:interviewId??project.data.interviews[0].id});}}
          detach={async (recording, modelId) => { assertRecordingMutable(interviewId!,recording.id); const snapshot=current.current!; await publish(await reassignManuscript(snapshot, interviewId ?? snapshot.data.interviews[0].id, recording.id, '', modelId)); }}
          associate={(recording,model,anchor) => { setError('');setInterviewId(interviewId ?? project.data.interviews[0].id); setAssociation({ source: recording.id, modelId:model.id, name:model.label||model.sourceName||model.engine,anchor }); }}
          relink={recording => { void run(async () => { const [handle] = await (window as unknown as Picker).showOpenFilePicker({ ...await pickerLocation('open-audio', 'read'), multiple: false }); if (handle) { assertRecordingMutable(interviewId!,recording.id); await publish(await relinkMedia(project, interviewId ?? project.data.interviews[0].id, recording, handle)); setMediaRevision(value => value + 1); } }); }}>
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
          </ProjectBoard>
            {interview && association && <AssociateAudioDialog anchor={association.anchor} name={association.name} recordings={interview.recordings.filter(r=>r.storage!=='none')} busy={busy} error={error} onClose={()=>setAssociation(null)} onConfirm={target=>void run(async()=>{assertRecordingMutable(interview.id,association.source);assertRecordingMutable(interview.id,target);await publish(await reassignManuscript(current.current!,interview.id,association.source,target,association.modelId));setAssociation(null);},false)}/>}


        </>}
      </>}
    </section>
    {project && archiving && <ProjectExportDialog project={project} returnFocusRef={exportButton} onClose={() => setArchiving(false)} />}
  </main>;
}
