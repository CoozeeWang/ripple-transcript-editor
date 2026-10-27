import { msg } from '../i18n';
import { SUCCESS_FEEDBACK_MS, useTransientState } from './useTransientState';
import { recordProblem } from "../lib/diagnostics";
import { flushEditorDrafts, hasEditorDrafts } from "../lib/editorDrafts";
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import type {
  InterviewMetadata,
  Speaker,
  Transcript,
  TranscriptModel,
} from "../types";
import { type EditedFile, saveActiveEdit, saveInterviewDetails } from "../localStore";
import type { SaveStatus } from "./useTranscription";

/** 保存/持久化跨领域依赖：saveStatus 是全局共享核心（加载/转录/编辑都在写），
 *  保留在 App 由本 hook 通过 deps 读写；本 hook 只拥有 toast 与保存计时器。 */
export interface UsePersistenceDeps {
  /** Exact references published only after reading or successfully persisting a document. */
  persistedContent?: { transcript: Transcript; metadata: InterviewMetadata } | null;
  dirHandleRef: { current: FileSystemDirectoryHandle | null };
  initialLoadRef: { current: boolean };
  hasLoadedTranscript: boolean;
  viewingOriginal: boolean;
  selectedAudio: string | null;
  transcript: Transcript | null;
  metadata: InterviewMetadata | null;
  activeModelId: string | null;
  models: TranscriptModel[];
  saveStatus: SaveStatus;
  setSaveStatus: (s: SaveStatus) => void;
  setShuttingDown: (b: boolean) => void;
  saveAudioDraft?: (draft: { metadata: InterviewMetadata; speakers: Speaker[] }) => Promise<void>;
}

