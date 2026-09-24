import { msg } from '../i18n';
import { useLayoutEffect, useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptManifest } from "../types";
import {
  type AudioFileEntry,
  type EditedFile,
  type StartPref,
  AUDIO_EXT_LABEL,
  addRecentFolder,
  findLegacyEntries,
  listAudioFiles,
  loadPreferredStartHandle,
  loadRecentFolders,
  loadStartPref,
  migrateAllLegacy,
  openFolder,
  readAudioUrl,
  readEdited,
  readManifest,
  savePreferredStartHandle,
  saveStartPref,
} from "../localStore";
import { ProjectMediaUnavailable } from "../lib/projectStore";
import { saveInterviewId } from "../lib/preferences";

/** 一次音频加载读到的原始数据（不含任何状态副作用，由调用方决定如何落盘）。 */
export interface LoadedAudio {
  url: string;
  manifest: TranscriptManifest | null;
  edited: EditedFile | null;
}

// 跨领域的状态更新通过回调注入——本 hook 只管文件夹与文件列表，
// 不碰 transcript / 版本 / 播放 / 保存状态。
export interface UseFolderDeps {
  /** Reject navigation before touching the current document; caller presents the reason. */
  canChangeDocument?: () => boolean;
  allowMissingMedia?: boolean;
  beforeChange?: () => Promise<void>;
  /** 开始加载：清错误、置加载态等。 */
  onLoadStart: () => void;
  /** 文件读完后的跨领域编排（播放 / transcript / 版本 / 元数据 / 进度）。 */
  onLoaded: (data: LoadedAudio, name: string) => Promise<void> | void;
  /** 加载成功收尾（如关闭首次加载标记）。 */
  onLoadEnd: () => void;
  /** 设置错误提示；fatal 表示加载彻底失败（同时把保存态置为 error）。 */
  onLoadError: (message: string, fatal?: boolean) => void;
  /** 清空错误提示（如重新打开文件夹前）。 */
  onClearError: () => void;
  /** 选中的文件夹里没有任何音频文件。 */
  onEmptyFolder: () => void;
  /** 旧格式迁移完成。 */
  onMigrated: (migratedCount: number, skippedCount: number) => void;
}

