import { msg, uiMessage, useInterfaceLanguage } from './i18n';
import { recordProblem } from "./lib/diagnostics";
import { CopyProblem } from "./components/CopyProblem";
import { VersionPicker } from "./components/VersionPicker";
import { useStableCallbacks } from "./hooks/useStableCallbacks";
import { applyComparisonDecision, comparisonReviewKey, reconcileComparisonReviews } from "./lib/comparisonReview";
import { useVersionComparison } from "./hooks/useVersionComparison";
import { comparisonRows } from "./lib/comparisonSegments";
import { nextAIEditName } from "./lib/aiEditing";
import { useOpeningPosition } from "./hooks/useOpeningPosition";
import { openingSegmentId } from "./lib/editPosition";
import type { ParagraphEditorElement } from "./lib/paragraphEditor";
import { flushEditorDrafts, hasEditorDrafts } from "./lib/editorDrafts";
import {
  useLayoutEffect,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { TranscriptionDialog } from "./TranscriptionDialog";
import type {
  Highlight,
  InterviewMetadata,
  Segment,
  Transcript,
  TranscriptManifest,
} from "./types";
import { useTranscriptHistory } from "./useTranscriptHistory";
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
  aiEditingDocumentId,
  readAIReviewDraft,
  writeAIReviewDraft,
  AUDIO_EXT_LABEL,
  defaultEditLabel,
  defaultMetadata,
  readAudioUrl,
  renameAudio,
  readManifest,
  sanitizeForFilename,
  stemOf,
  saveSelectedProviderId,
} from "./localStore";
import { canExportSubtitles, type ExportFormat, exportTranscript } from "./lib/export";
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
import { AIEditingDialog } from "./components/AIEditingDialog";
import { readModelOriginal } from "./localStore";

type SaveStatus = "loading" | "unsaved" | "saving" | "saved" | "error";

// 快退/快进步长默认值（秒），可被偏好设置覆盖；键盘左右键与右侧 ± 按钮共用。

export interface ProjectEditorProps {
  projectDirectory?: FileSystemDirectoryHandle;
  projectLabel?: string;
  interviewTitle?: string;
  interviewMetadata?: InterviewMetadata;
  onPatchInterview?: (patch: Partial<InterviewMetadata>) => Promise<void>;
  recordingLabel?: string;
  onRenameInterview?: (title: string) => Promise<void>;
  onReturnToProjects?: () => void;
  onExportProjectFiles?: () => void;
  openSettingsInitially?: boolean;
}
function App(projectProps: ProjectEditorProps = {}) {
  useInterfaceLanguage();
  // 平台检测——tooltip 与按钮文案里显示对应的快捷键（避免 Mac 用户看到 Ctrl+O）
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
  const folderShortcutHint = isMac ? "⌘O" : "Ctrl + O";
  const { transcript, reset: resetHistory, commit, undo, redo, canUndo, canRedo } =
    useTranscriptHistory<Transcript>();
  const resetDocumentViewRef = useRef<() => void>(() => {});
  // 所有成功载入/替换文稿的路径共用这个入口；普通编辑和撤销不重置视图。
  const reset = useCallback((value: Transcript) => {
    resetDocumentViewRef.current();
    resetHistory(value);
  }, [resetHistory]);
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
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(projectProps.openSettingsInitially));
  // 设置弹窗不持久化：每次打开都回到「通用」，因为改播放速度这类
  // 高频操作都在这一页，而「引擎与密钥」是低频的、体积又大的一页。
  const [settingsTab, setSettingsTab] = useState<"prefs" | "engines" | "ai" | "plans" | "diagnostics">("prefs");
  const [aiSession, setAISession] = useState<{
    transcript: Transcript; source: string; selectedId: string;
    dir: FileSystemDirectoryHandle; context: string; loadOriginal: () => Promise<Transcript | null>;
  } | null>(null);
  const { openSettingsInitially, onReturnToProjects } = projectProps;
  useEffect(() => {
    if (openSettingsInitially && !settingsOpen) onReturnToProjects?.();
  }, [settingsOpen, openSettingsInitially, onReturnToProjects]);
  const openSettings = () => {
    setSettingsTab("prefs");
    setSettingsOpen(true);
  };
  useDismissable(recentMenuRef, recentMenuOpen, () => setRecentMenuOpen(false));
  const [metadata, setMetadata] = useState<InterviewMetadata | null>(null);
