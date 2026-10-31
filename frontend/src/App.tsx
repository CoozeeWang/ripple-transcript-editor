import { tagErrorMessage } from './lib/tagErrors';
import { nativeDesktopAvailable } from './lib/desktopFs';
import { hasNativeSegmentDrag, startNativeSegmentDrag } from './lib/segmentDragBridge';
import { useTranscriptEdgeAlignment } from './hooks/useTranscriptEdgeAlignment';
import { populateSegmentDrag } from './lib/segmentDragPayload';
import { ensureVersionLinkIdentity } from './localStore';
import type { SegmentLinkReceiver } from './lib/segmentLinkDelivery';
import { segmentSourceTitle } from './lib/segmentSourceTitle';
import { segmentTransfer, type SegmentTarget } from './lib/segmentTransfer';
import { LoadErrorNotice, SaveToastNotice } from './components/EditorFeedback';
import { visibleAIActivities } from './lib/aiEditOwnership';
import { SUCCESS_FEEDBACK_MS, useTransientState } from './hooks/useTransientState';
import { flushSync } from "react-dom";
import { applyAIMarks } from "./lib/aiMarks";
import { useAIConnector } from "./hooks/useAIConnector";
import { applyAISuggestions } from "./lib/aiVersionEdits";
import { applyContinuationBatch,checkContinuationGuard } from './lib/continuationBatch';
import { AIEditingNotice } from './components/AIEditingNotice';
import { assertEditorReadyForAI } from './lib/editorDrafts';
import {ContinuationProgress} from './components/ContinuationProgress';
import { connectorReferences, connectorVersions } from "./lib/connectorVersions";
import {useProjectTags} from './hooks/useProjectTags';
import {TagsPanel} from './components/TagsPanel';
import {hierarchyLibrary,hierarchyTagFilter,emptyTagLibrary,filteredTagSegments,matchesTagFilter,tagHistoryAnchor,descendantTagIds,type TagLibrary} from './lib/tags';
import { createTagPresenter, tagSegmentCounts,tagCoverageCounts } from './lib/tagPresentation';
import { TagCandidatesContext, TagWritingContext } from './lib/tagCandidates';
import { TagMergeDialog } from './components/TagMergeDialog';
import type { OpenProject } from './lib/projectStore';
import { msg, uiMessage, useInterfaceLanguage } from './i18n';
import { recordProblem, type Problem } from "./lib/diagnostics";
import { VersionPicker } from "./components/VersionPicker";
import { useStableCallbacks } from "./hooks/useStableCallbacks";
import { applyComparisonDecision, comparisonReviewKey, reconcileComparisonReviews } from "./lib/comparisonReview";
import { useVersionComparison } from "./hooks/useVersionComparison";
import { comparisonRows } from "./lib/comparisonSegments";
import { useOpeningPosition } from "./hooks/useOpeningPosition";
import { useReadingPosition } from './hooks/useReadingPosition';
import { registerNormalClose } from './lib/normalClose';
import { useSpeakerFilterReadingPosition } from './hooks/useSpeakerFilterReadingPosition';
import { SegmentMergeDialog } from './components/SegmentMergeDialog';
import { SegmentJump } from './components/SegmentJump';
import { openingSegmentId } from "./lib/editPosition";
import type { ParagraphEditorElement } from "./lib/paragraphEditor";
import { flushEditorDrafts, hasEditorDrafts, hasPendingInputs, isEditorComposing, registerPendingInput } from "./lib/editorDrafts";
import {
  useLayoutEffect,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { TranscriptionDialog } from "./TranscriptionDialog";
import { TranscribeAudioButton } from './components/TranscribeAudioButton';
import type {
  Highlight,
  InterviewMetadata,
  Speaker,
  Segment,
  Transcript,
  TranscriptManifest,
} from "./types";
import { useTranscriptHistory } from "./useTranscriptHistory";
import {TagStorageUpgrade} from "./components/TagStorageUpgrade";
import { useDismissable } from "./useDismissable";
import { useFindReplace } from "./hooks/useFindReplace";
import { useShortcuts } from "./hooks/useShortcuts";
import { useProviders } from "./hooks/useProviders";
import { useFolder } from "./hooks/useFolder";
import { useVersions, type ProcessStatus } from "./hooks/useVersions";
import { useTranscription } from "./hooks/useTranscription";
import { useImport } from "./hooks/useImport";
import { usePersistence } from "./hooks/usePersistence";
import { useEditor } from "./hooks/useEditor";
import { usePlayback } from "./hooks/usePlayback";
import {
  readConnectorRules, writeConnectorRules, readContinuationTasks, writeContinuationTask,
  AUDIO_EXT_LABEL,
  defaultEditLabel,
  defaultMetadata,
  readAudioUrl,
  renameAudio,
  readModelOriginal,
  readManifest,
  sanitizeForFilename,
  stemOf,
  saveSelectedProviderId,
} from "./localStore";
import { canExportSubtitles, selectExportScope, type ExportFormat, exportTranscript } from "./lib/export";
import {
  ANNOTATION_PANEL_COLLAPSED_KEY,
  SPEAKER_PANEL_COLLAPSED_KEY,
  loadBooleanPreference,
  saveBooleanPreference,
  saveInterviewId,
} from "./lib/preferences";
import { formatTime, keys } from "./lib/format";
import { timeForCharacter } from "./lib/transcriptOps";
import { collectHighlightGroups, countHighlights } from "./lib/highlights";
import { TranscriptHeader } from "./components/TranscriptHeader";
import { SegmentItem } from "./components/SegmentItem";
import { AnnotationPanel, type PanelTab } from "./components/AnnotationPanel";
import { FindBar } from "./components/FindBar";
import { ProcessNotice } from "./components/ProcessNotice";
import { PlayerBar } from "./components/PlayerBar";
import { Topbar } from "./components/Topbar";
import { SpeakerPanel } from "./components/SpeakerPanel";
import { SettingsModal } from "./components/SettingsModal";
import { DeleteDialog, MatchDialog, MergeDialog, NamingModal } from "./components/Dialogs";
import { LoadingScreen } from "./components/LoadingScreen";

type SaveStatus = "loading" | "unsaved" | "saving" | "saved" | "error";

// 快退/快进步长默认值（秒），可被偏好设置覆盖；键盘左右键与右侧 ± 按钮共用。

export interface ProjectEditorProps {
  onUpgradeTagStorage?:()=>Promise<void>;
  tagLibrary?:TagLibrary;
  tagStorage?:import('./hooks/useProjectTags').TagStorage;
  initialSegmentTarget?: SegmentTarget;
  onOpenSegmentLink?: (raw:string) => Promise<void>;
  registerSegmentLinkReceiver?: (receiver:SegmentLinkReceiver | null) => void;
  connectorProject?: () => OpenProject | null;
  publishTagProject?: (project:OpenProject, publishVersion?:()=>void) => Promise<void>;
  projectInterviewId?: string;
  projectRecordingId?: string;
  projectDirectory?: FileSystemDirectoryHandle;
  initialOriginalModelId?: string;
  projectLabel?: string;
  interviewTitle?: string;
  interviewMetadata?: InterviewMetadata;
  recordingDraft?: { metadata: InterviewMetadata; speakers: Speaker[] };
  saveRecordingDraft?: (draft: { metadata: InterviewMetadata; speakers: Speaker[] }) => Promise<void>;
  onPatchInterview?: (patch: Partial<InterviewMetadata>) => Promise<void>;
  recordingLabel?: string;
  onAudioDuration?: (seconds: number) => Promise<void>;
  onRenameInterview?: (title: string) => Promise<void>;
  onReturnToProjects?: () => void;
  onOpenProject?: (recentId?: string) => Promise<void>;
  onExportProjectFiles?: () => void;
  openSettingsInitially?: boolean;
}
function App(projectProps: ProjectEditorProps = {}) {
  useInterfaceLanguage();
  const initialVersionApplied = useRef(false);
  // 平台检测——tooltip 与按钮文案里显示对应的快捷键（避免 Mac 用户看到 Ctrl+O）
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
  const folderShortcutHint = isMac ? "⌘O" : "Ctrl + O";
  const { transcript, reset: resetHistory, commit, undo, redo, canUndo, canRedo, undoTarget, redoTarget, undoActionKey, redoActionKey } =
    useTranscriptHistory<Transcript>();
  const [metadata, setMetadataState] = useState<InterviewMetadata | null>(null);
  const [persistedContent, setPersistedContent] = useState<{ transcript: Transcript; metadata: InterviewMetadata } | null>(null);
  const resetDocumentViewRef = useRef<() => void>(() => {});
  // 所有成功载入/替换文稿的路径共用这个入口；普通编辑和撤销不重置视图。
  const reset = useCallback((value: Transcript, savedMetadata?: InterviewMetadata | null) => {
    const loadedMetadata = savedMetadata && projectProps.recordingLabel
      ? { ...savedMetadata, title: projectProps.recordingLabel } : savedMetadata;
    if (loadedMetadata) setMetadataState(loadedMetadata);
    setPersistedContent(loadedMetadata ? { transcript: value, metadata: loadedMetadata } : null);
    resetDocumentViewRef.current();
    resetHistory(value);
  }, [resetHistory, projectProps.recordingLabel]);
  const {
    providers,
    selectedProviderId,
    setSelectedProviderId,
    defaultProviderId,
    activeProviderName,
    setActiveProviderName,
  } = useProviders();
  // 导入时自动修补过的项目（缺说话人名单、缺段落编号等），在命名弹窗里告知用户。
  const [importRepairs, setImportRepairs] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [activeSegmentId, setActiveSegmentId] = useState("");
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [openingPosition, setOpeningPosition] = useState<{ id: string } | null>(null);
  const [hiddenSpeakerIds, setHiddenSpeakerIds] = useState<Set<string>>(() => new Set());
  // 说话人侧栏是否收起（可给编辑区腾出横向空间）。
  const [speakerPanelCollapsed, setSpeakerPanelCollapsed] = useState<boolean>(() =>
    loadBooleanPreference(SPEAKER_PANEL_COLLAPSED_KEY, false),
  );
  useEffect(() => {
    saveBooleanPreference(SPEAKER_PANEL_COLLAPSED_KEY, speakerPanelCollapsed);
  }, [speakerPanelCollapsed]);
  // 批注侧栏是否收起（右侧，与说话人栏各自独立持久化）。
  const [annotationPanelCollapsed, setAnnotationPanelCollapsed] = useState<boolean>(() =>
    loadBooleanPreference(ANNOTATION_PANEL_COLLAPSED_KEY, false),
  );
  useEffect(() => {
    saveBooleanPreference(ANNOTATION_PANEL_COLLAPSED_KEY, annotationPanelCollapsed);
  }, [annotationPanelCollapsed]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportScope,setExportScope]=useState<'full'|'visible'>('full');
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(projectProps.openSettingsInitially));
  // 设置弹窗不持久化：每次打开都回到「通用」，因为改播放速度这类
  // 高频操作都在这一页，而「引擎与密钥」是低频的、体积又大的一页。
  const [settingsTab, setSettingsTab] = useState<"prefs" | "engines" | "ai" | "diagnostics">("prefs");
  const { openSettingsInitially, onReturnToProjects } = projectProps;
  useEffect(() => {
    if (openSettingsInitially && !settingsOpen) onReturnToProjects?.();
  }, [settingsOpen, openSettingsInitially, onReturnToProjects]);
  const openSettings = () => {
    setSettingsTab("prefs");
    setSettingsOpen(true);
  };
  useDismissable(recentMenuRef, recentMenuOpen, () => setRecentMenuOpen(false));
  const setMetadata = useCallback((value: React.SetStateAction<InterviewMetadata | null>) => {
    setMetadataState(current => {
      const next = typeof value === 'function' ? value(current) : value;
      return next && typeof value !== 'function' && projectProps.recordingLabel ? {...next, title: projectProps.recordingLabel} : next;
    });
  }, [projectProps.recordingLabel]);
const [hasLoadedTranscript, setHasLoadedTranscript] = useState(false);
// 当前是否在查看引擎原始稿（只读模式，所有编辑控件禁用）。
const [viewingOriginal, setViewingOriginal] = useState(false);
  const [processStatus, updateProcessStatus] = useState<ProcessStatus>("idle");
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // 各浮层内容 ref（供 useDismissable 判定「点击外部」用）
  const settingsRef = useRef<HTMLDialogElement>(null);

  // 统一浮层关闭契约：Esc + 浮层外部 pointerdown。
  useDismissable(openMenuRef, openMenuOpen, () => setOpenMenuOpen(false));
  useDismissable(exportMenuRef, exportMenuOpen, () => setExportMenuOpen(false));
  const [processMessage, setProcessMessage] = useTransientState('', '', () => processStatus === 'done' ? SUCCESS_FEEDBACK_MS : null);
  const setProcessStatus = useCallback((status: ProcessStatus) => {
    setProcessMessage('');
    updateProcessStatus(status);
  }, [setProcessMessage]);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [annotationView, setAnnotationView] = useState<"selected" | "all">("selected");
  // 批注栏页签：批注 / 高亮。高亮页是全文清单，没有「当前片段 / 全部」这层切换。
  const [panelTab, setPanelTab] = useState<PanelTab>("annotation");
  const textareaRefs = useRef(new Map<string, ParagraphEditorElement>());
  const editingRef = useRef(false);
  const initialLoadRef = useRef(true);
  const annotationListRef = useRef<HTMLDivElement>(null);
  const effectiveSelectedSegmentId = transcript?.segments.some(
    (segment) => segment.id === selectedSegmentId,
  )
    ? selectedSegmentId
    : (transcript?.segments[0]?.id ?? "");
  // 仅视图筛选：隐藏说话人的片段不渲染、不计入、批注也不显示（不动存档）。
  const preparedTagLibrary=useMemo(()=>{
    const source=projectProps.tagLibrary??emptyTagLibrary();
    try {return {library:source.schemaVersion===1&&source.tags.some(tag=>tag.name.includes('/'))?hierarchyLibrary(source):source,error:''};}
    catch(error){return {library:source,error:tagErrorMessage(error)}}
  },[projectProps.tagLibrary]);
  const [selectedTagFilters,setTagFilters]=useState<string[]>([]);
  const [tagFilterEnabled,setTagFilterEnabled]=useState(true);
  const [tagFilterMode,setTagFilterMode]=useState<'and'|'or'>('and');
  const selectedTagIds=useMemo(()=>selectedTagFilters.filter(id=>preparedTagLibrary.library.tags.some(tag=>tag.id===id)),[selectedTagFilters,preparedTagLibrary.library]);
  useEffect(()=>{let current=true;const valid=new Set(preparedTagLibrary.library.tags.map(tag=>tag.id));queueMicrotask(()=>{if(current)setTagFilters(selected=>{const ids=selected.filter(id=>valid.has(id));return ids.length===selected.length?selected:ids})});return()=>{current=false}},[preparedTagLibrary.library]);
  const tagFilter=useMemo(()=>tagFilterEnabled&&selectedTagIds.length?hierarchyTagFilter(preparedTagLibrary.library,selectedTagIds,tagFilterMode):null,[selectedTagIds,tagFilterEnabled,tagFilterMode,preparedTagLibrary.library]);
  const visibleSegments = useMemo(
    () => (transcript ? filteredTagSegments(transcript,hiddenSpeakerIds,tagFilter) : []),
    [transcript, hiddenSpeakerIds,tagFilter],
  );
  const visibleSegmentIds=useMemo(()=>new Set(visibleSegments.map(segment=>segment.id)),[visibleSegments]);
  // 高亮清单：按文档顺序分组；隐藏说话人的片段不计入，与批注「全部」视图保持一致。
  const highlightGroups = useMemo(
    () => collectHighlightGroups(transcript, hiddenSpeakerIds),
    [transcript, hiddenSpeakerIds],
  );
  const highlightCount = useMemo(() => countHighlights(transcript), [transcript]);

  const [renaming, setRenaming] = useState(false);
  const renamingRef = useRef(false);
  const canChangeDocumentRef = useRef<() => boolean>(() => true);
  const tagLibrarySaving = useRef(false);
  useEffect(()=>registerPendingInput(()=>tagLibrarySaving.current),[]);
  const openingProjectRef = useRef(false);
  const beforeChangeRef = useRef<() => Promise<void>>(async () => {});
  const latestExport = useRef({ transcript, metadata });
  useLayoutEffect(() => { latestExport.current = { transcript, metadata }; }, [transcript, metadata]);

  // 桥接 useVersions 的 applyManifest：onLoaded 在 useVersions 之前被引用，
  // 故用 ref 延迟绑定（渲染结束时才指向真实实现）。
  const applyManifestRef = useRef<
    (manifest: TranscriptManifest | null, modelId?: string | null) => void
  >(() => {});

  // 编辑的提交入口：undo/redo 历史分组 + 标记未保存。usePlayback 依赖它，
  // 故放在 useFolder 之前定义。
  const tagContentEditPending=useRef(false);
  const editLockedRef = useRef<() => boolean>(() => false);
  const mutateTranscript = useCallback(
    (updater: (current: Transcript) => Transcript, groupKey?: string) => {
      const aiWrite = groupKey?.startsWith('ai-marks:') || groupKey?.startsWith('ai-continuation:');
      if (viewingOriginal || !aiWrite && editLockedRef.current()) return;
      tagContentEditPending.current=true;
      commit(current => !aiWrite && editLockedRef.current() ? current : reconcileComparisonReviews(updater(current)), groupKey);
      setSaveStatus("unsaved");
    },
    [commit, viewingOriginal],
  );

  const {
    audioRef,
    audioUrl,
    setAudioUrl,
    audioFilename,
    setAudioFilename,
    currentTime,
    setCurrentTime,
    actualDuration,
    setActualDuration,
    isPlaying,
    setIsPlaying,
    playbackRate,
    setPlaybackRate,
    skipSeconds,
    setSkipSeconds,
    defaultPlaybackRate,
    setDefaultPlaybackRate,
    followingPaused,
    transcriptPanelRef,
    seekTo,
    togglePlayback,
    togglePlayFromCursor,
    recordEditorCursor,
    selectSegmentForNavigation,
    updateCurrentSegment,
    resumeFollow,
    handleAudioMetadata,
    handleAudioDurationChange,
    handleAudioError,
  } = usePlayback({
    transcript,
    mutateTranscript,
    activeSegmentId,
    setActiveSegmentId,
    setSelectedSegmentId,
    effectiveSelectedSegmentId,
    textareaRefs,
    setLoadError,
    onDurationConfirmed: seconds => {
      void projectProps.onAudioDuration?.(seconds).catch(() => setLoadError(msg('audioDuration.saveFailed')));
    },
  });

  useOpeningPosition(openingPosition, transcriptPanelRef, hasLoadedTranscript);
  useTranscriptEdgeAlignment(transcriptPanelRef, hasLoadedTranscript);

  // 片段强调、箭头和侧栏共用同一个当前片段。
  const currentSegmentId = effectiveSelectedSegmentId;
  const currentSegment = transcript?.segments.find(
    (segment) => segment.id === currentSegmentId,
  );

  const {
    dirHandle,
    dirHandleRef,
    recentFolders,
    audioFiles,
    legacyEntries,
    migratingLegacy,
    selectedAudio,
    setSelectedAudio,
    refreshAudioList,
    loadAudio,
    handleOpenFolder: openLegacyFolder,
    handleOpenRecentFolder: openLegacyRecentFolder,
    handleMigrateLegacy,
    applyFolderHandle,
  } = useFolder({
    allowMissingMedia: Boolean(projectProps.projectDirectory),
    canChangeDocument: () => canChangeDocumentRef.current(),
    beforeChange: () => beforeChangeRef.current(),
    onLoadStart: () => {
      setProcessMessage('');
      setOpeningPosition(null);
      setSaveStatus("loading");
      setLoadError("");
      initialLoadRef.current = true;
    },
    onLoaded: async ({ url, manifest, edited }, name) => {
      let openingOriginal = false;
      if (manifest && edited && !initialVersionApplied.current && projectProps.initialOriginalModelId && dirHandleRef.current) {
        const original = await readModelOriginal(dirHandleRef.current, name, projectProps.initialOriginalModelId);
        if (!original) throw new Error(msg('useVersions.m1196'));
        edited = { ...edited, transcript: original.transcript };
        openingOriginal = true;
        initialVersionApplied.current = true;
      }
      setAudioUrl(url);
      setAudioFilename(name);
      setCurrentTime(0);
      setActualDuration(0);
      if (!edited || !manifest) {
        setViewingOriginal(false);
        const initialMetadata = projectProps.recordingDraft?.metadata
          ?? projectProps.interviewMetadata
          ?? defaultMetadata(projectProps.interviewTitle ?? stemOf(name));
        const loadedMetadata = projectProps.recordingDraft || !projectProps.recordingLabel || manifest
          ? initialMetadata
          : { ...initialMetadata, title: projectProps.recordingLabel };
        setMetadata(loadedMetadata);
        reset({ audio: { filename: name, duration: 0 }, speakers: projectProps.recordingDraft?.speakers ?? [], segments: [] }, loadedMetadata);
        setHasLoadedTranscript(false);
        applyManifestRef.current(null);
        setProcessStatus("ready");
        setProcessMessage(msg('App.m0001'));
        setSaveStatus("saved");
        return;
      }
      applyManifestRef.current(manifest);
      setMetadata(edited.metadata);
      reset(edited.transcript, edited.metadata);
      const openingId = openingSegmentId(edited.transcript);
      setSelectedSegmentId(openingId);
      setOpeningPosition({ id: openingId });
      setHasLoadedTranscript(true);
      const loadedModel = manifest.models.find(m => m.id === manifest.activeModelId) ?? manifest.models[0];
      setViewingOriginal(openingOriginal || Boolean(loadedModel?.designatedOriginal) || (!loadedModel?.edits.length && Boolean(loadedModel?.original)));
      setProcessStatus("done");
      setProcessMessage(msg('App.m0002', { v0: edited.transcript.segments.length }));
      setSaveStatus("saved");
    },
    onLoadEnd: () => {
      initialLoadRef.current = false;
    },
    onLoadError: (message, fatal) => {
      recordProblem("open", new Error(message));
      setLoadError(message);
      if (fatal) setSaveStatus("error");
    },
    onClearError: () => setLoadError(""),
    onEmptyFolder: () => {
      setAudioUrl("");
      setAudioFilename("");
      setViewingOriginal(false);
      applyManifestRef.current(null);
      reset({ audio: { filename: "", duration: 0 }, speakers: [], segments: [] });
      setMetadata(null);
      setHasLoadedTranscript(false);
      setProcessStatus("idle");
      setProcessMessage("");
      // 选中了不含音频文件的文件夹：给出明确反馈，而不是静默清空让落地页「没反应」。
      setLoadError(
        msg('App.m0003', { v0: AUDIO_EXT_LABEL }),
      );
    },
    onMigrated: (migrated, skipped) => {
      if (migrated && !skipped) {
        setProcessStatus("done");
        setProcessMessage(msg('App.m0004', { v0: migrated }));
      } else if (migrated && skipped) {
        window.alert(msg('App.m0005', { v0: migrated, v1: skipped }));
      } else {
        window.alert(msg('App.m0006'));
      }
    },
  });

  const handleOpenFolder = () => projectProps.projectDirectory
    ? setLoadError(msg('App.m0007')) : void openLegacyFolder();
  const handleOpenRecentFolder = (handle: FileSystemDirectoryHandle) => projectProps.projectDirectory
    ? setLoadError(msg('App.m0008')) : void openLegacyRecentFolder(handle);
  const projectOpened = useRef(false);
  useEffect(() => {
    if (!projectProps.projectDirectory || projectOpened.current) return;
    projectOpened.current = true;
    void applyFolderHandle(projectProps.projectDirectory).catch(error => setLoadError(error instanceof Error ? error.message : msg('App.m0009')));
  }, [projectProps.projectDirectory, applyFolderHandle]);

  const {
    models,
    activeModelId,
    activeModel,
    activeEditKey,
    versionBusy,
    namingOpen,
    setNamingOpen,
    namingValue,
    setNamingValue,
    setNamingTarget,
    namingError,
    setNamingError,
    namingBusy,
    namingRef,
    deletePrompt,
    setDeletePrompt,
    deleteRef,
    applyManifest,
    selectEdit,
    openOriginal,
    forkFromOriginal,
    duplicateEdit,
    createAIEdit,
    confirmNaming,
    renameVersion,
    confirmDelete,
  } = useVersions({
    beforeChange: () => beforeChangeRef.current(),
    dirHandleRef,
    selectedAudio,
    transcript,
    metadata,
    reset,
    setMetadata,
    setSelectedSegmentId,
    setHasLoadedTranscript,
    setViewingOriginal,
    viewingOriginal,
    setImportRepairs,
    setProcessStatus,
    setProcessMessage,
  });
  const comparison = useVersionComparison(dirHandle, selectedAudio ?? "", models, activeModelId, activeModel?.activeEditId, viewingOriginal, transcriptPanelRef);
  const readingProjectId = projectProps.connectorProject?.()?.data.id;
  const readingVersion = viewingOriginal || activeModel?.designatedOriginal ? 'original' : activeModel?.activeEditId;
  const readingScope = useMemo(() => dirHandle && selectedAudio && activeModelId && readingVersion ? {
    directory: dirHandle, audio: selectedAudio, model: activeModelId,
    version: readingVersion,
    project: readingProjectId, recording: projectProps.projectRecordingId,
  } : null, [dirHandle, selectedAudio, activeModelId, readingVersion, readingProjectId, projectProps.projectRecordingId]);
  const persistReadingPosition = useReadingPosition(readingScope, transcriptPanelRef, hasLoadedTranscript && saveStatus !== 'loading', transcript?.segments ?? [], !!projectProps.initialSegmentTarget);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.code === "KeyY" && !event.isComposing && !event.repeat &&
          !document.querySelector("dialog[open]") && !versionBusy && comparison.options.length) {
        event.preventDefault(); comparison.toggle();
      }
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [comparison, versionBusy]);

  useLayoutEffect(() => { applyManifestRef.current = applyManifest; }, [applyManifest]);

  // 转录目标所属的上下文：哪一个文件、哪一份版本、是不是原稿。任务绑在它上面。
  const transcribeContextKey = `${activeEditKey}:${viewingOriginal}`;

  const {
    transcriptionDialogOpen,
    setTranscriptionDialogOpen,
    transcribeJob,
    transcribePhase,
    transcribeRatio,
    transcribeElapsed,
    transcribeHint,
    transcribeRaw,
    startTranscription,
    cancelTranscription,
  } = useTranscription({
    initialMetadata: projectProps.projectDirectory ? metadata ?? undefined : undefined,
    initialSpeakers: !hasLoadedTranscript ? transcript?.speakers : undefined,
    beforeChange: () => beforeChangeRef.current(),
    contextKey: transcribeContextKey,
    setViewingOriginal,
    dirHandleRef,
    selectedAudio,
    confirmedAudioDuration: { audio: audioFilename, seconds: actualDuration },
    providers,
    setActiveProviderName,
    processStatus,
    setProcessStatus,
    setProcessMessage,
    setMetadata,
    reset,
    setSelectedSegmentId,
    setHasLoadedTranscript,
    setSaveStatus,
    applyManifest,
    setNamingTarget,
    setNamingOpen,
    setNamingValue,
    refreshAudioList,
  });

  // Keep the job tied to its source even if another internal operation changes context.
  // User navigation is blocked while the job is alive, including upload and result saving.
  useLayoutEffect(() => {
    canChangeDocumentRef.current = () => {
      if (tagLibrarySaving.current) return false;
      if (!transcribeJob) return true;
      window.alert(msg('App.m0010', { v0: transcribeJob.audio }));
      return false;
    };
  }, [transcribeJob]);
  const transcribing = transcribeJob !== null;
  const transcribeIsCurrent = transcribing &&
    transcribeJob.audio === selectedAudio &&
    transcribeJob.contextKey === transcribeContextKey;
  const activeStatus: ProcessStatus = transcribing ? "transcribing" : processStatus;

  const {
    matchPrompt,
    setMatchPrompt,
    matchRef,
    importInputRef,
    finishImport,
    confirmMatch,
    handleTranscriptFile,
  } = useImport({
    dirHandleRef,
    audioFiles,
    selectedAudio,
    loadAudio,
    refreshAudioList,
    setLoadError,
    setImportRepairs,
    setNamingTarget,
    setNamingOpen,
    setNamingValue,
  });

  const {
    saveToast,
    setSaveToast,
    handleSave,
    flushPendingSave,
  } = usePersistence({
    persistedContent,
    dirHandleRef,
    initialLoadRef,
    hasLoadedTranscript,
    viewingOriginal,
    selectedAudio,
    transcript,
    metadata,
    activeModelId,
    models,
    saveStatus,
    setSaveStatus,
    setShuttingDown,
    saveAudioDraft: projectProps.saveRecordingDraft,
  });


  useLayoutEffect(() => { beforeChangeRef.current = async () => { if (tagLibrarySaving.current) throw Error(msg('ProjectWorkspace.openProjectBusy')); await flushPendingSave(); await persistReadingPosition(); }; }, [flushPendingSave, persistReadingPosition]);
  useLayoutEffect(() => registerNormalClose(async () => {
    try {
      if (tagLibrarySaving.current) throw Error(msg('ProjectWorkspace.openProjectBusy'));
      await flushPendingSave(); await persistReadingPosition();
    } catch (error) { setLoadError(error instanceof Error ? error.message : msg('tags.saveFailed')); throw error; }
  }), [flushPendingSave, persistReadingPosition]);

  const aiContext = `${selectedAudio}:${activeEditKey}:${viewingOriginal}`;
  const [aiIdentity, setAIIdentity] = useState('0');
  const connectorContext = useRef({ dir: dirHandle, audio:selectedAudio, context: aiContext, generation: 0 });
  useLayoutEffect(() => {
    if (connectorContext.current.dir !== dirHandle || connectorContext.current.context !== aiContext) {
      connectorContext.current = { dir: dirHandle, audio:selectedAudio, context: aiContext, generation: connectorContext.current.generation + 1 };
      setAIIdentity(String(connectorContext.current.generation));
    }
  }, [dirHandle, aiContext,selectedAudio]);
  const connector = useAIConnector({
    acceptTagTransaction: receipt => tags.acceptTransaction(receipt),
    current: async () => {
      const identity = connectorContext.current.generation;
      const dir = dirHandle, audio = selectedAudio, model = activeModel;
      if (!dir || !audio || !model || !hasLoadedTranscript || versionBusy || transcribing) throw new Error('no_editable_interview');
      assertEditorReadyForAI();
      await flushPendingSave();
      if (connectorContext.current.generation !== identity || dirHandleRef.current !== dir || !latestExport.current.transcript) throw new Error('interview_changed');
      const rules = await readConnectorRules(dir, audio);
      if (connectorContext.current.generation !== identity) throw new Error('interview_changed');
      const manifest = await readManifest(dir, audio);
      if (connectorContext.current.generation !== identity) throw new Error('interview_changed');
      const versionId = `${model.id}:${viewingOriginal || model.designatedOriginal ? 'original' : model.activeEditId}`;
      const version = connectorVersions(manifest?.models ?? []).find(v => v.id === versionId);
      if (!version) throw new Error('current_version_unavailable');
      return { identity: String(identity), editable: !viewingOriginal, transcript: latestExport.current.transcript, rules,
        continuations: {scope:String(identity),read:async reportUnreadable=>readContinuationTasks(dir,audio,reportUnreadable),write:async task=>{
          if(dirHandleRef.current!==dir || connectorContext.current.audio!==audio)throw Error('interview_changed');
          await writeContinuationTask(dir,audio,task);
        }},
        remember: async confirmedRules => writeConnectorRules(dir, audio, confirmedRules),
        title: latestExport.current.metadata?.title ?? '',
        label: version.name, version,
        names: models.flatMap(m => m.edits.map((e, i) => e.label ?? defaultEditLabel(i))),
        references: async () => connectorReferences(dir, audio, (await readManifest(dir, audio))?.models ?? []) };
    },
    applyMarks: async (baseline, marks, taskId) => {
      if (viewingOriginal || versionBusy || !activeModel?.activeEditId || JSON.stringify(latestExport.current.transcript) !== JSON.stringify(baseline)) throw new Error('source_changed_read_current_again');
      const versionId = activeModel.activeEditId;
      const version = activeModel.edits.find(edit => edit.id === versionId)?.label ?? 'v1';
      const result = applyAIMarks(baseline, marks, taskId);
      if (result.transcript !== baseline) {
        let applied = false;
        flushSync(() => {
          mutateTranscript(current => {
            if (JSON.stringify(current) !== JSON.stringify(baseline)) return current;
            applied = true; return result.transcript;
          }, `ai-marks:${taskId}`);
          setAnnotationPanelCollapsed(false);
          setAnnotationView('all');
          setPanelTab(result.added_annotations ? 'annotation' : 'highlight');
        });
        if (!applied) throw new Error('source_changed_read_current_again');
        try { await flushPendingSave(); }
        catch { throw new Error('mark_save_failed_changes_retained_in_ripple'); }
      }
      return { saved: true, version, version_id: versionId, added_annotations: result.added_annotations, added_highlights: result.added_highlights };
    },
    publish: async (baseline, suggestions, name, target) => {
      const sourceModel = activeModelId, sourceEdit = viewingOriginal || activeModel?.designatedOriginal ? 'original' : activeModel?.activeEditId;
      if (!sourceModel || !sourceEdit) throw new Error('interview_changed');
      if (String(connectorContext.current.generation) !== target.identity || target.source_version.model_id !== sourceModel ||
        target.source_version.edit_id !== sourceEdit) throw new Error('source_changed_read_current_again');
      if (target.save_mode === 'current_version') {
        if (viewingOriginal || activeModel?.designatedOriginal || target.source_version.kind === 'original') throw new Error('current_version_read_only_create_new_version');
        if (versionBusy || !target.checkpoint && JSON.stringify(latestExport.current.transcript) !== JSON.stringify(baseline)) throw new Error('source_changed_read_current_again');
        const checkpoint=target.checkpoint ? {...target.checkpoint,receipt:{...target.checkpoint.receipt,version_id:target.source_version.id}} : undefined;
        const atomicTranscript=checkpoint?null:applyAISuggestions(baseline,baseline,suggestions);
        if(checkpoint&&(!latestExport.current.transcript||!checkContinuationGuard(latestExport.current.transcript,checkpoint.guard)))throw Error('batch_conflict_manual_changes_preserved');
        let applied = false;
        flushSync(() => {
          mutateTranscript(current => {
            if(checkpoint&&!checkContinuationGuard(current,checkpoint.guard))return current;
            if (!checkpoint && JSON.stringify(current) !== JSON.stringify(baseline)) return current;
            const next=checkpoint ? applyContinuationBatch(current,suggestions,checkpoint) : atomicTranscript!;
            applied = true; return next;
          }, `ai-continuation:${checkpoint?.receipt.batch_id??target.task_id}`);
          if(atomicTranscript)setSelectedSegmentId(atomicTranscript.lastEditedSegmentId??atomicTranscript.segments[0]?.id??'');
        });
        if (!applied) throw new Error('source_changed_read_current_again');
        try { await flushPendingSave(); }
        catch { throw new Error('current_version_save_failed_changes_retained_in_ripple'); }
        if (String(connectorContext.current.generation) === target.identity) {
          setProcessStatus('done'); setProcessMessage(msg('useVersions.aiCurrentSaved'));
        }
        return { version: target.source_version.name, version_id: sourceEdit, result_version: target.source_version,
          comparison_requested: false, undo_available: true };
      }
      const result = await createAIEdit(baseline, suggestions, name, target.checkpoint);
      if (!result) throw new Error('save_result_unavailable_check_versions');
      comparison.activate(result.model.id, result.edit.id, `${sourceModel}:${sourceEdit}`);
      return { version: result.edit.label, version_id: result.edit.id,
        result_version: {id:`${result.model.id}:${result.edit.id}`,model_id:result.model.id,edit_id:result.edit.id,name:result.edit.label,kind:'edit'}, comparison_requested: true };
    },
  }, hasLoadedTranscript ? `${aiContext}:${hasLoadedTranscript}:${versionBusy}` : '', projectProps.connectorProject ? {
    project: projectProps.connectorProject,
    publishTagProject: projectProps.publishTagProject,
    onSaved: target => { setProcessStatus('done'); setProcessMessage(msg('connector.backgroundSaved', { recording: target.recording, version: target.version })); },
    active: () => ({ interview_id: projectProps.projectInterviewId ?? '', recording_id: projectProps.projectRecordingId ?? '',
      directory: dirHandleRef.current, version_id: activeModelId
        ? `${activeModelId}:${viewingOriginal || activeModel?.designatedOriginal ? 'original' : activeModel?.activeEditId}` : null }),
  } : undefined);

  const aiVersionId = activeModelId ? `${activeModelId}:${viewingOriginal || activeModel?.designatedOriginal ? 'original' : activeModel?.activeEditId}` : '';
  const aiLocked = connector.targetLocked(aiVersionId, projectProps.projectRecordingId, projectProps.projectInterviewId, projectProps.connectorProject?.()?.data.id, aiIdentity);
  useLayoutEffect(() => {
    editLockedRef.current = () => tagLibrarySaving.current || connector.targetLocked(aiVersionId, projectProps.projectRecordingId, projectProps.projectInterviewId, projectProps.connectorProject?.()?.data.id, String(connectorContext.current.generation));
  });
  const protectedReadOnly = viewingOriginal || aiLocked;
  const tagUpgradeRequired=!!projectProps.tagStorage?.requiresMigration;
  const tags=useProjectTags({library:preparedTagLibrary.library,storage:projectProps.tagStorage,recordingId:projectProps.projectRecordingId,modelId:activeModelId,editId:viewingOriginal?'original':activeModel?.activeEditId,context:`${selectedAudio}:${activeEditKey}:${viewingOriginal}`,transcript,flush:flushPendingSave,
    undoActionKey,redoActionKey,publish:(value,action,key)=>{
      // Tag undo/redo is already durable. Adopt the exact history snapshot, so autosave
      // cannot mistake a metadata-only restoration for a fresh whole-body text edit.
      const saved=action==='commit'||action==='checkpoint'?value:action==='undo'?undoTarget:redoTarget;
      if(action==='checkpoint')resetHistory(value);else if(action==='commit')commit(()=>value,key);else if(action==='undo')undo();else redo();
      if(metadata&&saved)setPersistedContent({transcript:saved,metadata});setSaveStatus('saved');
    },
    lock:busy=>{tagLibrarySaving.current=busy},readOnly:protectedReadOnly||tagUpgradeRequired,originalReadOnly:viewingOriginal,onError:setLoadError,errorMessage:msg('tags.saveFailed')});
  const presentTags = useMemo(() => createTagPresenter(), []);
  const segmentTagView = presentTags(tags.library, transcript?.segments ?? []);
  const tagCounts = useMemo(() => tagSegmentCounts({ schemaVersion: 3, tags: segmentTagView.available, groups: [] }, transcript?.segments ?? []), [segmentTagView.available, transcript?.segments]);
  const tagCoverage = useMemo(()=>tagCoverageCounts(tags.library,transcript?.segments??[]),[tags.library,transcript?.segments]);
  const currentTagCoverage=useCallback((id:string)=>tagCoverage.get(id)??0,[tagCoverage]);
  const currentTagCount = useCallback((id: string) => tagCounts.get(id) ?? 0, [tagCounts]);
  useLayoutEffect(() => { tagLibrarySaving.current = tags.busy; }, [tags.busy]);
  const dropTagToSegment = async (tagId:string,segmentId:string) => {
    if(protectedReadOnly || tagUpgradeRequired || tags.busy || !tags.library.tags.some(tag=>tag.id===tagId)) return;
    flushEditorDrafts();
    if(!latestExport.current.transcript?.segments.some(segment=>segment.id===segmentId && !segment.tagIds?.includes(tagId)))return;
    await tags.attach(segmentId,tagId);
  };
  const priorTagContentAnchor=useRef<string|null>(null);
  useLayoutEffect(()=>{const next=tagHistoryAnchor(transcript);if(tagContentEditPending.current&&priorTagContentAnchor.current!==next)queueMicrotask(tags.discardRedo);tagContentEditPending.current=false;priorTagContentAnchor.current=next},[transcript,tags.discardRedo]);
  const guardedRenameVersion: typeof renameVersion = (...args) => {
    if (editLockedRef.current()) return Promise.reject(Error('manuscript_locked_by_other_ai_end_editing_first'));
    return renameVersion(...args);
  };

  // 设置弹层：必须在「空状态提前 return」与「完整 UI return」两处都渲染，
  // 否则空状态下点击「偏好设置」会因提前 return 而永不显示。
  const settingsModal = settingsOpen ? (
    <SettingsModal
      connector={connector}
      settingsTab={settingsTab}
      setSettingsTab={setSettingsTab}
      settingsRef={settingsRef}
      setSettingsOpen={setSettingsOpen}
      defaultPlaybackRate={defaultPlaybackRate}
      setDefaultPlaybackRate={setDefaultPlaybackRate}
      setPlaybackRate={setPlaybackRate}
      audioRef={audioRef}
      skipSeconds={skipSeconds}
      setSkipSeconds={setSkipSeconds}
    />
  ) : null;




  const {
    findOpen,
    setFindOpen,
    findQuery,
    setFindQuery,
    replaceValue,
    setReplaceValue,
    showReplace,
    setShowReplace,
    currentMatchIndex,
    setCurrentMatchIndex,
    matchCount,
    findNext,
    findPrev,
    replaceCurrent,
    replaceAll,
  } = useFindReplace({
    transcript,
    viewingOriginal: protectedReadOnly,
    mutateTranscript,
    setSelectedSegmentId:id=>{const target=transcript?.segments.find(segment=>segment.id===id);if(tagFilter&&(!target||!matchesTagFilter(target,tagFilter)))setTagFilters([]);setSelectedSegmentId(id)},
    textareaRefs,
  });

  const speakerFilterContext = useMemo(() => ({ directory: dirHandle, version: aiContext }), [dirHandle, aiContext]);
  const captureSpeakerFilterPosition = useSpeakerFilterReadingPosition(transcriptPanelRef, hiddenSpeakerIds, speakerFilterContext);
  const {
    segmentMergePrompt, setSegmentMergePrompt, segmentMergeChanged, confirmSegmentMerge,
    updateSegment,
    toggleHideSpeaker,
    confirmMerge,
    addSpeaker,
    hasEnglishSpeakerTemplate,
    normalizeEnglishSpeakerTemplates,
    deleteSpeaker,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    removeHighlight,
    removeSegment,
    splitSegment,
    mergeWithNext,
    patchMetadata,
    handleEditorKeydown,
    mergePrompt,
    setMergePrompt,
    mergeDialogRef,
    mergeMenuFor,
    setMergeMenuFor,
    mergeMenuRef,
  } = useEditor({
    visibleSegmentIds,
    transcript,
    mutateTranscript,
    metadata,
    setMetadata,
    setSelectedSegmentId,
    setActiveSegmentId,
    setHiddenSpeakerIds,
    textareaRefs,
    editingRef,
    findOpen,
    showReplace,
    setShowReplace,
    replaceCurrent,
    findNext,
  });

  useLayoutEffect(() => {
    resetDocumentViewRef.current = () => {
      setSegmentMergePrompt(null);
      setHiddenSpeakerIds(new Set());
      setTagFilters([]);
      setActiveSegmentId("");
      setSelectedSegmentId("");
      setOpeningPosition(null);
      setAnnotationView("selected");
      setPanelTab("annotation");
      setFindOpen(false);
      setFindQuery("");
      setReplaceValue("");
      setShowReplace(false);
      setCurrentMatchIndex(-1);
      setMergePrompt(null);
      setMergeMenuFor(null);
      setExportMenuOpen(false);
      editingRef.current = false;
    };
  }, [setFindOpen, setFindQuery, setReplaceValue, setShowReplace, setCurrentMatchIndex,
    setMergePrompt, setMergeMenuFor, setSegmentMergePrompt]);

  const performUndo = useCallback(() => {
    if (editLockedRef.current()) return;
    const hadDraft = hasEditorDrafts();
    flushEditorDrafts();
    if(tags.busy)return;
    if(!hadDraft&&tags.canUndo){void tags.undo();return}
    if (!canUndo && !hadDraft) return;
    undo();
    setSaveStatus("unsaved");
  }, [canUndo, undo,tags]);

  const performRedo = useCallback(() => {
    if (editLockedRef.current()) return;
    flushEditorDrafts();
    if(tags.busy)return;
    if(tags.canRedo){void tags.redo();return}
    if (!canRedo) return;
    redo();
    setSaveStatus("unsaved");
  }, [canRedo, redo,tags]);


  const transferVersion = viewingOriginal || activeModel?.designatedOriginal ? 'original' : activeModel?.activeEditId;
  const transferContext = `${projectProps.projectRecordingId}:${activeModel?.id}:${transferVersion}`;
  const [transferIdentity,setTransferIdentity] = useState<{context:string;identity:string} | null>(null);
  useEffect(() => {
    const directory=dirHandleRef.current;
    if (!directory || !selectedAudio || !activeModel || !transferVersion || saveStatus === 'loading' || !projectProps.projectRecordingId) return;
    let cancelled=false;
    void ensureVersionLinkIdentity(directory,selectedAudio,activeModel.id,transferVersion,!aiLocked).then(identity=>{
      if (!cancelled) setTransferIdentity({context:transferContext,identity});
    }).catch(()=>{if(!cancelled)setLoadError(msg('segmentTransfer.identityFailed'));});
    return ()=>{cancelled=true;};
  },[aiLocked,dirHandleRef,selectedAudio,activeModel,transferVersion,transferContext,saveStatus,projectProps.projectRecordingId]);

  const transferSnapshot = (id: string) => {
    if (isEditorComposing()) throw Error(msg('segmentTransfer.failed'));
    flushEditorDrafts();
    const snapshot = latestExport.current;
    const segment = snapshot.transcript?.segments.find(item => item.id === id);
    if (!snapshot.transcript || !segment) throw Error(msg('segmentTransfer.missing'));
    const project = projectProps.connectorProject?.();
    if (project && transferIdentity?.context !== transferContext) throw Error(msg('segmentTransfer.identityFailed'));
    const target = project && projectProps.projectRecordingId && activeModel && transferIdentity ? {identity:transferIdentity.identity,project:project.data.id,recording:projectProps.projectRecordingId,model:activeModel.id,version:viewingOriginal || activeModel.designatedOriginal ? 'original' : activeModel.activeEditId,segment:id} : undefined;
    return segmentTransfer(snapshot.transcript, segment, segmentSourceTitle(snapshot.metadata?.title ?? '', activeModel ?? undefined, transferVersion), target);
  };
  const [transferFailure, setTransferFailure] = useState<{text:string;problem:Problem}|null>(null);
  const failTransfer = (text:string, error:unknown) => { setTransferFailure({text,problem:recordProblem("export",error)}); setLoadError(text); };
  const copyGeneration = useRef(0);
  useLayoutEffect(() => { copyGeneration.current++; }, [selectedAudio,activeEditKey,viewingOriginal]);
  const copySegment = async (id: string) => {
    const generation=++copyGeneration.current;
    try {
      const payload = transferSnapshot(id);
      const native = (window as unknown as {__TAURI__?:{core?:{invoke:<T>(name:string,args:unknown)=>Promise<T>}}}).__TAURI__?.core;
      if (native && /Mac/.test(navigator.platform)) await native.invoke('copy_segment', {payload});
      else if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([payload.plain], {type:'text/plain'}), 'text/html': new Blob([payload.html], {type:'text/html'}) })]);
      } else await navigator.clipboard.writeText(payload.plain);
      if (generation === copyGeneration.current) setSaveToast({kind:'ok',text:msg('segmentTransfer.copied')});
    } catch (error) { if (generation === copyGeneration.current) failTransfer(msg('segmentTransfer.failed'),error); }
  };
  const nativeDragSegment = async (id: string) => {
    const generation = copyGeneration.current;
    try { await startNativeSegmentDrag(transferSnapshot(id)); }
    catch (error) { if (generation === copyGeneration.current) failTransfer(msg('segmentTransfer.dragFailed'),error); }
  };
  const dragSegment = (id: string, transfer: DataTransfer) => {
    try { const payload = transferSnapshot(id); populateSegmentDrag(transfer, payload); }
    catch (error) { transfer.effectAllowed='none'; failTransfer(msg('segmentTransfer.dragFailed'),error); }
  };

  const [tagDropSegment,setTagDropSegment]=useState<string|null>(null);
  const tagEntries = useRef(new Map<string, () => void>());
  const registerTagEntry = useCallback((id: string, open: (() => void) | null) => { if (open) tagEntries.current.set(id,open); else tagEntries.current.delete(id); }, []);
  const openActiveTagEntry = useCallback((id: string) => { if (!protectedReadOnly && !tagUpgradeRequired && !tags.busy && projectProps.tagStorage) tagEntries.current.get(id)?.(); }, [protectedReadOnly,tagUpgradeRequired,tags.busy,projectProps.tagStorage]);
  useShortcuts({
    addTag: openActiveTagEntry, nativeTagShortcut: nativeDesktopAvailable(), tagWriteDisabled: protectedReadOnly || tagUpgradeRequired,
    visibleSegmentIds,
    copySegment,
    disabled: renaming || versionBusy || saveStatus === "loading",
    transcript,
    viewingOriginal,
    removeSegment,
    findOpen,
    effectiveSelectedSegmentId,
    audioUrl,
    skipSeconds,
    audioRef,
    performUndo,
    performRedo,
    setFindOpen,
    setShowReplace,
    setExportMenuOpen,
    togglePlayFromCursor,
    handleOpenFolder,
    togglePlayback,
    seekTo,
    mergeWithNext,
    setSelectedSegmentId,
  });







  const segmentActions = useStableCallbacks({
    setSelectedSegmentId, seekTo, recordEditorCursor, addSpeaker, updateSegment,
    removeSegment, splitSegment, mergeWithNext, handleEditorKeydown,
    copySegment, dragSegment, nativeDragSegment,
    onComparisonDecision: (decision: Parameters<typeof applyComparisonDecision>[1]) =>
      mutateTranscript(current => applyComparisonDecision(current, decision, comparison.baseline?.segments)),
  });
  const renderedRows = useMemo(() => comparisonRows(transcript?.segments ?? [], comparison.baseline?.segments)
    .filter(row => !hiddenSpeakerIds.has(row.segment.speaker_id)&&matchesTagFilter(row.segment,tagFilter)),
    [transcript?.segments, comparison.baseline?.segments, hiddenSpeakerIds,tagFilter]);
  const segmentIndices = useMemo(() => new Map(transcript?.segments.map((segment, index) => [segment.id, index])), [transcript?.segments]);
  const [pendingSegmentJump, setPendingSegmentJump] = useState<{ segment: Segment; context: typeof speakerFilterContext } | null>(null);
  const handledSegmentJump = useRef<typeof pendingSegmentJump>(null);
  const jumpToSegment = (number: number) => {
    const segment = transcript?.segments[number - 1];
    if (!segment) return;
    if(tagFilter&&!matchesTagFilter(segment,tagFilter))setTagFilters([]);
    setHiddenSpeakerIds(previous => {
      if (!previous.has(segment.speaker_id)) return previous;
      const next = new Set(previous); next.delete(segment.speaker_id); return next;
    });
    selectSegmentForNavigation(segment.id);
    setPendingSegmentJump({ segment, context: speakerFilterContext });
  };
  useLayoutEffect(() => {
    if (!pendingSegmentJump || handledSegmentJump.current === pendingSegmentJump) return;
    handledSegmentJump.current = pendingSegmentJump;
    const { segment, context } = pendingSegmentJump;
    if (context !== speakerFilterContext || !transcript?.segments.includes(segment)) return;
    const panel = transcriptPanelRef.current;
    const target = document.getElementById(`segment-${segment.id}`);
    if (!panel || !target || !panel.contains(target)) return;
    const editor = textareaRefs.current.get(segment.id);
    if (!protectedReadOnly && editor) {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(0, 0);
    } else target.querySelector<HTMLElement>('.segment-text-readonly')?.focus({ preventScroll: true });
    const bounds = panel.getBoundingClientRect(), rect = target.getBoundingClientRect();
    const offset = rect.height > panel.clientHeight ? 16 : (panel.clientHeight - rect.height) / 2;
    panel.scrollTo({ top: Math.max(0, panel.scrollTop + rect.top - bounds.top - offset), behavior: 'instant' });
  }, [pendingSegmentJump, speakerFilterContext, transcript, protectedReadOnly, transcriptPanelRef]);

  const appliedLinkTarget = useRef<SegmentTarget | undefined>(undefined);
  useEffect(() => {
    const target = projectProps.initialSegmentTarget;
    if (!target || appliedLinkTarget.current === target || saveStatus === 'loading' || !transcript || !activeModel) return;
    const actualVersion = viewingOriginal || activeModel.designatedOriginal ? 'original' : activeModel.activeEditId;
    if (target.project !== projectProps.connectorProject?.()?.data.id || target.recording !== projectProps.projectRecordingId || target.model !== activeModel.id || target.version !== actualVersion) return;
    const frame = window.requestAnimationFrame(() => {
      appliedLinkTarget.current = target;
      const index = transcript.segments.findIndex(segment => segment.id === target.segment);
      if (index < 0) setLoadError(msg('segmentTransfer.missing'));
      else jumpToSegment(index + 1);
    });
    return () => window.cancelAnimationFrame(frame);
  });
  useLayoutEffect(() => {
    projectProps.registerSegmentLinkReceiver?.({
      ready: () => !tags.busy && !openingProjectRef.current && !renaming && !versionBusy && !transcribing && saveStatus !== 'loading' && !hasPendingInputs() && !isEditorComposing(),
      open: async raw => {
        if (!projectProps.onOpenSegmentLink || openingProjectRef.current) return;
        if (!canChangeDocumentRef.current()) { setLoadError(msg('ProjectWorkspace.openProjectBusy')); return; }
        openingProjectRef.current = true;
        try { await flushPendingSave(); await projectProps.onOpenSegmentLink(raw); }
        catch (error) { setLoadError(error instanceof Error ? error.message : msg('segmentTransfer.openFailed')); }
        finally { openingProjectRef.current = false; }
      },
    });
    return () => projectProps.registerSegmentLinkReceiver?.(null);
  });

  // 跳到某一处高亮：seek 到该处的时间（而不是片段开头），并把光标落在高亮
  // 最后一个字后面，方便接着改字或听原音。
  //
  // focus 会触发 textarea 的 onFocus → seekTo(segment.start)，所以顺序必须是
  // 先聚焦、后 seek，否则刚定位到的时间会被覆盖回片段开头。
  const jumpToHighlight = (segment: Segment, highlight: Highlight) => {
    if(tagFilter&&!matchesTagFilter(segment,tagFilter))setTagFilters([]);
    setSelectedSegmentId(segment.id);
    window.requestAnimationFrame(() => {
      const textarea = textareaRefs.current.get(segment.id);
      // 播放中的片段渲染的是只读层，registry 里没有 textarea——此时只 seek，不设光标。
      if (textarea) {
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(highlight.end, highlight.end);
      }
      seekTo(timeForCharacter(segment, highlight.end));
      const panel = transcriptPanelRef.current;
      const target = document.getElementById(`segment-${segment.id}`);
      if (panel && target) {
        const top = panel.scrollTop + target.getBoundingClientRect().top
          - panel.getBoundingClientRect().top - panel.clientHeight / 2 + target.clientHeight / 2;
        panel.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      }
    });
  };

  // 焦点片段变化时，让批注栏自动滚动到对应的当前批注卡片（视图居中）。
  useEffect(() => {
    if (!currentSegmentId || !annotationListRef.current) return;
    const card = annotationListRef.current.querySelector('[data-current="true"]');
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentSegmentId, annotationView, panelTab]);



  const exportAs = (format: ExportFormat) => {
    flushEditorDrafts();
    const current = latestExport.current;
    if (!current.transcript) return;
    let selection:Transcript;try{selection=selectExportScope(current.transcript,exportScope,hiddenSpeakerIds,tagFilter)}catch(error){setLoadError(error instanceof Error?error.message:msg('tags.empty'));return}
    void exportTranscript(format, selection, current.metadata, activeModel?.engine, viewingOriginal ? (activeModel?.sourceKind === "import" && !activeModel?.designatedOriginal ? msg('App.m0012') : msg('App.m0013')) : (activeModel?.edits.find(e => e.id === activeModel.activeEditId)?.label ?? defaultEditLabel(Math.max(0, activeModel?.edits.findIndex(e => e.id === activeModel.activeEditId) ?? 0))))
      .catch(error => { recordProblem("export", error); setLoadError(error instanceof Error ? error.message : msg('App.m0014')); });
  };

  const renameCurrentAudio = async (title = metadata?.title ?? "") => {
    if (!hasLoadedTranscript && projectProps.saveRecordingDraft) {
      void patchMetadata({ title: title.trim() });
      return;
    }
    const dir = dirHandleRef.current;
    if (renamingRef.current || versionBusy || saveStatus === "loading" || !dir || !selectedAudio || !metadata || !transcript) return;
    const newStem = sanitizeForFilename(title);
    if (!newStem) { setLoadError(msg('App.m0015')); return; }
    renamingRef.current = true; setRenaming(true);
    try {
      await flushPendingSave();
      initialLoadRef.current = true;
      setSaveStatus("loading");
      const savedTranscript = latestExport.current.transcript;
      if (!savedTranscript) return;
      if (projectProps.projectDirectory) {
        await renameAudio(dir, selectedAudio, stemOf(selectedAudio), title.trim());
        setMetadata(current => current ? { ...current, title: title.trim() } : current);
        await projectProps.saveRecordingDraft?.({ metadata: { ...metadata, title: title.trim() }, speakers: savedTranscript.speakers });
        const manifest = await readManifest(dir, selectedAudio);
        if (manifest) applyManifest(manifest);
        setSaveStatus("saved");
        return;
      }
      const result = await renameAudio(dir, selectedAudio, newStem, title.trim());
      // The rename has committed on disk. Publish the new save path before
      // ancillary reads, so a failed audio reload cannot leave saves targeting the old name.
      setSelectedAudio(result);
      saveInterviewId(result);
      setAudioFilename(result);
      setMetadata(current => current ? { ...current, title: title.trim() } : current);
      resetHistory({ ...savedTranscript, audio: { ...savedTranscript.audio, filename: result } });
      const manifest = await readManifest(dir, result);
      if (manifest) applyManifest(manifest);
      const url = await readAudioUrl(dir, result);
      if (audioUrl.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
      setAudioUrl(url);
      await refreshAudioList(dir);
      setSaveStatus("saved");
      setProcessStatus('done');
      setProcessMessage(msg('App.m0016'));
    } catch (error) {
      recordProblem("rename", error);
      setLoadError(error instanceof Error ? error.message : msg('App.m0017'));
      setSaveStatus("error");
    } finally {
      initialLoadRef.current = false;
      renamingRef.current = false; setRenaming(false);
    }
  };

  const returnToProjects = async (exportFiles = false) => {
    if (tags.busy || renaming || versionBusy || (saveStatus === "loading" && transcript) || !canChangeDocumentRef.current()) return;
    try { await flushPendingSave(); if (exportFiles) projectProps.onExportProjectFiles?.(); else projectProps.onReturnToProjects?.(); }
    catch (error) { setLoadError(error instanceof Error ? error.message : msg('App.m0018')); }
  };
  useEffect(() => {
    if (!projectProps.onOpenProject) return;
    const onOpenProject = (recentId?: string) => {
      if (openingProjectRef.current) return;
      // The native menu must not open a second picker above an application dialog.
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      if (tags.busy || renaming || versionBusy || transcribing || processStatus === 'uploading' || (saveStatus === 'loading' && transcript)) {
        setLoadError(msg('ProjectWorkspace.openProjectBusy')); return;
      }
      openingProjectRef.current = true;
      void (async () => {
        try {
          await flushPendingSave();
          await projectProps.onOpenProject?.(recentId);
        } catch (error) {
          if ((error as {name?:string})?.name !== 'AbortError')
            setLoadError(error instanceof Error ? error.message : msg('App.m0018'));
        } finally { openingProjectRef.current = false; }
      })();
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
  const projectNav = projectProps.onReturnToProjects && <div className="project-editor-nav">
    <button type="button" className="cred-btn" disabled={renaming || versionBusy || transcribing || tags.busy}
      aria-label={projectProps.projectLabel ? msg('App.m0019', { v0: projectProps.projectLabel }) : msg('App.m0020')}
      data-tip={msg('App.m0021')} onClick={() => void returnToProjects()}>{projectProps.projectLabel || msg('App.m0022')}</button>
  </div>;

  if (!transcript) {
    if (projectProps.onReturnToProjects) return <>{projectNav}{loadError && <p className="welcome-error" role="alert">{uiMessage(loadError)}</p>}{settingsModal}</>;
    return (
      <>{projectNav}<LoadingScreen
        loadError={loadError}
        folderShortcutHint={folderShortcutHint}
        handleOpenFolder={handleOpenFolder}
        recentMenuRef={recentMenuRef}
        recentMenuOpen={recentMenuOpen}
        setRecentMenuOpen={setRecentMenuOpen}
        recentFolders={recentFolders}
        handleOpenRecentFolder={handleOpenRecentFolder}
        settingsModal={settingsModal}
        openSettings={openSettings}
      /></>
    );
  }

  const duration = actualDuration;
  const selectedIndex = transcript.segments.findIndex(
    (segment) => segment.id === effectiveSelectedSegmentId,
  );
  const preparingTranscript = (transcribing || activeStatus === "error") && transcript.segments.length === 0;
  const currentVersionKey = `${activeModelId}:${viewingOriginal ? "original" : activeModel?.activeEditId}`;


  // 转录中的文案随阶段和时间变化，直接算出来，不进 state（避免 effect 里 setState）。
  // 正在转录的是别的文件时，文案改成「谁在后台跑」，秒数照旧在走。
  const hasAIEditingNotice = visibleAIActivities(connector.activities).length > 0 || Boolean(connector.taskError);
  const processNoticeText = !transcribeJob
    ? processMessage
    : !transcribeIsCurrent
      ? msg('App.m0023', { v0: transcribeJob.audio, v1: transcribeJob.engine, v2: formatTime(transcribeElapsed) })
      : transcribePhase === "saving"
      ? msg('App.m0024')
      : transcribePhase === "uploading"
        ? msg('App.m0025', { v0: Math.round((transcribeRatio ?? 0) * 100) })
        : transcribePhase === "sending"
          ? transcribeRatio === null ? msg('ProcessNotice.m0635') : msg('App.m0026', { v0: Math.round((transcribeRatio ?? 0) * 100), v1: formatTime(transcribeElapsed) })
          : msg('App.m0027', { v0: activeProviderName || msg('App.m0028'), v1: formatTime(transcribeElapsed) });

  const transcriptionNotice = (transcribing || activeStatus === "error") && <ProcessNotice card compact={transcript.segments.length > 0} onDismiss={()=>{setProcessStatus("ready");setProcessMessage("");}}
            text={processNoticeText} status={activeStatus} phase={transcribePhase} ratio={transcribeRatio}
            engine={transcribeJob?.engine ?? activeProviderName} elapsed={transcribeElapsed}
            hint={transcribeHint} raw={transcribeRaw} cancelTranscription={cancelTranscription}
            setTranscriptionDialogOpen={setTranscriptionDialogOpen} setSaveToast={setSaveToast} />;

  return (
    <div className="app-shell">
      {transcript.timeAligned === false && <p className="project-timing-notice">{msg('App.m0029')}</p>}
      {legacyEntries.length > 0 && dirHandle && (
        <div className="legacy-banner" role="status">
          <div className="legacy-banner__text">
            {msg('review.legacyMigration', { count: legacyEntries.length })}</div>
          <button
            type="button"
            className="button button--primary"
            disabled={migratingLegacy}
            onClick={() => void handleMigrateLegacy()}
          >
            {migratingLegacy ? msg('App.m0037') : msg('App.m0038', { v0: legacyEntries.length })}
          </button>
        </div>
      )}
      <div inert={renaming || versionBusy || saveStatus === "loading"}><Topbar
        taskOnly={preparingTranscript}
        audioFilename={audioFilename || transcript.audio.filename}
        projectMode={Boolean(projectProps.projectDirectory)}
        projectLabel={projectProps.projectLabel}
        onReturnToProjects={projectProps.onReturnToProjects ? () => void returnToProjects() : undefined}
        navigationDisabled={renaming || versionBusy || transcribing}
        transactionPending={tags.busy}
        dirHandle={dirHandle}
        handleOpenFolder={handleOpenFolder}
        folderShortcutHint={folderShortcutHint}
        openMenuOpen={openMenuOpen}
        setOpenMenuOpen={setOpenMenuOpen}
        openMenuRef={openMenuRef}
        recentFolders={recentFolders}
        handleOpenRecentFolder={handleOpenRecentFolder}
        importInputRef={importInputRef}
        handleTranscriptFile={handleTranscriptFile}
        selectedAudio={selectedAudio}
        loadAudio={loadAudio}
        audioFiles={audioFiles}
        viewingOriginal={viewingOriginal}
        performUndo={performUndo}
        performRedo={performRedo}
        canUndo={(canUndo||tags.canUndo)&&!aiLocked}
        canRedo={(canRedo||tags.canRedo)&&!aiLocked}
        setFindOpen={setFindOpen}
        exportMenuOpen={exportMenuOpen}
        setExportMenuOpen={setExportMenuOpen}
        exportMenuRef={exportMenuRef}
        exportAs={exportAs}
        exportScope={exportScope} setExportScope={setExportScope} fullCount={transcript?.segments.length??0} visibleCount={visibleSegments.length}
        subtitlesAvailable={Boolean(transcript && canExportSubtitles(transcript))}
        exportProjectFiles={projectProps.onExportProjectFiles ? () => void returnToProjects(true) : undefined}
        handleSave={handleSave}
        openSettings={openSettings}
      /></div>

      {findOpen && !preparingTranscript && (
        <FindBar
          findQuery={findQuery}
          setFindQuery={setFindQuery}
          currentMatchIndex={currentMatchIndex}
          setCurrentMatchIndex={setCurrentMatchIndex}
          matchCount={matchCount}
          showReplace={showReplace}
          setShowReplace={setShowReplace}
          replaceValue={replaceValue}
          setReplaceValue={setReplaceValue}
          viewingOriginal={protectedReadOnly}
          setFindOpen={setFindOpen}
          findNext={findNext}
          findPrev={findPrev}
          replaceCurrent={replaceCurrent}
          replaceAll={replaceAll}
        />
      )}
        <AIEditingNotice activities={connector.activities} isCurrent={task => task.target
          ? task.target.project_id === projectProps.connectorProject?.()?.data.id && task.target.interview_id === projectProps.projectInterviewId && task.target.recording_id === projectProps.projectRecordingId && task.target.version_id === aiVersionId
          : task.version_id === aiVersionId} onDismiss={async id => { if (processStatus === 'done') setProcessMessage(''); await connector.taskAction('dismiss_editing', id); transcriptPanelRef.current?.focus(); }} onEnd={async id => { if (processStatus === 'done') setProcessMessage(''); await connector.taskAction('end_editing', id); transcriptPanelRef.current?.focus(); }}>
          {(connector.taskError || connector.tasks.some(task => task.state !== 'completed' && task.state !== 'cancelled')) && <ContinuationProgress embedded tasks={connector.tasks} error={connector.taskError} onAction={connector.taskAction} onDismissError={connector.dismissTaskError}/>}
        </AIEditingNotice>
      {!hasAIEditingNotice && processNoticeText && activeStatus !== "ready" && !transcribing && activeStatus !== "error" && (
        <ProcessNotice
          onDismiss={() => { setProcessMessage(''); transcriptPanelRef.current?.focus(); }}
          text={processNoticeText}
          status={activeStatus}
          phase={transcribePhase}
          ratio={transcribeRatio}
          hint={transcribeHint}
          raw={transcribeRaw}
          cancelTranscription={cancelTranscription}
          setTranscriptionDialogOpen={setTranscriptionDialogOpen}
          setSaveToast={setSaveToast}
        />
      )}

      {loadError && <LoadErrorNotice text={loadError} problem={transferFailure?.text === loadError ? transferFailure.problem : undefined} onDismiss={()=>setLoadError('')}/>}

      <div
        inert={renaming || saveStatus === "loading" || versionBusy}
        className={`workspace${preparingTranscript ? " workspace--transcription" : ""}${speakerPanelCollapsed ? " workspace--speaker-collapsed" : ""}${annotationPanelCollapsed ? " workspace--annotation-collapsed" : ""}`}
      >
        {!preparingTranscript && <SpeakerPanel
          speakers={transcript.speakers}
          hiddenSpeakerIds={hiddenSpeakerIds}
          viewingOriginal={protectedReadOnly}
          readOnlyMessage={aiLocked ? msg('aiEditing.readOnly') : undefined}
          mergeMenuFor={mergeMenuFor}
          setMergeMenuFor={setMergeMenuFor}
          mergeMenuRef={mergeMenuRef}
          collapsed={speakerPanelCollapsed}
          setCollapsed={setSpeakerPanelCollapsed}
          mutateTranscript={mutateTranscript}
          toggleHideSpeaker={id => {
            const nextHidden = new Set(hiddenSpeakerIds);
            if (nextHidden.has(id)) nextHidden.delete(id); else nextHidden.add(id);
            captureSpeakerFilterPosition(transcript.segments, nextHidden);
            toggleHideSpeaker(id);
          }}
          setMergePrompt={setMergePrompt}
          deleteSpeaker={deleteSpeaker}
          addSpeaker={addSpeaker}
          hasEnglishSpeakerTemplate={hasEnglishSpeakerTemplate}
          normalizeEnglishSpeakerTemplates={normalizeEnglishSpeakerTemplates}
        />}
      <main className="transcript-column">
        <div className="transcript-header-fixed">
        <TranscriptHeader
          preparing={preparingTranscript}
          editingLocked={aiLocked}
          transcriptionControl={selectedAudio && <TranscribeAudioButton
            disabledReason={transcribing ? msg('transcriptionAction.running')
              : aiLocked ? msg('transcriptionAction.editingLocked')
              : versionBusy ? msg('transcriptionAction.loading')
              : !audioUrl ? msg('transcriptionAction.audioUnavailable') : undefined}
            onClick={() => setTranscriptionDialogOpen(true)} />}
          comparisonControls={<>
            <button type="button" className={`comparison-toggle${comparison.shown ? " is-active" : ""}`} aria-pressed={comparison.shown}
              disabled={viewingOriginal || !comparison.options.length || versionBusy} data-tip-pos="top" data-tip={msg('App.m0039', { v0: keys("Y",true) })} onClick={comparison.toggle}><span className="comparison-toggle-track" aria-hidden="true" /><span>{msg('App.m0040')}</span></button>
            {comparison.shown && <div className="comparison-source"><span>{msg('App.m0041')}</span>
              <VersionPicker key={`${selectedAudio}:comparison`} models={models} value={comparison.base} variant="comparison"
                excluded={currentVersionKey} disabled={versionBusy} mutationDisabled={aiLocked} onSelect={(model,edit)=>comparison.choose(`${model}:${edit}`)} onRename={guardedRenameVersion} />
            </div>}
            {comparison.loading && <span className="comparison-status" role="status">{msg('App.m0042')}</span>}
            {comparison.error && <span role="alert">{uiMessage(comparison.error)}</span>}
          </>}
          metadata={metadata}
          segmentCount={visibleSegments.length}
          segmentNavigation={<SegmentJump key={`${selectedAudio}:${activeEditKey}:${viewingOriginal}`} count={transcript.segments.length} onJump={jumpToSegment} />}
          viewingOriginal={viewingOriginal}
          activeModelId={activeModelId}
          versionControls={<VersionPicker key={`${selectedAudio}:current`} models={models} value={currentVersionKey} variant="current" disabled={versionBusy} pending={tags.busy} mutationDisabled={aiLocked}
            onSelect={(model,edit)=>{if(edit==="original")void openOriginal(model);else void selectEdit(model,edit);}}
            onRename={guardedRenameVersion} onCopy={(model,edit)=>{if(editLockedRef.current())return;if(edit==="original")void forkFromOriginal(model);else void duplicateEdit(model,edit);}}
            onDelete={(modelId,editId,label,isLast)=>{if(editLockedRef.current())return;setDeletePrompt({kind:editId==="original"?"original":"edit",modelId,editId:editId==="original"?undefined:editId,label,isLast});}} />}
          patchMetadata={patch => {
            if (editLockedRef.current()) return;
            if (patch.title !== undefined && projectProps.onRenameInterview) {
              void projectProps.onRenameInterview(patch.title).then(() => patchMetadata(patch)).catch(error => setLoadError(error instanceof Error ? error.message : msg('App.m0043')));
            } else if (patch.title !== undefined) void renameCurrentAudio(patch.title);
            else if (projectProps.onPatchInterview) void projectProps.onPatchInterview(patch).then(() => patchMetadata(patch)).catch(error => setLoadError(error instanceof Error ? error.message : msg('App.m0044')));
            else patchMetadata(patch);
          }}
          forkFromOriginal={forkFromOriginal}
        />
        {!preparingTranscript && transcriptionNotice}
        </div>

        <section className="transcript-panel" data-tag-drop-scroll ref={transcriptPanelRef} tabIndex={-1} aria-label={msg('App.m0045')}>
          {followingPaused && isPlaying && (
            <button type="button" className="follow-resume" onClick={resumeFollow}>
              {msg('App.m0046')}</button>
          )}

          {preparingTranscript && transcriptionNotice}

          {tagFilter&&visibleSegments.length===0&&<p className="annotation-empty">{msg('tags.empty')}</p>}
          {transcript.segments.length === 0 && !comparison.baseline?.segments.length ? (transcribing || activeStatus === "error" ? null : (
            <section className="empty-transcript">
              <p className="section-label">READY</p>
              <h2>{msg('App.m0047')}</h2>
                  <button
                    type="button"
                    className="start-transcribe-button"
                    onClick={() => setTranscriptionDialogOpen(true)}
                    disabled={!selectedAudio || !audioUrl}
                  >
                    {msg('App.m0048')}</button>
                  {!selectedAudio && <p className="empty-transcript__hint">{msg('App.m0049')}</p>}
            </section>
          )) : <div className="segment-list"><TagWritingContext.Provider value={tags.busy}><TagCandidatesContext.Provider value={segmentTagView.available}>
            {renderedRows.map(({segment,deleted,before}) => deleted ? (
              <article className="comparison-deleted-segment" key={`deleted:${segment.id}`}>
                <span>{transcript.timeAligned === false ? msg('App.m0050') : msg('App.m0051', { v0: formatTime(segment.start) })}</span><del>{segment.text}</del>
                {!viewingOriginal && <button type="button" className="button" onClick={()=>mutateTranscript(current=>{
                  if(current.segments.some(s=>s.id===segment.id))return current;
                  const segments=[...current.segments];
                  const baseline = comparison.baseline?.segments ?? [];
                  const nextIds = new Set(baseline.slice(baseline.findIndex(s => s.id === segment.id) + 1).map(s => s.id));
                  const index = current.timeAligned === false ? segments.findIndex(s => nextIds.has(s.id)) : segments.findIndex(s=>s.start>segment.start);
                  segments.splice(index<0?segments.length:index,0,segment);return {...current,segments};
                })}>{msg('App.m0052')}</button>}
              </article>
            ) : (
              <SegmentItem
                tags={segmentTagView.segments.get(segment.id)!.tags}
                tagDropTarget={tagDropSegment===segment.id}
                tagPaths={segmentTagView.segments.get(segment.id)!.paths}
                onAddTagId={tags.attach}
                tagRenameEnabled={segmentTagView.segments.get(segment.id)!.tags.length > 0 && !tagFilterEnabled && !protectedReadOnly && !tagUpgradeRequired}
                tagWriteDisabled={tagUpgradeRequired}
                onRenameTag={projectProps.tagStorage?tags.renamePath:undefined}
                onAddTag={projectProps.tagStorage?tags.add:undefined}
                registerTagEntry={registerTagEntry}
                onRemoveTag={tags.remove}
                timeAligned={transcript.timeAligned}
                key={`${selectedAudio}:${activeEditKey}:${viewingOriginal}:${segment.id}`}
                segment={segment}
                comparisonBefore={before}
                comparisonBase={comparison.base}
                comparisonAccepted={before !== undefined && transcript.comparisonReviews?.[comparisonReviewKey(comparison.base,segment.id)]?.before === before ? transcript.comparisonReviews[comparisonReviewKey(comparison.base,segment.id)].accepted : undefined}
                {...segmentActions}
                nativeDragSegment={hasNativeSegmentDrag() ? segmentActions.nativeDragSegment : undefined}
                index={segmentIndices.get(segment.id) ?? -1}
                totalSegments={transcript.segments.length}
                speakers={transcript.speakers}
                effectiveSelectedSegmentId={effectiveSelectedSegmentId === segment.id ? segment.id : ""}
                isPlaying={isPlaying}
                currentTime={currentTime}
                findQuery={protectedReadOnly ? findQuery : ""}
                audioUrl={audioUrl}
                viewingOriginal={protectedReadOnly}
                audioRef={audioRef}
                textareaRefs={textareaRefs}
                editingRef={editingRef}
              />
            ))}
          </TagCandidatesContext.Provider></TagWritingContext.Provider></div>}
        </section>
        </main>

        {shuttingDown && (
          <div className="shutdown-overlay">
            <div className="shutdown-card">
              <h2>{msg('App.m0053')}</h2>
              <p>{msg('App.m0054')}</p>
              <p className="shutdown-hint">{msg('App.m0055')}</p>
            </div>
          </div>
        )}

        {saveToast && <SaveToastNotice toast={saveToast} onDismiss={()=>setSaveToast(null)}/>}

        {!preparingTranscript && <AnnotationPanel
          tagCount={tags.collection.tagIds.length}
          tagsPanel={projectProps.tagStorage?<>{tagUpgradeRequired&&<TagStorageUpgrade onUpgrade={projectProps.onUpgradeTagStorage?async()=>{await beforeChangeRef.current();await projectProps.onUpgradeTagStorage!()}:undefined}/>}<TagsPanel countVersionId={`${projectProps.projectRecordingId}:${activeModelId}:${viewingOriginal?'original':activeModel?.activeEditId}`} onPlaceGroupTag={tags.placeInGroup} loadProjectCounts={projectProps.tagStorage?.counts} projectRevision={projectProps.tagStorage?.projectRevision} versionKey={`${selectedAudio}:${activeEditKey}:${viewingOriginal}`} collection={tags.collection} onSortName={tags.sortByName} onReorder={tags.reorder} library={tags.library} loadError={preparedTagLibrary.error||tags.error} onChange={tags.change} onCreateTag={async(name,id)=>{await tags.create(name,id)}} onRenameTag={tags.rename} onTagDropTarget={setTagDropSegment} onDropTagToSegment={dropTagToSegment} readOnly={protectedReadOnly||tagUpgradeRequired} saving={tags.busy} filter={selectedTagIds} filterMode={tagFilterMode} onFilterModeChange={setTagFilterMode} filterEnabled={tagFilterEnabled} onFilterEnabledChange={enabled=>{setTagFilterEnabled(enabled);setTagFilterMode('and');if(!enabled)setTagFilters([])}} onFilter={id=>{if(tagFilterEnabled)setTagFilters(current=>id?(current.includes(id)?current.filter(value=>value!==id):[...current,id]):[]);transcriptPanelRef.current?.scrollTo(0,0)}} currentCoverage={currentTagCoverage} currentCount={currentTagCount} currentTagIds={tags.collection.tagIds} onReparentTag={tags.reparent} onRemoveCurrent={async id=>{const removed=new Set(descendantTagIds(tags.library,id));await tags.removeCurrent(id);setTagFilters(ids=>ids.filter(id=>!removed.has(id)))}}/></>:undefined}
          transcript={transcript}
          readOnly={protectedReadOnly} pending={tags.busy}
          readOnlyMessage={aiLocked ? msg('aiEditing.readOnly') : undefined}
          annotationView={annotationView}
          setAnnotationView={setAnnotationView}
          panelTab={panelTab}
          setPanelTab={setPanelTab}
          currentSegment={currentSegment}
          currentSegmentId={currentSegmentId}
          hiddenSpeakerIds={hiddenSpeakerIds}
          annotationListRef={annotationListRef}
          collapsed={annotationPanelCollapsed}
          setCollapsed={setAnnotationPanelCollapsed}
          highlightGroups={highlightGroups}
          highlightCount={highlightCount}
          setSelectedSegmentId={id=>{const target=transcript?.segments.find(segment=>segment.id===id);if(tagFilter&&(!target||!matchesTagFilter(target,tagFilter)))setTagFilters([]);setSelectedSegmentId(id)}}
          seekTo={seekTo}
          updateAnnotation={updateAnnotation}
          deleteAnnotation={deleteAnnotation}
          addAnnotation={addAnnotation}
          onJumpToHighlight={jumpToHighlight}
          onRemoveHighlight={removeHighlight}
        />}
      </div>

      <PlayerBar
        audioRef={audioRef}
        audioUrl={audioUrl}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        skipSeconds={skipSeconds}
        playbackRate={playbackRate}
        selectedIndex={selectedIndex}
        segmentCount={transcript.segments.length}
        handleAudioMetadata={handleAudioMetadata}
        handleAudioDurationChange={handleAudioDurationChange}
        handleAudioError={handleAudioError}
        updateCurrentSegment={updateCurrentSegment}
        setIsPlaying={setIsPlaying}
        togglePlayback={togglePlayback}
        seekTo={seekTo}
        setPlaybackRate={setPlaybackRate}
      />

      {transcriptionDialogOpen && (
        <TranscriptionDialog
          providers={providers}
          defaultProviderId={defaultProviderId}
          selectedProviderId={selectedProviderId}
          onSelectProvider={(id) => {
            setSelectedProviderId(id);
            saveSelectedProviderId(id);
          }}
          hasAudio={!!selectedAudio && !!audioUrl}
          audioFilename={audioFilename || transcript.audio.filename}
          busy={transcribing}
          preserveExisting={models.length > 0}
          onClose={() => setTranscriptionDialogOpen(false)}
          onStart={startTranscription}
        />
      )}

      {segmentMergePrompt && <SegmentMergeDialog changed={segmentMergeChanged} readOnly={protectedReadOnly||tags.busy}
        onCancel={() => setSegmentMergePrompt(null)} onConfirm={() => { if (!protectedReadOnly) confirmSegmentMerge(); }} />}

      {mergePrompt && (
        <MergeDialog
          prompt={mergePrompt}
          dialogRef={mergeDialogRef}
          setPrompt={setMergePrompt}
          confirmMerge={confirmMerge}
        />
      )}

      {namingOpen && (
        <NamingModal
          value={namingValue}
          error={namingError}
          setError={setNamingError}
          busy={namingBusy}
          repairs={importRepairs}
          setRepairs={setImportRepairs}
          modalRef={namingRef}
          setOpen={setNamingOpen}
          confirmNaming={confirmNaming}
        />
      )}

      {deletePrompt && (
        <DeleteDialog
          prompt={deletePrompt}
          dialogRef={deleteRef}
          setPrompt={setDeletePrompt}
          confirmDelete={() => { if (!editLockedRef.current()) void confirmDelete(); }}
        />
      )}

      {matchPrompt && (
        <MatchDialog
          prompt={matchPrompt}
          dialogRef={matchRef}
          setPrompt={setMatchPrompt}
          finishImport={finishImport}
          confirmMatch={confirmMatch}
        />
      )}




      {settingsModal}
      {tags.mergePrompt&&<TagMergeDialog request={tags.mergePrompt.request} onChoose={tags.mergePrompt.finish}/>}

    </div>
  );
}

export default App;
