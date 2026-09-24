import { msg } from '../i18n';
import { recordProblem } from "../lib/diagnostics";
import { flushEditorDrafts } from "../lib/editorDrafts";
import { applyAISuggestions, type AISuggestion } from "../lib/aiEditing";
import { useLayoutEffect, useRef, useState } from "react";
import { useDismissable } from "../useDismissable";
import type {
  InterviewMetadata,
  Transcript,
  TranscriptManifest,
  TranscriptModel,
} from "../types";
import {
  createEdit,
  persistActiveModel,
  readManifest,
  readModelEdit,
  readModelOriginal,
  removeEdit,
  removeModelOriginal,
  renameEditLabel,
  renameModelLabel,
  saveActiveEdit,
} from "../localStore";

export type ProcessStatus =
  | "idle"
  | "uploading"
  | "ready"
  | "transcribing"
  | "done"
  | "error";

/** 重命名弹窗的目标：给某个模型改名，或给某份修改稿改名。 */
export interface NamingTarget {
  kind: "model" | "edit" | "create";
  fromOriginal?: boolean;
  srcEditId?: string;
  modelId: string;
  editId?: string;
}

/** 删除确认弹窗：删修改稿 / 原稿；isLast 表示这是该模型最后一份内容。 */
export interface DeletePrompt {
  kind: "edit" | "original";
  modelId: string;
  editId?: string;
  label: string;
  isLast: boolean;
}

/** 版本管理跨领域依赖：本 hook 只拥有 models/activeModelId 与版本弹窗状态，
 *  不碰 transcript / 元数据 / 播放 / 进度，改它们通过回调注入解耦。 */
export interface UseVersionsDeps {
  beforeChange?: () => Promise<void>;
  dirHandleRef: { current: FileSystemDirectoryHandle | null };
  selectedAudio: string | null;
  transcript: Transcript | null;
  metadata: InterviewMetadata | null;
  reset: (t: Transcript) => void;
  setMetadata: (m: InterviewMetadata | null) => void;
  setSelectedSegmentId: (id: string) => void;
  setHasLoadedTranscript: (b: boolean) => void;
  setViewingOriginal: (b: boolean) => void;
  viewingOriginal: boolean;
  setImportRepairs: (r: string[]) => void;
  setProcessStatus: (s: ProcessStatus) => void;
  setProcessMessage: (m: string) => void;
}