export function usePersistence(deps: UsePersistenceDeps) {
  const [saveToast, setSaveToast] = useTransientState<{
    kind: "error" | "ok";
    text: string;
  } | null>(null, null, value => value?.kind === 'ok' ? SUCCESS_FEEDBACK_MS : null);
  const [saveFailure, setSaveFailure] = useState("");
  const [previousSaveStatus, setPreviousSaveStatus] = useState<SaveStatus>("loading");

  const toastDirectory = deps.dirHandleRef.current;
  const toastEdit = deps.viewingOriginal ? 'original' : deps.models.find(model => model.id === deps.activeModelId)?.activeEditId;
  const toastDocument = useMemo(() => [toastDirectory, deps.selectedAudio, deps.activeModelId, toastEdit] as const,
    [toastDirectory, deps.selectedAudio, deps.activeModelId, toastEdit]);
  const previousToastDocument = useRef(toastDocument);
  const toastGeneration = useRef(0);
  useLayoutEffect(() => {
    if (toastDocument.every((value, index) => value === previousToastDocument.current[index])) return;
    previousToastDocument.current = toastDocument;
    toastGeneration.current++;
    if (saveToast !== null) setSaveToast(null);
    setSaveFailure('');
  }, [toastDocument, saveToast, setSaveToast]);

  const latest = useRef(deps);
  useLayoutEffect(() => { latest.current = deps; }, [deps]);
  type Snapshot = { dir: FileSystemDirectoryHandle; audio: string; model: string; edit: string; data: EditedFile };
  const pending = useRef<Snapshot | null>(null);
  const lastWritten = useRef<Snapshot | null>(null);
  const adoptedContent = useRef<UsePersistenceDeps["persistedContent"]>(null);
  const timer = useRef<number | null>(null);
  const writing = useRef<Promise<void>>(Promise.resolve());
  const snapshot = (): Snapshot | null => {
    const d = latest.current;
    if (!d.initialLoadRef.current && !d.hasLoadedTranscript && d.saveAudioDraft &&
        d.dirHandleRef.current && d.selectedAudio && d.transcript && d.metadata) {
      return { dir: d.dirHandleRef.current, audio: d.selectedAudio, model: "", edit: "draft",
        data: { kind: "te-edited", audio: d.selectedAudio, metadata: d.metadata, transcript: d.transcript } };
    }
    const edit = d.viewingOriginal ? "original" : d.models.find(m => m.id === d.activeModelId)?.activeEditId;
    if (d.initialLoadRef.current || !d.hasLoadedTranscript ||
        !d.dirHandleRef.current || !d.selectedAudio || !d.transcript || !d.metadata || !d.activeModelId || !edit) return null;
    return { dir: d.dirHandleRef.current, audio: d.selectedAudio, model: d.activeModelId, edit,
      data: { kind: "te-edited", audio: d.selectedAudio, metadata: d.metadata, transcript: d.transcript } };
  };
  const sameDocument = (a: Snapshot, b: Snapshot | null) => !!b &&
    a.dir === b.dir && a.audio === b.audio && a.model === b.model && a.edit === b.edit;
  const adoptLoadedContent = () => {
    const d = latest.current;
    if (d.initialLoadRef.current || !d.persistedContent || adoptedContent.current === d.persistedContent) return;
    adoptedContent.current = d.persistedContent;
    const task = snapshot();
    // A shared "saved" status is not evidence. Only the exact loaded pair can
    // establish a baseline; an edit made before load completion still needs saving.
    if (task && task.data.transcript === d.persistedContent.transcript &&
        task.data.metadata === d.persistedContent.metadata) lastWritten.current = task;
  };
  const unchanged = (task: Snapshot) => {
    const saved = lastWritten.current;
    return saved && sameDocument(task, saved) && task.data.transcript === saved.data.transcript &&
      task.data.metadata === saved.data.metadata;
  };
  const write = (task: Snapshot) => {
    const run = writing.current.catch(() => {}).then(async () => {
      if (!unchanged(task) && sameDocument(task, snapshot())) latest.current.setSaveStatus("saving");
      try {
        if (!unchanged(task)) {
          if (task.edit === "draft") await latest.current.saveAudioDraft?.({ metadata: task.data.metadata, speakers: task.data.transcript.speakers });
          else if (task.edit === "original") await saveInterviewDetails(task.dir,task.audio,task.data.metadata);
          else await saveActiveEdit(task.dir, task.audio, task.model, task.edit, task.data);
          if (task.edit !== "draft") await latest.current.saveAudioDraft?.({ metadata: task.data.metadata, speakers: task.data.transcript.speakers });
          lastWritten.current = task;
        }
        if (pending.current === task) {
          pending.current = null;
          latest.current.setSaveStatus(hasEditorDrafts() ? "unsaved" : "saved");
        }
      } catch (error) {
        recordProblem("save", error);
        const message=(error as {name?:string})?.name==="NotAllowedError"
          ? msg('usePersistence.m1131')
          : error instanceof Error ? error.message : msg('usePersistence.m1132');
        // A failed write remains actionable and blocks navigation; it is not a disposable query receipt.
        setSaveFailure(message);
        setSaveToast({kind:"error",text:msg('usePersistence.m1133', { v0: message })});
        latest.current.setSaveStatus("error");
        throw error;
      }
    });
    writing.current = run;
    return run;
  };
  const flushPendingSave = async () => {
    for (;;) {
      flushEditorDrafts();
      adoptLoadedContent();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      const task = snapshot();
      if (!task) { await writing.current; return; }
      pending.current = task;
      await write(task);
      const current = snapshot();
      if (!sameDocument(task, current)) return;
      if (!hasEditorDrafts() && task.data.transcript === current?.data.transcript &&
          task.data.metadata === current?.data.metadata) return;
    }
  };

  useEffect(() => {
    adoptLoadedContent();
    const task = snapshot();
    const previous = pending.current;
    // A document replacement must not discard its outstanding snapshot.
    if (previous && !sameDocument(previous, task)) void write(previous).catch(() => {});
    pending.current = task && !unchanged(task) ? task : null;
    if (!pending.current || !task) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void write(task).catch(() => {});
    }, 600);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    // Values below identify both the document and the content to save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.transcript, deps.metadata, deps.selectedAudio, deps.activeModelId,
      deps.models, deps.viewingOriginal, deps.hasLoadedTranscript, deps.persistedContent]);

  useEffect(() => {
    const dirty = () => { latest.current.setSaveStatus("unsaved"); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasEditorDrafts() || pending.current || latest.current.saveStatus === "error") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("te:draft-dirty", dirty);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("te:draft-dirty", dirty);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  // 在状态变化的同一次渲染中更新提示，避免 effect 再触发一轮同步渲染。
  if (previousSaveStatus !== deps.saveStatus) {
    setPreviousSaveStatus(deps.saveStatus);
    if (deps.saveStatus === "error") {
      setSaveToast({ kind: "error", text: msg('usePersistence.m1134', { v0: saveFailure || msg('usePersistence.m1135') }) });
    } else if (deps.saveStatus === "saved" &&
      (previousSaveStatus === "error" || previousSaveStatus === "saving")) {
      setSaveToast({ kind: "ok", text: previousSaveStatus === "error" ? msg('usePersistence.m1136') : msg('usePersistence.m1137') });
    }
  }

  const handleSave = async () => {
    if (!snapshot()) { setSaveToast({kind:"error",text:msg('usePersistence.m1138')}); return; }
    const owner = toastGeneration.current;
    try {
      await flushPendingSave();
      if (owner === toastGeneration.current) setSaveToast({kind:"ok",text:msg('usePersistence.m1139')});
    } catch {
      latest.current.setSaveStatus("error");
    }
  };
  useEffect(() => {
    const onSave = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;
      // A dialog owns its drafts; do not save the transcript behind it.
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      void handleSave();
    };
    window.addEventListener("keydown", onSave);
    return () => window.removeEventListener("keydown", onSave);
  });

  return {
    flushPendingSave,
    saveToast,
    setSaveToast,
    handleSave,
  };
}