const [hasLoadedTranscript, setHasLoadedTranscript] = useState(false);
// 当前是否在查看引擎原始稿（只读模式，所有编辑控件禁用）。
const [viewingOriginal, setViewingOriginal] = useState(false);
  const [processStatus, setProcessStatus] = useState<ProcessStatus>("idle");
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // 各浮层内容 ref（供 useDismissable 判定「点击外部」用）
  const settingsRef = useRef<HTMLDialogElement>(null);

  // 统一浮层关闭契约：Esc + 浮层外部 pointerdown。
  useDismissable(openMenuRef, openMenuOpen, () => setOpenMenuOpen(false));
  useDismissable(exportMenuRef, exportMenuOpen, () => setExportMenuOpen(false));
  const [processMessage, setProcessMessage] = useState("");
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
  const visibleSegments = useMemo(
    () => (transcript ? transcript.segments.filter((s) => !hiddenSpeakerIds.has(s.speaker_id)) : []),
    [transcript, hiddenSpeakerIds],
  );
  // 高亮清单：按文档顺序分组；隐藏说话人的片段不计入，与批注「全部」视图保持一致。
  const highlightGroups = useMemo(
    () => collectHighlightGroups(transcript, hiddenSpeakerIds),
    [transcript, hiddenSpeakerIds],
  );
  const highlightCount = useMemo(() => countHighlights(transcript), [transcript]);

  const [renaming, setRenaming] = useState(false);
  const renamingRef = useRef(false);
  const canChangeDocumentRef = useRef<() => boolean>(() => true);
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
  const mutateTranscript = useCallback(
    (updater: (current: Transcript) => Transcript, groupKey?: string) => {
      commit(current => reconcileComparisonReviews(updater(current)), groupKey);
      setSaveStatus("unsaved");
    },
    [commit],
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
    updateCurrentSegment,
    resumeFollow,
    handleAudioMetadata,
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
  });

  useOpeningPosition(openingPosition, transcriptPanelRef, hasLoadedTranscript);

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
      setOpeningPosition(null);
      setSaveStatus("loading");
      setLoadError("");
      initialLoadRef.current = true;
    },
    onLoaded: ({ url, manifest, edited }, name) => {
      setAudioUrl(url);
      setAudioFilename(name);
      setCurrentTime(0);
      setActualDuration(0);
      if (!edited || !manifest) {
        setViewingOriginal(false);
        setMetadata(projectProps.interviewMetadata ?? defaultMetadata(projectProps.interviewTitle ?? stemOf(name)));
        reset({ audio: { filename: name, duration: 0 }, speakers: [], segments: [] });
        setHasLoadedTranscript(false);
        applyManifestRef.current(null);
        setProcessStatus("ready");
        setProcessMessage(msg('App.m0001'));
        setSaveStatus("saved");
        return;
      }
      applyManifestRef.current(manifest);
      setMetadata(edited.metadata);
      reset(edited.transcript);
      const openingId = openingSegmentId(edited.transcript);
      setSelectedSegmentId(openingId);
      setOpeningPosition({ id: openingId });
      setHasLoadedTranscript(true);
      const loadedModel = manifest.models.find(m => m.id === manifest.activeModelId) ?? manifest.models[0];
      setViewingOriginal(Boolean(loadedModel?.designatedOriginal) || (!loadedModel?.edits.length && Boolean(loadedModel?.original)));
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
    beforeChange: () => beforeChangeRef.current(),
    contextKey: transcribeContextKey,
    setViewingOriginal,
    dirHandleRef,
    selectedAudio,
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
  });


  useLayoutEffect(() => { beforeChangeRef.current = flushPendingSave; }, [flushPendingSave]);

  const aiContext = `${selectedAudio}:${activeEditKey}:${viewingOriginal}`;
  const latestAIContext = useRef(aiContext);
  useLayoutEffect(() => { latestAIContext.current = aiContext; }, [aiContext]);
  if (aiSession && (aiSession.dir !== dirHandle || aiSession.context !== aiContext)) setAISession(null);
  const openAIEditing = async () => {
    const dir = dirHandle;
    const audio = selectedAudio;
    const model = activeModel;
    if (!dir || !audio || !model || versionBusy) return;
    try {
      await flushPendingSave();
      const current = latestExport.current.transcript;
      if (!current?.segments.length || dirHandleRef.current !== dir || latestAIContext.current !== aiContext) return;
      audioRef.current?.pause();
      setAISession({ transcript: current, source: audio, selectedId: effectiveSelectedSegmentId, dir,
        context: aiContext, loadOriginal: async () => (await readModelOriginal(dir, audio, model.id))?.transcript ?? null });
    } catch (error) { setLoadError(error instanceof Error ? error.message : msg('App.m0011')); }
  };

  // 设置弹层：必须在「空状态提前 return」与「完整 UI return」两处都渲染，
  // 否则空状态下点击「偏好设置」会因提前 return 而永不显示。
  const settingsModal = settingsOpen ? (
    <SettingsModal
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
    viewingOriginal,
    mutateTranscript,
    setSelectedSegmentId,
    textareaRefs,
  });

  const {
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
      setHiddenSpeakerIds(new Set());
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
    setMergePrompt, setMergeMenuFor]);

  const performUndo = useCallback(() => {
    const hadDraft = hasEditorDrafts();
    flushEditorDrafts();
    if (!canUndo && !hadDraft) return;
    undo();
    setSaveStatus("unsaved");
  }, [canUndo, undo]);

  const performRedo = useCallback(() => {
    flushEditorDrafts();
    if (!canRedo) return;
    redo();
    setSaveStatus("unsaved");
  }, [canRedo, redo]);


  useShortcuts({
    disabled: Boolean(aiSession) || renaming || versionBusy || saveStatus === "loading",
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
    onComparisonDecision: (decision: Parameters<typeof applyComparisonDecision>[1]) =>
      mutateTranscript(current => applyComparisonDecision(current, decision, comparison.baseline?.segments)),
  });
  const renderedRows = useMemo(() => comparisonRows(transcript?.segments ?? [], comparison.baseline?.segments)
    .filter(row => !hiddenSpeakerIds.has(row.segment.speaker_id)),
    [transcript?.segments, comparison.baseline?.segments, hiddenSpeakerIds]);
  const segmentIndices = useMemo(() => new Map(transcript?.segments.map((segment, index) => [segment.id, index])), [transcript?.segments]);

  // 跳到某一处高亮：seek 到该处的时间（而不是片段开头），并把光标落在高亮
  // 最后一个字后面，方便接着改字或听原音。
  //
  // focus 会触发 textarea 的 onFocus → seekTo(segment.start)，所以顺序必须是
  // 先聚焦、后 seek，否则刚定位到的时间会被覆盖回片段开头。
  const jumpToHighlight = (segment: Segment, highlight: Highlight) => {
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
    void exportTranscript(format, current.transcript, current.metadata, activeModel?.engine, viewingOriginal ? (activeModel?.sourceKind === "import" && !activeModel?.designatedOriginal ? msg('App.m0012') : msg('App.m0013')) : (activeModel?.edits.find(e => e.id === activeModel.activeEditId)?.label ?? defaultEditLabel(Math.max(0, activeModel?.edits.findIndex(e => e.id === activeModel.activeEditId) ?? 0))))
      .catch(error => { recordProblem("export", error); setLoadError(error instanceof Error ? error.message : msg('App.m0014')); });
  };

  const renameCurrentAudio = async (title = metadata?.title ?? "") => {
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
    if (renaming || versionBusy || aiSession || (saveStatus === "loading" && transcript) || !canChangeDocumentRef.current()) return;
    try { await flushPendingSave(); if (exportFiles) projectProps.onExportProjectFiles?.(); else projectProps.onReturnToProjects?.(); }
    catch (error) { setLoadError(error instanceof Error ? error.message : msg('App.m0018')); }
  };
  const projectNav = projectProps.onReturnToProjects && <div className="project-editor-nav">
    <button type="button" className="cred-btn" disabled={renaming || versionBusy || Boolean(aiSession) || transcribing}
      aria-label={projectProps.projectLabel ? msg('App.m0019', { v0: projectProps.projectLabel }) : msg('App.m0020')}
      title={msg('App.m0021')} onClick={() => void returnToProjects()}>{projectProps.projectLabel || msg('App.m0022')}</button>
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

  const duration = actualDuration || transcript.audio.duration;
  const selectedIndex = transcript.segments.findIndex(
    (segment) => segment.id === effectiveSelectedSegmentId,
  );
  const preparingTranscript = (transcribing || activeStatus === "error") && transcript.segments.length === 0;
  const currentVersionKey = `${activeModelId}:${viewingOriginal ? "original" : activeModel?.activeEditId}`;


  // 转录中的文案随阶段和时间变化，直接算出来，不进 state（避免 effect 里 setState）。
  // 正在转录的是别的文件时，文案改成「谁在后台跑」，秒数照旧在走。
  const processNoticeText = !transcribeJob
    ? processMessage
    : !transcribeIsCurrent
      ? msg('App.m0023', { v0: transcribeJob.audio, v1: transcribeJob.engine, v2: formatTime(transcribeElapsed) })
      : transcribePhase === "saving"
      ? msg('App.m0024')
      : transcribePhase === "uploading"
        ? msg('App.m0025', { v0: Math.round(transcribeRatio * 100) })
        : transcribePhase === "sending"
          ? msg('App.m0026', { v0: Math.round(transcribeRatio * 100), v1: formatTime(transcribeElapsed) })
          : msg('App.m0027', { v0: activeProviderName || msg('App.m0028'), v1: formatTime(transcribeElapsed) });

  const transcriptionNotice = (transcribing || activeStatus === "error") && <ProcessNotice card compact={transcript.segments.length > 0}
            text={processNoticeText} status={activeStatus} phase={transcribePhase} ratio={transcribeRatio}
            engine={transcribeJob?.engine ?? activeProviderName} elapsed={transcribeElapsed}
            hint={transcribeHint} raw={transcribeRaw} cancelTranscription={cancelTranscription}
            setTranscriptionDialogOpen={setTranscriptionDialogOpen} setSaveToast={setSaveToast} />;

  return (
    <div className="app-shell">
      {transcript.timeAligned === false && <p className="project-timing-notice">{msg('App.m0029')}</p>}
      {aiSession && aiSession.dir === dirHandle && aiSession.context === aiContext && (
        <AIEditingDialog transcript={aiSession.transcript} source={aiSession.source}
          sourceLabel={viewingOriginal ? (activeModel?.sourceKind === "import" && !activeModel?.designatedOriginal ? msg('App.m0030') : msg('App.m0031')) : activeModel?.edits.find(e => e.id === activeModel.activeEditId)?.label ?? defaultEditLabel(Math.max(0, activeModel?.edits.findIndex(e => e.id === activeModel.activeEditId) ?? 0))}
          suggestedName={nextAIEditName(activeModel?.edits.find(e => e.id === activeModel.activeEditId)?.label ?? defaultEditLabel(Math.max(0, activeModel?.edits.findIndex(e => e.id === activeModel.activeEditId) ?? 0)), activeModel?.edits.map((e,i) => e.label ?? defaultEditLabel(i)) ?? [])}
          loadDocumentId={() => aiEditingDocumentId(aiSession.dir, aiSession.source)}
          loadDraft={() => readAIReviewDraft(aiSession.dir, aiSession.source, viewingOriginal ? `original:${activeModelId}` : activeEditKey)}
          saveDraft={draft => writeAIReviewDraft(aiSession.dir, aiSession.source, viewingOriginal ? `original:${activeModelId}` : activeEditKey, draft)}
          selectedId={aiSession.selectedId} loadOriginal={aiSession.loadOriginal}
          onClose={() => setAISession(null)}
          onSettings={() => { setAISession(null); setSettingsTab("ai"); setSettingsOpen(true); }}
          onApply={async (suggestions, label) => {
            const sourceModel=activeModelId, sourceEdit=viewingOriginal ? "original" : activeModel?.activeEditId;
            const result=await createAIEdit(aiSession.transcript, suggestions, label);
            if(result && sourceModel && sourceEdit) comparison.activate(result.model.id,result.edit.id,`${sourceModel}:${sourceEdit}`);
          }} />
      )}
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
        openAIEditing={hasLoadedTranscript && transcript.segments.length && !versionBusy ? () => void openAIEditing() : undefined}
        audioFilename={audioFilename || transcript.audio.filename}
        projectMode={Boolean(projectProps.projectDirectory)}
        projectLabel={projectProps.projectLabel}
        onReturnToProjects={projectProps.onReturnToProjects ? () => void returnToProjects() : undefined}
        navigationDisabled={renaming || versionBusy || Boolean(aiSession) || transcribing}
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
        canUndo={canUndo}
        canRedo={canRedo}
        setFindOpen={setFindOpen}
        exportMenuOpen={exportMenuOpen}
        setExportMenuOpen={setExportMenuOpen}
        exportMenuRef={exportMenuRef}
        exportAs={exportAs}
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
          viewingOriginal={viewingOriginal}
          setFindOpen={setFindOpen}
          findNext={findNext}
          findPrev={findPrev}
          replaceCurrent={replaceCurrent}
          replaceAll={replaceAll}
        />
      )}
      {processNoticeText && activeStatus !== "ready" && !transcribing && activeStatus !== "error" && (
        <ProcessNotice
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

      {loadError && <div className="notice" role="alert">{uiMessage(loadError)} <CopyProblem /></div>}

      <div
        inert={renaming || saveStatus === "loading" || versionBusy}
        className={`workspace${preparingTranscript ? " workspace--transcription" : ""}${speakerPanelCollapsed ? " workspace--speaker-collapsed" : ""}${annotationPanelCollapsed ? " workspace--annotation-collapsed" : ""}`}
      >
        {!preparingTranscript && <SpeakerPanel
          speakers={transcript.speakers}
          hiddenSpeakerIds={hiddenSpeakerIds}
          viewingOriginal={viewingOriginal}
          mergeMenuFor={mergeMenuFor}
          setMergeMenuFor={setMergeMenuFor}
          mergeMenuRef={mergeMenuRef}
          collapsed={speakerPanelCollapsed}
          setCollapsed={setSpeakerPanelCollapsed}
          mutateTranscript={mutateTranscript}
          toggleHideSpeaker={toggleHideSpeaker}
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
          comparisonControls={<>
            <button type="button" className={`comparison-toggle${comparison.shown ? " is-active" : ""}`} aria-pressed={comparison.shown}
              disabled={viewingOriginal || !comparison.options.length || versionBusy} data-tip={msg('App.m0039', { v0: keys("Y",true) })} onClick={comparison.toggle}><span className="comparison-toggle-track" aria-hidden="true" /><span>{msg('App.m0040')}</span></button>
            {comparison.shown && <div className="comparison-source"><span>{msg('App.m0041')}</span>
              <VersionPicker key={`${selectedAudio}:comparison`} models={models} value={comparison.base} variant="comparison"
                excluded={currentVersionKey} disabled={versionBusy} onSelect={(model,edit)=>comparison.choose(`${model}:${edit}`)} onRename={renameVersion} />
            </div>}
            {comparison.loading && <span className="comparison-status" role="status">{msg('App.m0042')}</span>}
            {comparison.error && <span role="alert">{uiMessage(comparison.error)}</span>}
          </>}
          metadata={metadata}
          segmentCount={visibleSegments.length}
          viewingOriginal={viewingOriginal}
          activeModelId={activeModelId}
          versionControls={<VersionPicker key={`${selectedAudio}:current`} models={models} value={currentVersionKey} variant="current" disabled={versionBusy}
            onSelect={(model,edit)=>{if(edit==="original")void openOriginal(model);else void selectEdit(model,edit);}}
            onRename={renameVersion} onCopy={(model,edit)=>{if(edit==="original")void forkFromOriginal(model);else void duplicateEdit(model,edit);}}
            onDelete={(modelId,editId,label,isLast)=>setDeletePrompt({kind:editId==="original"?"original":"edit",modelId,editId:editId==="original"?undefined:editId,label,isLast})} />}
          patchMetadata={patch => {
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
        <section className="transcript-panel" ref={transcriptPanelRef} aria-label={msg('App.m0045')}>
          {followingPaused && isPlaying && (
            <button type="button" className="follow-resume" onClick={resumeFollow}>
              {msg('App.m0046')}</button>
          )}

          {preparingTranscript && transcriptionNotice}

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
          )) : <div className="segment-list">
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
                timeAligned={transcript.timeAligned}
                key={`${selectedAudio}:${activeEditKey}:${viewingOriginal}:${segment.id}`}
                segment={segment}
                comparisonBefore={before}
                comparisonBase={comparison.base}
                comparisonAccepted={before !== undefined && transcript.comparisonReviews?.[comparisonReviewKey(comparison.base,segment.id)]?.before === before ? transcript.comparisonReviews[comparisonReviewKey(comparison.base,segment.id)].accepted : undefined}
                {...segmentActions}
                index={segmentIndices.get(segment.id) ?? -1}
                totalSegments={transcript.segments.length}
                speakers={transcript.speakers}
                effectiveSelectedSegmentId={effectiveSelectedSegmentId === segment.id ? segment.id : ""}
                isPlaying={isPlaying}
                currentTime={currentTime}
                findQuery={viewingOriginal ? findQuery : ""}
                audioUrl={audioUrl}
                viewingOriginal={viewingOriginal}
                audioRef={audioRef}
                textareaRefs={textareaRefs}
                editingRef={editingRef}
              />
            ))}
          </div>}
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

        {saveToast && (
          <div className={`save-toast save-toast--${saveToast.kind}`} role="status">
            <span className="save-toast__dot" />
            {uiMessage(saveToast.text)}
            {saveToast.kind === "error" && <CopyProblem operation="save" />}
          </div>
        )}

        {!preparingTranscript && <AnnotationPanel
          transcript={transcript}
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
          setSelectedSegmentId={setSelectedSegmentId}
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
          onClose={() => setTranscriptionDialogOpen(false)}
          onStart={startTranscription}
        />
      )}

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
          confirmDelete={confirmDelete}
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

    </div>
  );
}

export default App;
