import { msg } from '../i18n';
import { recordProblem } from "../lib/diagnostics";
import { flushEditorDrafts, hasEditorDrafts } from "../lib/editorDrafts";
import { useLayoutEffect, useEffect, useRef, useState } from "react";
import type {
  InterviewMetadata,
  Transcript,
  TranscriptModel,
} from "../types";
import { type EditedFile, saveActiveEdit, saveInterviewDetails } from "../localStore";
import type { SaveStatus } from "./useTranscription";

/** 保存/持久化跨领域依赖：saveStatus 是全局共享核心（加载/转录/编辑都在写），
 *  保留在 App 由本 hook 通过 deps 读写；本 hook 只拥有 toast 与保存计时器。 */
export interface UsePersistenceDeps {
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
}

export function usePersistence(deps: UsePersistenceDeps) {
  const [saveToast, setSaveToast] = useState<{
    kind: "error" | "ok";
    text: string;
  } | null>(null);
  const [saveFailure, setSaveFailure] = useState("");
  const [previousSaveStatus, setPreviousSaveStatus] = useState<SaveStatus>("loading");

  const latest = useRef(deps);
  useLayoutEffect(() => { latest.current = deps; }, [deps]);
  type Snapshot = { dir: FileSystemDirectoryHandle; audio: string; model: string; edit: string; data: EditedFile };
  const pending = useRef<Snapshot | null>(null);
  const lastWritten = useRef<Snapshot | null>(null);
  const timer = useRef<number | null>(null);
  const writing = useRef<Promise<void>>(Promise.resolve());
  const snapshot = (): Snapshot | null => {
    const d = latest.current;
    const edit = d.viewingOriginal ? "original" : d.models.find(m => m.id === d.activeModelId)?.activeEditId;
    if (d.initialLoadRef.current || !d.hasLoadedTranscript ||
        !d.dirHandleRef.current || !d.selectedAudio || !d.transcript || !d.metadata || !d.activeModelId || !edit) return null;
    return { dir: d.dirHandleRef.current, audio: d.selectedAudio, model: d.activeModelId, edit,
      data: { kind: "te-edited", audio: d.selectedAudio, metadata: d.metadata, transcript: d.transcript } };
  };
  const sameDocument = (a: Snapshot, b: Snapshot | null) => !!b &&
    a.dir === b.dir && a.audio === b.audio && a.model === b.model && a.edit === b.edit;
  const write = (task: Snapshot) => {
    const run = writing.current.catch(() => {}).then(async () => {
      if (sameDocument(task, snapshot())) latest.current.setSaveStatus("saving");
      try {
        const saved = lastWritten.current;
        const unchanged = saved && sameDocument(task, saved) &&
          task.data.transcript === saved.data.transcript && task.data.metadata === saved.data.metadata;
        if (!unchanged) {
          if (task.edit === "original") await saveInterviewDetails(task.dir,task.audio,task.data.metadata);
          else await saveActiveEdit(task.dir, task.audio, task.model, task.edit, task.data);
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
    const task = snapshot();
    const previous = pending.current;
    // A document replacement must not discard its outstanding snapshot.
    if (previous && !sameDocument(previous, task)) void write(previous).catch(() => {});
    pending.current = task;
    if (!task) return;
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
      deps.models, deps.viewingOriginal, deps.hasLoadedTranscript]);

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

  useEffect(() => {
    if (saveToast?.kind !== "ok") return;
    const timeout = window.setTimeout(() => setSaveToast(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [saveToast]);

  const handleSave = async () => {
    if (!snapshot()) { setSaveToast({kind:"error",text:msg('usePersistence.m1138')}); return; }
    try {
      await flushPendingSave();
      setSaveToast({kind:"ok",text:msg('usePersistence.m1139')});
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