export function useVersions(deps: UseVersionsDeps) {
  const operationRef = useRef(0);
  const mutationRef = useRef(false);
  const [versionBusy, setVersionBusy] = useState(false);
  const [models, setModels] = useState<TranscriptModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [namingOpen, setNamingOpen] = useState(false);
  const [namingValue, setNamingValue] = useState("");
  const [namingTarget, setNamingTarget] = useState<NamingTarget | null>(null);
  const [namingError, setNamingError] = useState<string | null>(null);
  const [namingBusy, setNamingBusy] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null);
  const namingRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLDivElement>(null);

  // 命名窗口仅用取消或 Esc 关闭，避免误点遮罩丢失正在填写的名称。
  useDismissable(namingRef, namingOpen, () => setNamingOpen(false), false);
  useDismissable(deleteRef, Boolean(deletePrompt), () => setDeletePrompt(null));

  const activeModel = models.find((m) => m.id === activeModelId) ?? null;
  const activeEditKey = activeModel
    ? `edit:${activeModel.id}:${activeModel.activeEditId}`
    : "";

  /** 供 loadAudio 的 onLoaded 与转录成功等上层使用：整体替换 models / activeModelId。 */
  const applyManifest = (
    manifest: TranscriptManifest | null,
    modelId?: string | null,
  ) => {
    ++operationRef.current;
    setVersionBusy(false);
    setNamingOpen(false); setNamingTarget(null); setDeletePrompt(null);
    if (!manifest) {
      setModels([]);
      setActiveModelId(null);
      return;
    }
    setModels(manifest.models);
    setActiveModelId(modelId ?? manifest.activeModelId ?? null);
  };

  /**
   * 把内存中的当前内容写回「激活模型的激活修改稿」。
   *
   * 只读模式（viewingOriginal）下必须直接跳过：那时 deps.transcript 里装的是引擎原稿，
   * 写回就会把修改稿文件覆盖成原稿内容——表现为「切到原稿再切回来，改动全没了」。
   */
  const latest = useRef(deps);
  useLayoutEffect(() => { latest.current = deps; }, [deps]);
  const flushActiveEdit = async () => {
    if (latest.current.beforeChange) return latest.current.beforeChange();
    flushEditorDrafts();
    const deps = latest.current;
    const dir = deps.dirHandleRef.current;
    if (!dir || !deps.selectedAudio) return;
    if (deps.viewingOriginal) return;
    if (!activeModelId || !deps.transcript || !deps.metadata) return;
    const cur = models.find((m) => m.id === activeModelId);
    const curEdit = cur?.edits.find((e) => e.id === cur.activeEditId);
    if (!cur || !curEdit) return;
    try {
      await saveActiveEdit(dir, deps.selectedAudio, activeModelId, curEdit.id, {
        kind: "te-edited",
        audio: deps.selectedAudio,
        metadata: deps.metadata,
        transcript: deps.transcript,
      });
    } catch (error) {
        recordProblem("version", error);
      deps.setProcessStatus("error");
      deps.setProcessMessage(msg('useVersions.m1184'));
      throw error;
    }
  };

  const selectEdit = async (modelId: string, editId: string) => {
    if (models.find(m => m.id === modelId)?.designatedOriginal) { await openOriginal(modelId); return; }
    const request = operationRef.current;
    const dir = deps.dirHandleRef.current;
    const isCurrent = () => request === operationRef.current && dir === latest.current.dirHandleRef.current && deps.selectedAudio === latest.current.selectedAudio;
    if (!dir || !deps.selectedAudio) return;
    // 先 flush 当前编辑到旧修改稿，避免切换时丢失（只读模式下不 flush，见 flushActiveEdit）
    await flushActiveEdit();
    if (!isCurrent()) return;
    const edited = await readModelEdit(dir, deps.selectedAudio, modelId, editId);
    if (!edited) return;
    const manifest = await readManifest(dir, deps.selectedAudio);
    // readManifest 读到的是 persistActiveModel 之前的值：manifest.models 里
    // activeEditId 还是旧修改稿。若直接 setModels，顶栏版本名会滞后一次
    // （内容已切换、名字没变 → 看起来「要操作两次才切成功」）。
    // 因此把目标修改稿的 activeEditId 就地修正后再写入状态。
    const nextModels = (manifest?.models ?? []).map((m) =>
      m.id === modelId ? { ...m, activeEditId: editId } : m,
    );
    if (!isCurrent()) return;
    if (manifest) await persistActiveModel(dir, deps.selectedAudio, modelId, editId);
    if (!isCurrent()) return;
    setModels(nextModels);
    setActiveModelId(modelId);
    deps.setMetadata(edited.metadata);
    deps.reset(edited.transcript);
    deps.setSelectedSegmentId(edited.transcript.segments[0]?.id ?? "");
    deps.setHasLoadedTranscript(true);
    deps.setViewingOriginal(false);
    deps.setProcessStatus("done");
    deps.setProcessMessage(msg('useVersions.m1185'));
  };

  const openOriginal = async (modelId: string) => {
    const request = operationRef.current;
    const dir = deps.dirHandleRef.current;
    const isCurrent = () => request === operationRef.current && dir === latest.current.dirHandleRef.current && deps.selectedAudio === latest.current.selectedAudio;
    if (!dir || !deps.selectedAudio) return;
    // 切到原稿前先把内存里的修改落盘：自动保存有 600ms 防抖，而 viewingOriginal 置 true
    // 会让防抖 effect 直接 return（清掉待执行的定时器），未落盘的改动就此丢失。
    await flushActiveEdit();
    if (!isCurrent()) return;
    const original = await readModelOriginal(dir, deps.selectedAudio, modelId);
    if (!original || !isCurrent()) return;
    setActiveModelId(modelId);
    // 原稿 JSON 不存元数据，沿用当前 metadata（描述同一段音频）
    deps.reset(original.transcript);
    deps.setSelectedSegmentId(original.transcript.segments[0]?.id ?? "");
    deps.setHasLoadedTranscript(true);
    deps.setViewingOriginal(true);
    deps.setProcessStatus("done");
    deps.setProcessMessage(msg('useVersions.m1186'));
  };

  const forkFromOriginal = async (modelId: string) => {
    setNamingTarget({ kind: "create", modelId, fromOriginal: true });
    setNamingValue(""); setNamingError(null); setNamingOpen(true);
  };

  const duplicateEdit = async (modelId: string, srcEditId?: string) => {
    setNamingTarget({ kind: "create", modelId, srcEditId });
    setNamingValue(""); setNamingError(null); setNamingOpen(true);
  };

  /** Publish reviewed suggestions in one new version; the source remains untouched. */
  const createAIEdit = async (baseline: Transcript, suggestions: AISuggestion[], label: string) => {
    if (versionBusy || !activeModel) {
      throw new Error(msg('useVersions.m1187'));
    }
    const request = ++operationRef.current;
    const dir = deps.dirHandleRef.current;
    const audio = deps.selectedAudio;
    if (!dir || !audio) throw new Error(msg('useVersions.m1188'));
    const isCurrent = () => request === operationRef.current && dir === latest.current.dirHandleRef.current && audio === latest.current.selectedAudio && latest.current.viewingOriginal === deps.viewingOriginal;
    setVersionBusy(true);
    try {
      await flushActiveEdit();
      if (!isCurrent() || !latest.current.transcript) throw new Error(msg('useVersions.m1189'));
      const transcript = applyAISuggestions(latest.current.transcript, baseline, suggestions);
      const result = await createEdit(dir, audio, activeModel.id, {
        fromOriginal: deps.viewingOriginal,
        srcEditId: deps.viewingOriginal ? undefined : activeModel.activeEditId,
        reviewed: { baseline, transcript, label: label.slice(0, 100) },
      });
      if (!isCurrent()) return;
      setModels(result.manifest.models);
      setActiveModelId(result.model.id);
      deps.setMetadata(result.edited.metadata);
      deps.reset(result.edited.transcript);
      deps.setSelectedSegmentId(transcript.lastEditedSegmentId ?? transcript.segments[0]?.id ?? "");
      deps.setHasLoadedTranscript(true);
      deps.setProcessStatus("done");
      deps.setViewingOriginal(false);
      deps.setProcessMessage(msg('useVersions.m1190'));
      return result;
    } finally {
      if (request === operationRef.current) setVersionBusy(false);
    }
  };

  const confirmNaming = async (value = namingValue) => {
    if (mutationRef.current) return;
    const dir = deps.dirHandleRef.current;
    if (!dir || !deps.selectedAudio || !namingTarget) {
      setNamingOpen(false);
      return;
    }
    const request = ++operationRef.current;
    const isCurrent = () => request === operationRef.current && dir === latest.current.dirHandleRef.current && deps.selectedAudio === latest.current.selectedAudio;
    mutationRef.current = true;
    setVersionBusy(true); setNamingBusy(true);
    setNamingError(null);
    try {
      await flushActiveEdit();
      if (!isCurrent()) return;
      const label = value.trim();
      if (!label) throw new Error(msg('useVersions.m1191'));
      if (namingTarget.kind === "create") {
        const result = await createEdit(dir, deps.selectedAudio, namingTarget.modelId, {
          fromOriginal: namingTarget.fromOriginal, srcEditId: namingTarget.srcEditId, label,
        });
        if (!isCurrent()) return;
        setModels(result.manifest.models); setActiveModelId(result.model.id);
        deps.setMetadata(result.edited.metadata); deps.reset(result.edited.transcript);
        deps.setSelectedSegmentId(result.edited.transcript.segments[0]?.id ?? "");
        deps.setHasLoadedTranscript(true); deps.setViewingOriginal(false);
        setNamingOpen(false); return;
      }
      const manifest =
        namingTarget.kind === "model"
          ? await renameModelLabel(dir, deps.selectedAudio, namingTarget.modelId, label)
          : await renameEditLabel(
              dir,
              deps.selectedAudio,
              namingTarget.modelId,
              namingTarget.editId ?? "",
              label,
            );
      if (!isCurrent()) return;
      if (!manifest) {
        setNamingOpen(false);
        return;
      }
      setModels(manifest.models);
      deps.setImportRepairs([]);
      setNamingOpen(false);
    } catch (error) {
        recordProblem("version", error);
      // 任何异常都暴露给用户，而不是让弹窗卡住"点了没反应"。
      if (isCurrent()) setNamingError(error instanceof Error ? error.message : msg('useVersions.m1192'));
    } finally {
      mutationRef.current = false;
      setNamingBusy(false);
      if (request === operationRef.current) setVersionBusy(false);
    }
  };

  const renameVersion = async (modelId: string, editId: string, value: string) => {
    const dir = deps.dirHandleRef.current;
    const audio = deps.selectedAudio;
    const label = value.trim();
    if (!label) throw new Error(msg('useVersions.m1193'));
    if (!dir || !audio || mutationRef.current) throw new Error(msg('useVersions.m1194'));
    const request = ++operationRef.current;
    const isCurrent = () => request === operationRef.current && dir === latest.current.dirHandleRef.current && audio === latest.current.selectedAudio;
    mutationRef.current = true;
    setVersionBusy(true);
    try {
      await flushActiveEdit();
      if (!isCurrent()) throw new Error(msg('useVersions.m1195'));
      const manifest = editId === "model-name" ? await renameModelLabel(dir, audio, modelId, label) : await renameEditLabel(dir, audio, modelId, editId, label);
      if (!manifest) throw new Error(msg('useVersions.m1196'));
      if (isCurrent()) setModels(manifest.models);
    } catch (error) {
      recordProblem("version", error);
      throw error;
    } finally {
      mutationRef.current = false;
      if (request === operationRef.current) setVersionBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletePrompt || mutationRef.current) return;
    const dir = deps.dirHandleRef.current, audio = deps.selectedAudio;
    if (!dir || !audio) return;
    const { kind, modelId, editId } = deletePrompt;
    const request = ++operationRef.current;
    const isCurrent = () => request === operationRef.current && dir === latest.current.dirHandleRef.current && audio === latest.current.selectedAudio;
    mutationRef.current = true; setVersionBusy(true);
    try {
      await flushActiveEdit();
      if (!isCurrent()) return;
      const manifest = kind === "edit" && editId
        ? await removeEdit(dir, audio, modelId, editId)
        : kind === "original" ? await removeModelOriginal(dir, audio, modelId) : null;
      if (!isCurrent()) return;
      if (!manifest) { setDeletePrompt(null); return; }
      const removedCurrent = activeModelId === modelId && (deps.viewingOriginal
        ? kind === "original" : kind === "edit" && editId === activeModel?.activeEditId);
      // Read the fallback before publishing its ID. Otherwise autosave can write
      // the old manuscript into the newly selected file while this read awaits.
      let replacement: {transcript: Transcript; metadata?: InterviewMetadata; modelId: string; original: boolean} | null = null;
      if (removedCurrent && manifest.models.length) {
        const model = manifest.models.find(m => m.id === manifest.activeModelId) ?? manifest.models[0];
        const edit = model.edits.find(e => e.id === model.activeEditId) ?? model.edits[0];
        if (edit) {
          const data = await readModelEdit(dir, audio, model.id, edit.id);
          if (!data) throw new Error(msg('useVersions.m1197'));
          replacement = {...data, modelId: model.id, original: false};
        } else if (model.original) {
          const data = await readModelOriginal(dir, audio, model.id);
          if (!data) throw new Error(msg('useVersions.m1198'));
          replacement = {...data, modelId: model.id, original: true};
        }
      }
      if (!isCurrent()) return;
      setModels(manifest.models);
      if (replacement) {
        setActiveModelId(replacement.modelId);
        if (replacement.metadata) deps.setMetadata(replacement.metadata);
        deps.reset(replacement.transcript);
        deps.setSelectedSegmentId(replacement.transcript.segments[0]?.id ?? "");
        deps.setHasLoadedTranscript(true); deps.setViewingOriginal(replacement.original);
        deps.setProcessMessage(replacement.original ? msg('useVersions.m1199') : msg('useVersions.m1200'));
      } else if (!manifest.models.length) {
        setActiveModelId(null); deps.setHasLoadedTranscript(false); deps.setViewingOriginal(false);
      }
      setDeletePrompt(null);
    } catch (error) {
        recordProblem("version", error);
      if (isCurrent()) {
        setDeletePrompt(null); deps.setProcessStatus("error");
        deps.setProcessMessage(error instanceof Error ? error.message : msg('useVersions.m1201'));
      }
    } finally {
      mutationRef.current = false;
      if (request === operationRef.current) setVersionBusy(false);
    }
  };

  const runVersionAction = <Args extends unknown[]>(action: (...args: Args) => Promise<void>) =>
    async (...args: Args) => {
      if (mutationRef.current) return;
      const request = ++operationRef.current;
      setVersionBusy(true);
      try { await action(...args); } catch (error) {
        recordProblem("version", error);
        if (request !== operationRef.current) return;
        deps.setProcessStatus("error");
        deps.setProcessMessage(error instanceof Error ? error.message : msg('useVersions.m1202'));
      } finally {
        if (request === operationRef.current) setVersionBusy(false);
      }
    };

  return {
    renameVersion,
    createAIEdit,
    versionBusy,
    models,
    activeModelId,
    activeModel,
    activeEditKey,
    namingOpen,
    setNamingOpen,
    namingValue,
    setNamingValue,
    namingTarget,
    setNamingTarget,
    namingError,
    setNamingError,
    namingBusy,
    namingRef,
    deletePrompt,
    setDeletePrompt,
    deleteRef,
    applyManifest,
    selectEdit: (...args: Parameters<typeof selectEdit>) => runVersionAction(selectEdit)(...args),
    openOriginal: (...args: Parameters<typeof openOriginal>) => runVersionAction(openOriginal)(...args),
    forkFromOriginal: (...args: Parameters<typeof forkFromOriginal>) => runVersionAction(forkFromOriginal)(...args),
    duplicateEdit: (...args: Parameters<typeof duplicateEdit>) => runVersionAction(duplicateEdit)(...args),
    confirmNaming,
    confirmDelete,
  };
}