export function useFolder(deps: UseFolderDeps) {
  // deps 每次渲染都是新对象，用 ref 持有最新值，避免回调依赖数组膨胀导致重建。
  const depsRef = useRef(deps);
  useLayoutEffect(() => { depsRef.current = deps; }, [deps]);

  const loadRequest = useRef(0);
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [startPref, setStartPref] = useState<StartPref>({ type: "last" });
  const [preferredStartName, setPreferredStartName] = useState<string>("");
  const [recentFolders, setRecentFolders] = useState<FileSystemDirectoryHandle[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFileEntry[]>([]);
  const [legacyEntries, setLegacyEntries] = useState<AudioFileEntry[]>([]);
  const [migratingLegacy, setMigratingLegacy] = useState(false);
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const pref = await loadStartPref();
      setStartPref(pref);
      if (pref.type === "folder") {
        const h = await loadPreferredStartHandle();
        if (h) setPreferredStartName(h.name);
      }
      setRecentFolders(await loadRecentFolders());
    })();
  }, []);

  const refreshAudioList = useCallback(
    async (dir: FileSystemDirectoryHandle | null = dirHandleRef.current) => {
      if (!dir) return;
      try {
        const list = await listAudioFiles(dir);
        if (dir !== dirHandleRef.current) return;
        setAudioFiles(list);
        try {
          const legacy = await findLegacyEntries(dir, list);
          if (dir === dirHandleRef.current) setLegacyEntries(legacy);
        } catch {
          /* 扫描失败不阻断主列表，仅保留空集合 */
        }
      } catch {
        depsRef.current.onLoadError(msg('useFolder.m1116'));
      }
    },
    [],
  );

  const loadAudio = useCallback(
    async (name: string, skipSave = false, propagateError = false) => {
      const dir = dirHandleRef.current;
      if (!dir || depsRef.current.canChangeDocument?.() === false) return;
      const request = ++loadRequest.current;
      let loadedUrl: string | null = null;
      try {
        if (!skipSave) await depsRef.current.beforeChange?.();
        if (request !== loadRequest.current || depsRef.current.canChangeDocument?.() === false) return;
        depsRef.current.onLoadStart();
        let url = "";
        try { url = await readAudioUrl(dir, name); }
        catch (error) {
          if (!depsRef.current.allowMissingMedia || !(error instanceof ProjectMediaUnavailable)) throw error;
          if (error.message) depsRef.current.onLoadError(error.message);
        }
        loadedUrl = url;
        const manifest = await readManifest(dir, name);
        const edited = await readEdited(dir, name);
        if (request !== loadRequest.current || dir !== dirHandleRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        setSelectedAudio(name);
        saveInterviewId(name);
        await depsRef.current.onLoaded({ url, manifest, edited }, name);
        try {
          await refreshAudioList(dir);
        } catch {
          /* 列表刷新失败不应阻断音频载入 */
        }
        depsRef.current.onLoadEnd();
      } catch (error) {
        if (loadedUrl) URL.revokeObjectURL(loadedUrl);
        if (propagateError) throw error;
        if (request !== loadRequest.current) return;
        depsRef.current.onLoadEnd();
        depsRef.current.onLoadError(
          error instanceof Error ? error.message : msg('useFolder.m1117'),
          true,
        );
      }
    },
    [refreshAudioList],
  );

  const applyStartPref = async (pref: StartPref) => {
    setStartPref(pref);
    try {
      await saveStartPref(pref);
    } catch {
      /* 保存失败不影响本次会话使用 */
    }
  };

  const pickPreferredFolder = async () => {
    try {
      const picker = (window as unknown as {
        showDirectoryPicker: (o: { mode: string }) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker;
      const handle = await picker({ mode: "readwrite" });
      await savePreferredStartHandle(handle);
      setPreferredStartName(handle.name);
      await applyStartPref({ type: "folder" });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      depsRef.current.onLoadError(msg('useFolder.m1118'));
    }
  };

  const applyFolderHandle = async (handle: FileSystemDirectoryHandle) => {
    if (depsRef.current.canChangeDocument?.() === false) return;
    await depsRef.current.beforeChange?.();
    ++loadRequest.current;
    const list = await listAudioFiles(handle);
    if (depsRef.current.canChangeDocument?.() === false) return;
    const previous = dirHandleRef.current;
    depsRef.current.onLoadStart();
    dirHandleRef.current = handle;
    setDirHandle(handle);
    try {
      await addRecentFolder(handle);
      setRecentFolders(await loadRecentFolders());
    } catch { /* Recent-folder preferences do not prevent opening a document. */ }
    setAudioFiles(list);
    try {
      setLegacyEntries(await findLegacyEntries(handle, list));
    } catch {
      /* 扫描失败不影响主流程 */
    }
    if (list.length) {
      try {
        await loadAudio(list[0].name, true, true);
      } catch (error) {
        dirHandleRef.current = previous;
        setDirHandle(previous);
        await refreshAudioList(previous);
        depsRef.current.onLoadEnd();
        throw error;
      }
    } else {
      setSelectedAudio(null);
      depsRef.current.onEmptyFolder();
      depsRef.current.onLoadEnd();
    }
  };

  const handleOpenFolder = async () => {
    if (depsRef.current.canChangeDocument?.() === false) return;
    try {
      // 清空上一次的错误，避免过期的提示一直挂在界面上。
      depsRef.current.onClearError();
      const handle = await openFolder();
      await applyFolderHandle(handle);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
      depsRef.current.onLoadError(
        error instanceof Error ? error.message : msg('useFolder.m1119'),
      );
    }
  };

  const handleOpenRecentFolder = async (handle: FileSystemDirectoryHandle) => {
    if (depsRef.current.canChangeDocument?.() === false) return;
    try {
      depsRef.current.onClearError();
      // 跨会话后权限可能失效为 "prompt"；必须在用户手势（这里就是 click）
      // 内调 requestPermission，Chrome 会弹授权窗口；否则后续 getFileHandle 抛 SecurityError。
      const anyHandle = handle as unknown as {
        requestPermission?: (o: { mode: string }) => Promise<string>;
      };
      if (anyHandle.requestPermission) {
        const state = await anyHandle.requestPermission({ mode: "readwrite" });
        if (state !== "granted") {
          throw new Error(
            msg('useFolder.m1120'),
          );
        }
      }
      await applyFolderHandle(handle);
    } catch (error) {
      depsRef.current.onLoadError(
        error instanceof Error ? error.message : msg('useFolder.m1121'),
      );
    }
  };

  // 把根目录里残留的 `.edited.json` / `.transcript.json`（旧版）批量迁移到新的
  // `<stem>.transcript/manifest.json` 结构。每条独立迁移，失败的进 skipped 列表。
  const handleMigrateLegacy = async () => {
    const dir = dirHandleRef.current;
    if (!dir || legacyEntries.length === 0) return;
    setMigratingLegacy(true);
    try {
      const { migrated, skipped } = await migrateAllLegacy(dir, legacyEntries);
      await refreshAudioList(dir);
      depsRef.current.onMigrated(migrated.length, skipped.length);
    } catch (error) {
      depsRef.current.onLoadError(
        error instanceof Error ? error.message : msg('useFolder.m1122'),
      );
    } finally {
      setMigratingLegacy(false);
    }
  };

  return {
    dirHandle,
    dirHandleRef,
    startPref,
    preferredStartName,
    recentFolders,
    audioFiles,
    legacyEntries,
    migratingLegacy,
    selectedAudio,
    setSelectedAudio,
    refreshAudioList,
    loadAudio,
    applyStartPref,
    pickPreferredFolder,
    applyFolderHandle,
    handleOpenFolder,
    handleOpenRecentFolder,
    handleMigrateLegacy,
    supportedExtLabel: AUDIO_EXT_LABEL,
  };
}
