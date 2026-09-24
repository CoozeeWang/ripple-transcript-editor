import { apiErrorMessage } from './i18n/errors';
import { msg } from './i18n';
import { chooseDirectory } from './lib/projectPreferences';
import { decodeNativeHandles, encodeNativeHandles, nativeDesktopAvailable } from './lib/desktopFs';
import { readRecoverableManifest, writeRecoverableManifest } from "./lib/manifestRecovery";
import { stripStubFirstFrame } from "./lib/adts";
import { restoreTranscriptOrigins, seedOriginalOrigins } from "./lib/transcriptOrigins";
import type {
  InterviewMetadata,
  Transcript,
  TranscriptEdit,
  TranscriptModel,
  TranscriptionOptions,
  TranscriptVersion,
  TranscriptManifest,
} from "./types";

const TRANSCRIPT_DIR_SUFFIX = ".transcript";
const MANIFEST_NAME = "manifest.json";

/**
 * 能出现在音频列表里的扩展名。三条硬标准：浏览器能解码、ElevenLabs 能收、
 * 现实里真有人用。据此剔掉了 wma / amr（浏览器和 ElevenLabs 两边都不支持，
 * 列出来只会让人选了却播不了、传不了）以及少见的 m4p / aiff / aif。
 */
export const AUDIO_EXT = [
  "mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac",
  "webm", "mp4", "m4v", "mov", "m4b", "3gp", "mkv",
];

/** 提示文案里列举给用户看的主流格式（不必穷举，挑最常见的几个）。 */
export const AUDIO_EXT_LABEL = "mp3 / wav / m4a / mp4 / mov / flac / ogg / opus / 3gp";

export function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function fileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** 把内部 engine 标识转成人话显示名（未自定义 label 时的兜底）。 */
export function displayEngineLabel(engine: string): string {
  if (engine === "imported") return "外部导入";
  if (engine === "funasr") return "FunASR";
  return engine.replace(/\s*·\s*分段合并\s*$/, "");
}

/** 修改稿默认显示名（index 从 0 起）。 */
export function defaultEditLabel(index: number): string {
  return `修改稿 v${index + 1}`;
}

/** 模型默认显示名（未自定义 label 时）。 */
export function defaultModelLabel(engine: string): string {
  return displayEngineLabel(engine);
}

export interface AudioFileEntry {
  name: string;
  hasOriginal: boolean;
  hasEdited: boolean;
}

export interface EditedFile {
  kind: "te-edited";
  audio: string;
  metadata: InterviewMetadata;
  transcript: Transcript;
}

export function defaultMetadata(stem: string): InterviewMetadata {
  const now = new Date().toISOString();
  return {
    id: stem,
    title: stem,
    recorded_at: null,
    location: "",
    participants: [],
    topics: [],
    notes: "",
    created_at: now,
    updated_at: now,
  };
}

// ---- IndexedDB persistence of the directory handle ---------------------------

const DB_NAME = "te-local-store";
const STORE = "handles";
const HANDLE_KEY = "folder";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(nativeDesktopAvailable() ? encodeNativeHandles(handle) : handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(nativeDesktopAvailable() ? decodeNativeHandles((req.result as FileSystemDirectoryHandle) ?? null) : (req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!handle) return null;
    // Chrome 句柄在跨会话后必须是 'granted' 才可用。'prompt' 状态需要用户手势才能
    // requestPermission，否则后续 getFileHandle 全部抛 SecurityError，导致 UI 死在加载屏。
    // 这里仅放行 'granted'，其他情况一律返回 null，让用户走按钮显式重新选择。
    const anyHandle = handle as unknown as {
      queryPermission?: (o: { mode: string }) => Promise<string>;
    };
    if (anyHandle.queryPermission) {
      const state = await anyHandle.queryPermission({ mode: "readwrite" });
      if (state !== "granted") return null;
    }
    return handle;
  } catch {
    return null;
  }
}

// ---- 首次打开文件夹的起始位置偏好 ----------------------------------------------

export type StartPref =
  | { type: "last" }
  | { type: "folder" }
  | { type: "wellknown"; dir: WellKnownDirectory };

export const DEFAULT_START_PREF: StartPref = { type: "last" };

const START_PREF_KEY = "startPref";
const PREFERRED_START_HANDLE_KEY = "preferredStartHandle";
const RECENT_FOLDERS_KEY = "recentFolders";

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(nativeDesktopAvailable() ? encodeNativeHandles(value) : value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(nativeDesktopAvailable() ? decodeNativeHandles((req.result as T) ?? null) : (req.result as T) ?? null);
      req.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadStartPref(): Promise<StartPref> {
  try {
    const raw = await idbGet<StartPref>(START_PREF_KEY);
    if (raw && (raw.type === "last" || raw.type === "folder" || raw.type === "wellknown")) {
      return raw;
    }
  } catch {
    /* 读取失败则回退到默认 */
  }
  return DEFAULT_START_PREF;
}

export async function saveStartPref(pref: StartPref): Promise<void> {
  await idbPut(START_PREF_KEY, pref);
}

export async function loadPreferredStartHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await idbGet<FileSystemDirectoryHandle>(PREFERRED_START_HANDLE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function savePreferredStartHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbPut(PREFERRED_START_HANDLE_KEY, handle);
}

/** 读取最近打开的文件夹列表。
 *  不主动按 queryPermission 过滤：跨会话后权限可能变成 "prompt"，
 *  交给 UI 在点击时调 requestPermission 重新激活（Chrome 会弹授权窗口）。
 *  若主动过滤，用户重启后会看到「暂无最近打开」而不知原因。 */
export async function loadRecentFolders(): Promise<FileSystemDirectoryHandle[]> {
  try {
    const list = (await idbGet<FileSystemDirectoryHandle[]>(RECENT_FOLDERS_KEY)) ?? [];
    return list;
  } catch {
    return [];
  }
}

/** 把新打开的文件夹加入最近列表（去重，保留最近 5 个）。 */
export async function addRecentFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const existing = await loadRecentFolders();
    const next = [handle, ...existing.filter((h) => h.name !== handle.name)].slice(0, 5);
    await idbPut(RECENT_FOLDERS_KEY, next);
  } catch {
    /* 最近列表写入失败不应阻断主流程 */
  }
}

/** 清空最近打开列表。 */
export async function clearRecentFolders(): Promise<void> {
  try {
    await idbPut(RECENT_FOLDERS_KEY, []);
  } catch {
    /* ignore */
  }
}

// 用户上一次选择的转录引擎（仅本地偏好，不写入项目）。
const SELECTED_PROVIDER_KEY = "selectedProviderId";

export function loadSelectedProviderId(): string | null {
  try {
    return localStorage.getItem(SELECTED_PROVIDER_KEY);
  } catch {
    return null;
  }
}

export function saveSelectedProviderId(id: string): void {
  try {
    localStorage.setItem(SELECTED_PROVIDER_KEY, id);
  } catch {
    /* 隐私模式等场景下写入失败不应阻断主流程 */
  }
}

// Chrome 的 WellKnownDirectory 枚举（与 lib.dom.d.ts 一致）
type WellKnownDirectory =
  | "desktop"
  | "documents"
  | "downloads"
  | "music"
  | "pictures"
  | "videos";

export async function openFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await chooseDirectory('open-audio-folder');
  await persistHandle(handle);
  return handle;
}

// ---- Folder enumeration & sibling detection ----------------------------------

async function hasSidecar(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await (dir as unknown as {
      getFileHandle: (n: string) => Promise<unknown>;
    }).getFileHandle(name);
    return true;
  } catch (error) {
    if ((error as { name?: string }).name !== "NotFoundError") throw error;
    return false;
  }
}

async function dirExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await (dir as unknown as {
      getDirectoryHandle: (n: string) => Promise<unknown>;
    }).getDirectoryHandle(name);
    return true;
  } catch (error) {
    if ((error as { name?: string }).name !== "NotFoundError") throw error;
    return false;
  }
}

/** 取得 `<stem>.transcript` 旁挂目录句柄；不存在时按 create 决定返回 null 或新建。 */
async function getTranscriptDirHandle(
  dir: FileSystemDirectoryHandle,
  stem: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (dir as unknown as {
      getDirectoryHandle: (n: string, o?: { create: boolean }) => Promise<FileSystemDirectoryHandle>;
    }).getDirectoryHandle(`${stem}${TRANSCRIPT_DIR_SUFFIX}`, { create });
  } catch (error) {
    if ((error as { name?: string }).name !== "NotFoundError") throw error;
    return null;
  }
}

// ---- 关联解析：以音频指纹（大小 + 前 64KB 哈希）而非文件名词干来定位转录 ----
// 这样即使在 Finder 里改了音频名、或转录文件用了旧命名，也能正确关联。

const fingerprintCache = new WeakMap<FileSystemDirectoryHandle, Map<string, string>>();
const resolveCache = new WeakMap<FileSystemDirectoryHandle, Map<string, FileSystemDirectoryHandle | null>>();
const scanCache = new WeakMap<FileSystemDirectoryHandle, ScannedContainer[]>();

interface ScannedContainer {
  dir: FileSystemDirectoryHandle;
  manifest: TranscriptManifest;
}

async function audioFingerprint(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const cached = fingerprintCache.get(dir)?.get(name);
  if (cached) return cached;
  const fileHandle = await (dir as unknown as {
    getFileHandle: (n: string) => Promise<{ getFile: () => Promise<File> }>;
  }).getFileHandle(name);
  const file = await fileHandle.getFile();
  const head = await file.slice(0, 65536).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", head);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const fp = `${file.size}:${hex}`;
  let map = fingerprintCache.get(dir);
  if (!map) {
    map = new Map();
    fingerprintCache.set(dir, map);
  }
  map.set(name, fp);
  return fp;
}

async function scanTranscriptContainers(dir: FileSystemDirectoryHandle): Promise<ScannedContainer[]> {
  const cached = scanCache.get(dir);
  if (cached) return cached;
  const containers: ScannedContainer[] = [];
  try {
    const iterator = (dir as unknown as {
      entries: () => AsyncIterable<[string, { kind: string }]>;
    }).entries();
    for await (const [entryName, handle] of iterator) {
      if (handle.kind !== "directory") continue;
      if (!entryName.endsWith(TRANSCRIPT_DIR_SUFFIX)) continue;
      try {
        const raw = await readManifestText(handle as unknown as FileSystemDirectoryHandle);
        if (!raw) continue;
        const manifest = JSON.parse(raw) as TranscriptManifest;
        if (manifest && manifest.schemaVersion === 2 && Array.isArray(manifest.models)) {
          containers.push({ dir: handle as unknown as FileSystemDirectoryHandle, manifest });
        }
      } catch {
        /* 损坏清单，跳过 */
      }
    }
  } catch {
    /* 目录不可枚举，返回空 */
  }
  scanCache.set(dir, containers);
  return containers;
}

interface LegacyAssociation {
  /** 旧版 sidecar 文件（X.edited.json / X.transcript.json）的词干集合 */
  sidecarStems: Set<string>;
  /** 根目录 v2 JSON / manifest 里 audio 字段指向的音频名集合 */
  audioNames: Set<string>;
}

/**
 * 预扫描根目录下的旧格式转录文件，建立与音频名的关联：
 * - 旧 sidecar：按文件名词干匹配
 * - 根目录 v2（kind=te-edited/te-original 或 schemaVersion=2 manifest）：按内容里的 audio 字段匹配
 * 这样打开文件夹时，即使音频被外部改名，也能正确显示“已转录”。
 */
async function scanLegacyAssociations(dir: FileSystemDirectoryHandle): Promise<LegacyAssociation> {
  const sidecarStems = new Set<string>();
  const audioNames = new Set<string>();
  const editedRe = /^(.+)\.edited\.json$/i;
  const transcriptRe = /^(.+)\.transcript\.json$/i;
  try {
    const iterator = (dir as unknown as {
      entries: () => AsyncIterable<[string, { kind: string }]>;
    }).entries();
    for await (const [fname, fh] of iterator) {
      if (fh.kind !== "file") continue;
      if (!fname.toLowerCase().endsWith(".json")) continue;
      const data = await readRawJson(dir, fname);
      if (!data) continue;
      // 根目录 v2 单文件：kind + audio 字段
      if (
        (data.kind === "te-edited" || data.kind === "te-original") &&
        typeof data.audio === "string"
      ) {
        audioNames.add(data.audio);
        continue;
      }
      // 根目录 v2 manifest
      if (
        data.schemaVersion === 2 &&
        Array.isArray(data.models) &&
        typeof data.audio === "string"
      ) {
        audioNames.add(data.audio);
        continue;
      }
      // 旧 sidecar：有 transcript.segments 就算
      const transcript = data.transcript as { segments?: unknown } | undefined;
      if (transcript && Array.isArray(transcript.segments)) {
        const editedMatch = editedRe.exec(fname);
        if (editedMatch) sidecarStems.add(editedMatch[1]);
        const transcriptMatch = transcriptRe.exec(fname);
        if (transcriptMatch) sidecarStems.add(transcriptMatch[1]);
      }
    }
  } catch {
    /* 目录不可枚举，返回空 */
  }
  return { sidecarStems, audioNames };
}

/**
 * 定位某音频对应的转录目录：
 * 1) 快查：`<stem>.transcript/` 存在即返回；
 * 2) 指纹回退：扫描文件夹内所有 `.transcript/` 目录，按 manifest.audioFingerprint / audio 匹配；
 * 3) create=true 且前两步都失败：按词干新建 `<stem>.transcript/`。
 * 结果按 (dir, name) 缓存，避免重复扫描。
 */
async function resolveTranscriptDir(
  dir: FileSystemDirectoryHandle,
  name: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let cache = resolveCache.get(dir);
  if (!cache) {
    cache = new Map();
    resolveCache.set(dir, cache);
  }
  if (cache.has(name)) return cache.get(name) ?? null;

  const stem = stemOf(name);
  const fast = await getTranscriptDirHandle(dir, stem, false);
  if (fast) {
    cache.set(name, fast);
    return fast;
  }

  let fp: string | null;
  try {
    fp = await audioFingerprint(dir, name);
  } catch {
    fp = null;
  }
  if (fp) {
    const containers = await scanTranscriptContainers(dir);
    for (const c of containers) {
      if (c.manifest.audioFingerprint === fp || c.manifest.audio === name) {
        cache.set(name, c.dir);
        return c.dir;
      }
    }
  }

  if (create) {
    const created = await getTranscriptDirHandle(dir, stem, true);
    cache.set(name, created);
    return created;
  }
  // 注意：此处【不】缓存 null。若在此音频被加载（转录目录尚不存在）时解析过一次并返回
  // null 并缓存，之后 createModelUnlocked 通过 getTranscriptDirHandle 直接新建了旁挂目录，
  // 缓存里的 stale null 会让随后的 rename 误判“未找到转录目录”而静默失败。
  // 只缓存「命中」结果，负结果每次重新计算（fast 路径很廉价，指纹扫描有独立缓存）。
  return null;
}

/** 安全取指纹：失败时返回 undefined，便于在不破坏主流程的前提下懒补。 */
async function safeAudioFingerprint(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | undefined> {
  try {
    return await audioFingerprint(dir, name);
  } catch {
    return undefined;
  }
}

/** 重命名/迁移后让该目录的解析缓存失效，下次访问重新扫描。 */
export function invalidateCache(dir: FileSystemDirectoryHandle): void {
  fingerprintCache.delete(dir);
  scanCache.delete(dir);
  resolveCache.delete(dir);
}

/** 把稿件内的音频名引用统一改写为当前音频名（用于迁移后保持一致）。 */
function withAudioName(data: Record<string, unknown>, audioName: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data, audio: audioName };
  const transcript = next.transcript as { audio?: { filename?: string } } | undefined;
  if (transcript && transcript.audio) {
    next.transcript = { ...transcript, audio: { ...transcript.audio, filename: audioName } };
  }
  return next;
}

/** 根目录是否存在 schemaVersion=2 的 manifest.json（旧版「根目录 v2 布局」标记）。 */
async function hasRootV2Manifest(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const raw = await readRawJson(dir, MANIFEST_NAME);
  return !!(raw && raw.schemaVersion === 2 && Array.isArray(raw.models));
}

async function readFileText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const fh = await (dir as unknown as {
      getFileHandle: (n: string) => Promise<{ getFile: () => Promise<File> }>;
    }).getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch (error) {
    if ((error as { name?: string }).name !== "NotFoundError") throw error;
    return null;
  }
}

function manifestIO(dir:FileSystemDirectoryHandle) {
  return {read:(name:string)=>readFileText(dir,name),write:(name:string,text:string)=>writeFileText(dir,name,text)};
}
async function readManifestText(dir:FileSystemDirectoryHandle):Promise<string|null> {
  return readRecoverableManifest(manifestIO(dir));
}
async function writeFileJson(dir: FileSystemDirectoryHandle, name: string, obj: unknown): Promise<void> {
  const text=JSON.stringify(obj,null,2);
  if(name===MANIFEST_NAME)await writeRecoverableManifest(manifestIO(dir),text);
  else await writeFileText(dir,name,text);
}

async function writeFileText(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const fh = await (dir as unknown as {
    getFileHandle: (n: string, o?: { create: boolean }) => Promise<{
      createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }>;
    }>;
  }).getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  try {await writable.write(text);await writable.close();}
  catch(error){try {await writable.abort?.();}catch { /* keep original write error */ }throw error;}
}

async function removeEntrySafe(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await (dir as unknown as { removeEntry: (n: string) => Promise<void> }).removeEntry(name);
  } catch (error) {
    if ((error as { name?: string }).name !== "NotFoundError") throw error;
  }
}

async function transcriptDirExists(dir: FileSystemDirectoryHandle, stem: string): Promise<boolean> {
  if (!(await dirExists(dir, `${stem}${TRANSCRIPT_DIR_SUFFIX}`))) return false;
  const tDir = await getTranscriptDirHandle(dir, stem, false);
  if (!tDir) return false;
  // An existing container with a missing index is damaged, not untranscribed.
  return true;
}

export async function listAudioFiles(dir: FileSystemDirectoryHandle): Promise<AudioFileEntry[]> {
  const entries: AudioFileEntry[] = [];
  const iterator = (dir as unknown as {
    entries: () => AsyncIterable<[string, { kind: string }]>;
  }).entries();
  // 一次性扫描转录容器与根目录旧格式文件，供指纹/内容匹配（改名后也能正确识别）。
  let containers: ScannedContainer[];
  try {
    containers = await scanTranscriptContainers(dir);
  } catch {
    containers = [];
  }
  const legacyAssoc = await scanLegacyAssociations(dir);
  for await (const [name, handle] of iterator) {
    if (handle.kind !== "file") continue;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!AUDIO_EXT.includes(ext)) continue;
    const stem = stemOf(name);
    let hasTranscript =
      (await transcriptDirExists(dir, stem)) ||
      legacyAssoc.sidecarStems.has(stem) ||
      legacyAssoc.audioNames.has(name);
    // 指纹回退：音频改名但转录目录仍为旧词干时，仍能正确显示徽标。
    if (!hasTranscript) {
      try {
        const fp = await audioFingerprint(dir, name);
        hasTranscript = containers.some(
          (c) => c.manifest.audioFingerprint === fp || c.manifest.audio === name,
        );
      } catch {
        /* 音频不可读，忽略 */
      }
    }
    entries.push({ name, hasOriginal: hasTranscript, hasEdited: hasTranscript });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 给播放器用的地址。只在这里做一层垫片：裸 ADTS .aac 常带一个浏览器解不开的首帧桩帧
 * （见 lib/adts.ts），剥掉它再交给 <audio>。转录不经过这里，拿到的仍是原始文件。
 */
export async function readAudioUrl(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const fileHandle = await (dir as unknown as {
    getFileHandle: (n: string) => Promise<{ getFile: () => Promise<File> }>;
  }).getFileHandle(name);
  const file = await fileHandle.getFile();
  return URL.createObjectURL(await stripStubFirstFrame(file));
}

/**
 * 防御性归一化：确保每个 word 在「所在 segment 带有 speaker_id、而该 word 缺失 speaker_id」
 * 时，继承段级 speaker。
 *
 * 只补 null / 空串，绝不覆盖 word 已有的（哪怕不同的）speaker_id——因此可以安全自愈历史上
 * 因旧版重锚逻辑（reanchorWords 未保留 word.speaker_id，见提交 388dcff 之前）而丢失说话人标注
 * 的文件，同时不破坏段边界处合法的逐词说话人差异。
 *
 * 该不变量成立的前提：ElevenLabs 等引擎按说话人切段，单段内 word 共享同一 speaker，
 * 所以「段级 speaker」就是该段所有词的正确说话人。
 */
export function ensureWordSpeakers(transcript: Transcript): Transcript {
  let changed = false;
  const segments = transcript.segments.map((segment) => {
    const segSpeaker = segment.speaker_id;
    const words = segment.words;
    if (!segSpeaker || !words || words.length === 0) return segment;
    let segChanged = false;
    const newWords = words.map((word) => {
      if (word.speaker_id == null || word.speaker_id === "") {
        segChanged = true;
        return { ...word, speaker_id: segSpeaker };
      }
      return word;
    });
    if (segChanged) {
      changed = true;
      return { ...segment, words: newWords };
    }
    return segment;
  });
  return changed ? { ...transcript, segments } : transcript;
}

function parseEdited(raw: string, audioName: string): EditedFile | null {
  try {
    const parsed = JSON.parse(raw) as {
      transcript?: Transcript;
      metadata?: Partial<InterviewMetadata>;
    };
    const transcript = parsed.transcript;
    if (!transcript || !Array.isArray(transcript.segments)) return null;
    const stem = stemOf(audioName);
    const metadata: InterviewMetadata = parsed.metadata
      ? { ...defaultMetadata(stem), ...parsed.metadata }
      : defaultMetadata(stem);
    return { kind: "te-edited", audio: audioName, metadata, transcript: ensureWordSpeakers(transcript) };
  } catch {
    return null;
  }
}

/**
 * 把旧版「根目录 sidecar」布局（X.edited.json / X.transcript.json）迁移为 v2 模型结构。
 * 这是最初一版的侧车命名，文件名与音频词干严格对应。
 */
async function migrateLegacySidecar(
  dir: FileSystemDirectoryHandle,
  stem: string,
  audioName: string,
): Promise<TranscriptManifest | null> {
  const editedRaw = await readRawJson(dir, `${stem}.edited.json`);
  const origRaw = await readRawJson(dir, `${stem}.transcript.json`);
  if (!editedRaw && !origRaw) return null;
  const transcript = (editedRaw as { transcript?: Transcript } | null)?.transcript ??
    (origRaw as { transcript?: Transcript } | null)?.transcript;
  if (!transcript || !Array.isArray(transcript.segments)) return null;
  // 自愈历史上缺失 word 级说话人的转录（旧版重锚逻辑所致），迁移即修正。
  const healed = ensureWordSpeakers(transcript);

  const tDir = await getTranscriptDirHandle(dir, stem, true);
  if (!tDir) return null;

  const edited: EditedFile = editedRaw
    ? {
        kind: "te-edited",
        audio: audioName,
        metadata: editedRaw.metadata
          ? { ...defaultMetadata(stem), ...editedRaw.metadata }
          : defaultMetadata(stem),
        transcript: healed,
      }
    : { kind: "te-edited", audio: audioName, metadata: defaultMetadata(stem), transcript: healed };

  await writeFileJson(tDir, "v1-edited.json", { ...edited, updated_at: new Date().toISOString() });
  if (origRaw) await writeFileJson(tDir, "v1-original.json", origRaw);

  const manifest: TranscriptManifest = {
    schemaVersion: 2,
    audio: audioName,
    models: [
      {
        id: "m1",
        engine: "imported",
        original: origRaw ? "v1-original.json" : undefined,
        edits: [{ id: "e1", file: "v1-edited.json", updated_at: new Date().toISOString().slice(0, 10) }],
        activeEditId: "e1",
      },
    ],
    activeModelId: "m1",
  };
  await writeFileJson(tDir, MANIFEST_NAME, manifest);
  // Preserve sidecar sources so migration can be recovered or inspected.
  return manifest;
}

/**
 * 迁移「根目录 v2 布局」：manifest.json 与 te-original / te-edited 文件都散落在音频所在根目录，
 * 且文件名并不一定是标准的 v1 命名（例如 ElevenLabs 导出的 `Test01_01-09_ElevenLabs.json`）。
 * 因此按文件内容里的 `kind` 字段识别原稿/修改稿，复制到 `<stem>.transcript/` 并重建 manifest 的文件引用。
 * 迁移完成后保留根目录源文件作为恢复副本。
 */
async function migrateRootV2(
  dir: FileSystemDirectoryHandle,
  stem: string,
  audioName: string,
): Promise<TranscriptManifest | null> {
  const rootManifestRaw = await readRawJson(dir, MANIFEST_NAME);
  if (!rootManifestRaw || rootManifestRaw.schemaVersion !== 2 || !Array.isArray(rootManifestRaw.models)) {
    return null;
  }

  if (rootManifestRaw.audio !== audioName) return null;
  // Resolve each reference before creating anything; keep legacy files as a recovery copy.
  const sources = new Map<string, Record<string, unknown>>();
  for (const model of rootManifestRaw.models as TranscriptModel[]) {
    for (const file of [model.original, ...(model.edits ?? []).map(e => e.file)]) {
      if (!file) continue;
      const source = await readRawJson(dir, file);
      if (!source || !["te-original", "te-edited"].includes(String(source.kind))) {
        throw new Error(msg('localStore.m1481', { v0: file }));
      }
      sources.set(file, source);
    }
  }
  const tDir = await getTranscriptDirHandle(dir, stem, true);
  if (!tDir) throw new Error(msg('localStore.m1482'));

  const models: TranscriptModel[] = [];
  for (let i = 0; i < rootManifestRaw.models.length; i++) {
    const m = rootManifestRaw.models[i] as Record<string, unknown> & {
      id: string;
      engine?: string;
      label?: string;
      original?: string;
      edits?: Array<Record<string, unknown> & { id: string }>;
      activeEditId?: string;
    };
    const mi = i + 1;

    let originalFile: string | undefined;
    if (m.original) {
      originalFile = `${mi}-original.json`;
      await writeFileJson(tDir, originalFile, withAudioName(sources.get(m.original)!, audioName));
    }

    const srcEdits = Array.isArray(m.edits) ? m.edits : [];
    const newEdits = [];
    for (let j = 0; j < srcEdits.length; j++) {
      const src = sources.get(String(srcEdits[j].file));
      const file = `${mi}-e${j + 1}.json`;
      if (src) {
        await writeFileJson(tDir, file, withAudioName(src, audioName));
      }
      const base = srcEdits[j] ?? srcEdits[srcEdits.length - 1] ?? {};
      newEdits.push({
        id: (srcEdits[j] ?? { id: `${mi}-e${j + 1}` }).id ?? `${mi}-e${j + 1}`,
        label: (base as { label?: string }).label,
        file,
        updated_at: (base as { updated_at?: string }).updated_at ?? new Date().toISOString(),
      });
    }

    models.push({
      id: m.id,
      engine: m.engine ?? "imported",
      label: m.label ?? m.engine ?? "imported",
      original: originalFile,
      edits: newEdits,
      activeEditId: m.activeEditId ?? newEdits[0]?.id,
    });
  }

  const manifest: TranscriptManifest = {
    schemaVersion: 2,
    audio: audioName,
    audioFingerprint: await safeAudioFingerprint(dir, audioName),
    models,
    activeModelId: (rootManifestRaw.activeModelId as string | undefined) ?? models[0]?.id ?? "",
  };
  await writeFileJson(tDir, MANIFEST_NAME, manifest);

  // Keep the legacy manifest and sources for recovery.
  return manifest;
}

/**
 * 自动迁移分发：先试旧版根目录 sidecar，再试根目录 v2 布局。
 * 找不到任何旧格式文件时返回 null。
 */
async function migrateLegacy(
  dir: FileSystemDirectoryHandle,
  stem: string,
  audioName: string,
): Promise<TranscriptManifest | null> {
  const sidecar = await migrateLegacySidecar(dir, stem, audioName);
  if (sidecar) return sidecar;
  return migrateRootV2(dir, stem, audioName);
}

/**
 * 扫描列表中「还存在旧格式根目录文件但没有 `.transcript/` 旁挂目录」的音频。
 * 用于 App 顶部"旧格式残留"横幅展示与批量迁移。
 */
export async function findLegacyEntries(
  dir: FileSystemDirectoryHandle,
  entries: AudioFileEntry[],
): Promise<AudioFileEntry[]> {
  const legacy: AudioFileEntry[] = [];
  const rootV2 = await hasRootV2Manifest(dir);
  for (const entry of entries) {
    const stem = stemOf(entry.name);
    if (await transcriptDirExists(dir, stem)) continue;
    const hasEdited = await hasSidecar(dir, `${stem}.edited.json`);
    const hasOriginal = await hasSidecar(dir, `${stem}.transcript.json`);
    if (hasEdited || hasOriginal || rootV2) legacy.push(entry);
  }
  return legacy;
}

/**
 * 把列表中所有仍残留旧格式的音频批量迁移到新的 `.transcript/` 目录结构。
 * 每条调用一次 `migrateLegacy`：找不到旧根目录文件时直接跳过；中途失败抛错并停止后续迁移。
 */
async function migrateAllLegacyUnlocked(
  dir: FileSystemDirectoryHandle,
  entries: AudioFileEntry[],
): Promise<{ migrated: AudioFileEntry[]; skipped: AudioFileEntry[] }> {
  const migrated: AudioFileEntry[] = [];
  const skipped: AudioFileEntry[] = [];
  const rootV2 = await hasRootV2Manifest(dir);
  for (const entry of entries) {
    const stem = stemOf(entry.name);
    const hasEdited = await hasSidecar(dir, `${stem}.edited.json`);
    const hasOriginal = await hasSidecar(dir, `${stem}.transcript.json`);
    if (!hasEdited && !hasOriginal && !rootV2) {
      skipped.push(entry);
      continue;
    }
    const manifest = await migrateLegacy(dir, stem, entry.name);
    if (manifest) migrated.push(entry);
    else skipped.push(entry);
  }
  return { migrated, skipped };
}

/** 读取 manifest；若不存在但有旧版根目录转录文件，则自动迁移为 v2 模型结构。 */
async function readManifestUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<TranscriptManifest | null> {
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (tDir) {
    const raw = await readManifestText(tDir);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<TranscriptManifest> & {
        versions?: TranscriptVersion[]; activeId?: string;
      };
      if (Array.isArray(parsed.models)) return parsed as TranscriptManifest;
      if (Array.isArray(parsed.versions)) {
        const migrated = migrateV1ToV2({ schemaVersion: 1, audio: parsed.audio ?? name,
          audioHash: parsed.audioHash, activeId: parsed.activeId ?? parsed.versions[0]?.id ?? "",
          versions: parsed.versions });
        await writeFileJson(tDir, MANIFEST_NAME, migrated);
        return migrated;
      }
      throw new Error(msg('localStore.m1483'));
    }
  }
  if(tDir){
    const entries=(tDir as unknown as {entries:()=>AsyncIterable<[string,{kind:string}]>}).entries();
    for await(const [file,handle] of entries)if(handle.kind==="file" && /\.(json|crswap|bak)$/.test(file))
      throw new Error(msg('localStore.m1484'));
  }
  const migrated = await migrateLegacy(dir, stemOf(name), name);
  if (migrated) invalidateCache(dir);
  return migrated;
}

/** 把 v1（versions[]）内存转换为 v2（models[]），不触碰任何文件。 */
function migrateV1ToV2(
  v1: { schemaVersion: number; audio: string; audioHash?: string; activeId: string; versions: TranscriptVersion[] },
): TranscriptManifest {
  const idMap = new Map<string, string>();
  const models: TranscriptModel[] = v1.versions.map((v, i) => {
    const mid = `m${i + 1}`;
    idMap.set(v.id, mid);
    return {
      id: mid,
      engine: v.engine,
      // "初稿" 是历史默认名，换用人话默认模型名；其余自定义 label 保留
      label: v.label && v.label !== "初稿" ? v.label : defaultModelLabel(v.engine),
      original: v.original,
      edits: [{ id: "e1", label: defaultEditLabel(0), file: v.edited, updated_at: v.createdAt }],
      activeEditId: "e1",
    };
  });
  return {
    schemaVersion: 2,
    audio: v1.audio,
    audioHash: v1.audioHash,
    models,
    activeModelId: idMap.get(v1.activeId) ?? models[0]?.id ?? "",
  };
}

/** Reads the immutable original only to enrich an editable snapshot in memory. */
async function withOriginalOrigins(tDir:FileSystemDirectoryHandle, model:TranscriptModel, transcript:Transcript):Promise<Transcript> {
  if (!model.original || transcript.segments.every(s=>s.words?.length && s.words.every(w=>w.timing))) return transcript;
  const raw=await readFileText(tDir,model.original);
  if(!raw)return transcript;
  let original:Transcript|undefined;
  try {original=JSON.parse(raw).transcript;} catch {return transcript;}
  return original?restoreTranscriptOrigins(transcript,original,model.id):transcript;
}

/** 读取当前激活模型的激活修改稿；无转录时返回 null。 */
async function readEditedUnlocked(dir: FileSystemDirectoryHandle, name: string): Promise<EditedFile | null> {
  const manifest = await readManifestUnlocked(dir, name);
  if (!manifest) return null;
  const model = manifest.models.find((m) => m.id === manifest.activeModelId) ?? manifest.models[0];
  if (!model) return null;
  const edit = model.edits.find((e) => e.id === model.activeEditId) ?? model.edits[0];
  if (!edit && !model.original) return null;
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (!tDir) return null;
  const raw = await readFileText(tDir, edit?.file ?? model.original!);
  if (!raw) return null;
  if (!edit) return { kind: "te-edited", audio: name, metadata: { ...defaultMetadata(stemOf(name)), ...manifest.interviewDetails, title: manifest.title ?? stemOf(name) }, transcript: seedOriginalOrigins(JSON.parse(raw).transcript,model.id) };
  const parsed = parseEdited(raw, name);
  if (parsed) parsed.transcript = await withOriginalOrigins(tDir,model,parsed.transcript);
  if (parsed) parsed.metadata = {...parsed.metadata, ...manifest.interviewDetails, title:manifest.title ?? parsed.metadata.title};
  return parsed;
}

/** 读取指定模型指定修改稿（用于切换）。 */
async function readModelEditUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  modelId: string,
  editId: string,
): Promise<EditedFile | null> {
  const manifest = await readManifestUnlocked(dir, name);
  const model = manifest?.models.find((m) => m.id === modelId);
  const edit = model?.edits.find((e) => e.id === editId);
  if (!model || !edit) return null;
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (!tDir) return null;
  const raw = await readFileText(tDir, edit.file);
  if (!raw) return null;
  const parsed=parseEdited(raw,name);
  if(parsed){
    parsed.transcript=await withOriginalOrigins(tDir,model,parsed.transcript);
    parsed.metadata={...parsed.metadata,...manifest?.interviewDetails,title:manifest?.title ?? parsed.metadata.title};
  }
  return parsed;
}

/** 读取指定模型的引擎原稿（只读），返回其 transcript。 */
async function readModelOriginalUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  modelId: string,
): Promise<{ transcript: Transcript } | null> {
  const manifest = await readManifestUnlocked(dir, name);
  const model = manifest?.models.find((m) => m.id === modelId);
  const originalFile = model?.designatedOriginal ? (model.edits.find(e => e.id === (model.designatedOriginalEditId ?? model.activeEditId)) ?? model.edits[0])?.file ?? model.original : model?.original;
  if (!model || !originalFile) return null;
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (!tDir) return null;
  const raw = await readFileText(tDir, originalFile);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { transcript?: Transcript };
    return parsed.transcript ? { transcript: seedOriginalOrigins(parsed.transcript,model.id) } : null;
  } catch {
    return null;
  }
}

function nextModelId(manifest: TranscriptManifest): string {
  let max = 0;
  for (const m of manifest.models) {
    const mm = /^m(\d+)$/.exec(m.id);
    if (mm) max = Math.max(max, parseInt(mm[1], 10));
  }
  return `m${max + 1}`;
}

function nextEditId(model: TranscriptModel): string {
  let max = 0;
  for (const e of model.edits) {
    const em = /^e(\d+)$/.exec(e.id);
    if (em) max = Math.max(max, parseInt(em[1], 10));
  }
  return `e${max + 1}`;
}

/**
 * 新建一个模型（某引擎的一次转录）并写入 `<stem>.transcript/<id>-e1.json`（可选 original），
 * 更新 manifest（追加模型、置为 active），返回新模型、新 manifest 与编辑稿。
 */
async function createModelUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  params: {
    engine: string;
    label?: string;
    transcript: Transcript;
    original?: Transcript;
    originalOnly?: boolean;
    designatedOriginal?: boolean;
    editLabel?: string;
    sourceKind?: "transcription" | "import";
    sourceName?: string;
    metadata?: InterviewMetadata;
    setActive?: boolean;
  },
): Promise<{ model: TranscriptModel; manifest: TranscriptManifest; edited: EditedFile }> {
  const stem = stemOf(name);
  const tDir = await getTranscriptDirHandle(dir, stem, true);
  if (!tDir) throw new Error(msg('localStore.m1486'));

  const existing = (await readManifestUnlocked(dir, name)) ?? {
    schemaVersion: 2,
    audio: name,
    models: [] as TranscriptModel[],
    activeModelId: "",
  };
  const id = nextModelId(existing);
  const createdAt = new Date().toISOString();

  const edited: EditedFile = {
    kind: "te-edited",
    audio: name,
    metadata: { ...defaultMetadata(stem), ...params.metadata, ...existing.interviewDetails, title: existing.title ?? params.metadata?.title ?? stem },
    transcript: params.original ? restoreTranscriptOrigins({...params.transcript,segments:params.transcript.segments.map(s=>({...s,words:s.words?.map(w=>({...w,timing:undefined,origins:undefined}))}))},params.original,id) : params.transcript,
  };
  const editFile = params.editLabel ? transcriptFilename(existing.title ?? stem, requireVersionName(params.editLabel)) : `${id}-e1.json`;
  if (params.editLabel && (await hasSidecar(tDir,editFile) || existing.models.some(m=>m.edits.some(e=>e.label===params.editLabel)))) throw new Error(msg('localStore.m1487'));
  if (!params.originalOnly) await writeFileJson(tDir, editFile, { ...edited, updated_at: new Date().toISOString() });

  let originalFile: string | undefined;
  if (params.original) {
    originalFile = transcriptFilename(existing.title ?? stem, `${params.sourceKind === "import" && !params.designatedOriginal ? "导入稿" : "原始转录稿"}${existing.models.length ? `_${params.engine}_${createdAt.replace(/[:.]/g, "-")}_${id}` : ""}`);
    if (await hasSidecar(tDir, originalFile)) throw new Error(msg('localStore.m1490', { v0: originalFile }));
    await writeFileJson(tDir, originalFile, {
      kind: params.sourceKind === "import" ? "te-imported" : "te-original",
      generated_at: new Date().toISOString(),
      transcript: params.original,
    });
  }

  const model: TranscriptModel = {
    id,
    engine: params.engine,
    sourceKind: params.sourceKind ?? "transcription",
    ...((params.designatedOriginal || (params.sourceKind !== "import" && params.originalOnly && params.original))?{designatedOriginal:true}:{}),
    ...(params.sourceName ? { sourceName: params.sourceName } : {}),
    label: params.label ?? (params.sourceKind === "import" && params.sourceName ? stemOf(params.sourceName) : `${defaultModelLabel(params.engine)} · ${createdAt.slice(0, 19).replace("T", " ")}`),
    createdAt,
    original: originalFile,
    edits: params.originalOnly ? [] : [{ id: "e1", label: params.editLabel ?? defaultEditLabel(0), file: editFile, updated_at: new Date().toISOString() }],
    activeEditId: params.originalOnly ? "" : "e1",
  };
  const newManifest: TranscriptManifest = {
    ...existing,
    title: existing.title ?? params.metadata?.title ?? stem,
    ...(params.metadata && !existing.interviewDetails ? { interviewDetails: pickInterviewDetails(params.metadata) } : {}),
    audio: name,
    audioFingerprint: existing.audioFingerprint ?? (await safeAudioFingerprint(dir, name)),
    activeModelId: params.setActive === false && existing.activeModelId ? existing.activeModelId : id,
    models: [...existing.models, model],
  };
  await writeFileJson(tDir, MANIFEST_NAME, newManifest);
  return { model, manifest: newManifest, edited };
}

/**
 * 在指定模型下 fork 一份新修改稿：复制源稿件内容（fromOriginal→原稿，否则当前激活修改稿），
 * 写入 `<modelId>-e<N>.json`，置为激活，返回新修改稿、模型与新 manifest。
 */
async function createEditUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  modelId: string,
  params: { fromOriginal?: boolean; setActive?: boolean; srcEditId?: string; label?: string; metadata?: Partial<InterviewMetadata>;
    reviewed?: { baseline: Transcript; transcript: Transcript; label: string } },
): Promise<{ edit: TranscriptEdit; model: TranscriptModel; manifest: TranscriptManifest; edited: EditedFile }> {
  const stem = stemOf(name);
  const tDir = await getTranscriptDirHandle(dir, stem, false);
  if (!tDir) throw new Error(msg('localStore.m1491'));
  const manifest = await readManifestUnlocked(dir, name);
  if (!manifest) throw new Error(msg('localStore.m1492'));
  const model = manifest.models.find((m) => m.id === modelId);
  if (!model) throw new Error(msg('localStore.m1493'));

  const srcFile = params.fromOriginal
    ? (model.designatedOriginal ? (model.edits.find(e => e.id === (model.designatedOriginalEditId ?? model.activeEditId)) ?? model.edits[0])?.file ?? model.original : model.original)
    : model.edits.find((e) => e.id === (params.srcEditId ?? model.activeEditId))?.file;
  if (!srcFile) throw new Error(msg('localStore.m1494'));
  const raw = await readFileText(tDir, srcFile);
  if (!raw) throw new Error(msg('localStore.m1495'));
  const parsed = JSON.parse(raw) as { transcript?: Transcript; metadata?: InterviewMetadata };
  const rawTranscript = parsed.transcript;
  if (!rawTranscript) throw new Error(msg('localStore.m1496'));
  const srcTranscript=await withOriginalOrigins(tDir,model,rawTranscript);
  if (params.reviewed && JSON.stringify(srcTranscript) !== JSON.stringify(await withOriginalOrigins(tDir,model,params.reviewed.baseline))) {
    throw new Error(msg('localStore.m1497'));
  }

  // A read-only manuscript remains a separate immutable source when an edit is made.
  if (model.designatedOriginal || (model.sourceKind !== "import" && model.original && !model.edits.length)) {
    const result = await createModelUnlocked(dir, name, {
      engine: model.engine, sourceKind: model.sourceKind, sourceName: model.sourceName,
      transcript: params.reviewed?.transcript ?? srcTranscript,
      metadata: { ...(parsed.metadata ?? defaultMetadata(stem)), ...manifest.interviewDetails, ...params.metadata },
      label: params.reviewed?.label ?? params.label ?? `${model.label || model.sourceName || model.engine} 副本`,
      setActive: params.setActive,
      editLabel: params.reviewed?.label ?? params.label,
    });
    return { ...result, edit: result.model.edits[0] };
  }

  const id = nextEditId(model);
  const label = requireVersionName(params.reviewed?.label ?? params.label ?? defaultEditLabel(model.edits.length));
  const title = manifest.title ?? parsed.metadata?.title ?? stem;
  const editFile = transcriptFilename(title, label);
  if (manifest.models.some(m => m.edits.some(e => sanitizeForFilename(e.label ?? "").toLocaleLowerCase() === sanitizeForFilename(label).toLocaleLowerCase())) || await hasSidecar(tDir, editFile)) throw new Error(msg('localStore.m1499', { v0: label }));
  const edited: EditedFile = {
    kind: "te-edited",
    audio: name,
    metadata: { ...(parsed.metadata ?? defaultMetadata(stem)), ...manifest.interviewDetails, ...params.metadata, title },
    transcript: params.reviewed?.transcript ?? srcTranscript,
  };

  const edit: TranscriptEdit = {
    id,
    label,
    ...(params.reviewed ? { comparisonBaseId: params.fromOriginal ? "original" : params.srcEditId ?? model.activeEditId } : {}),
    file: editFile,
    updated_at: new Date().toISOString(),
  };
  const newModel: TranscriptModel = {
    ...model,
    designatedOriginal: model.designatedOriginal,
    edits: [...model.edits, edit],
    activeEditId: params.setActive === false ? model.activeEditId : id,
  };
  const newModels = manifest.models.map((m) => (m.id === modelId ? newModel : m));
  const newManifest: TranscriptManifest = {
    ...manifest,
    title,
    activeModelId: params.setActive === false ? manifest.activeModelId : modelId,
    models: newModels,
  };
  try {
    await writeFileJson(tDir, editFile, { ...edited, updated_at: new Date().toISOString() });
    await writeFileJson(tDir, MANIFEST_NAME, newManifest);
  } catch (error) {
    // This name was checked as absent above; remove only this operation's unpublished file.
    try { await removeEntrySafe(tDir, editFile); }
    catch { throw new Error(msg('localStore.m1500', { v0: editFile }), { cause: error }); }
    throw error;
  }
  return { edit, model: newModel, manifest: newManifest, edited };
}

function pickInterviewDetails(metadata: InterviewMetadata): NonNullable<TranscriptManifest["interviewDetails"]> {
  return {recorded_at:metadata.recorded_at,location:metadata.location,topics:metadata.topics,notes:metadata.notes};
}

/** Original mode saves only interview details; the engine output stays byte-for-byte intact. */
async function saveInterviewDetailsUnlocked(dir:FileSystemDirectoryHandle,name:string,metadata:InterviewMetadata):Promise<void> {
  const manifest=await readManifestUnlocked(dir,name);
  const tDir=await resolveTranscriptDir(dir,name,false);
  if(!manifest || !tDir)throw new Error(msg('localStore.m1501'));
  const interviewDetails=pickInterviewDetails(metadata);
  if(JSON.stringify(manifest.interviewDetails)===JSON.stringify(interviewDetails))return;
  await writeFileJson(tDir,MANIFEST_NAME,{...manifest,interviewDetails});
}

/** 将编辑内容保存到指定模型的指定修改稿，并刷新该 edit 的 updated_at。 */
async function saveActiveEditUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  modelId: string,
  editId: string,
  data: EditedFile,
): Promise<void> {
  const tDir = await resolveTranscriptDir(dir, name, true);
  if (!tDir) throw new Error(msg('localStore.m1502'));
  const manifest = await readManifestUnlocked(dir, name);
  const model = manifest?.models.find((m) => m.id === modelId);
  const edit = model?.edits.find((e) => e.id === editId);
  if (model?.designatedOriginal) throw new Error(msg('localStore.m1503'));
  if (!edit) throw new Error(msg('localStore.m1504'));
  await writeFileJson(tDir, edit.file, { ...data, metadata: { ...data.metadata, title: manifest?.title ?? data.metadata.title }, updated_at: new Date().toISOString() });
  if (manifest && model && edit) {
    const newEdits = model.edits.map((e) =>
      e.id === editId ? { ...e, updated_at: new Date().toISOString() } : e,
    );
    const newModels = manifest.models.map((m) => (m.id === modelId ? { ...m, edits: newEdits } : m));
    await writeFileJson(tDir, MANIFEST_NAME, { ...manifest, interviewDetails: pickInterviewDetails(data.metadata), models: newModels });
  }
}

/** 仅切换 manifest.activeModelId（及可选 model.activeEditId），不写转录内容。 */
async function persistActiveModelUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  modelId: string,
  editId?: string,
): Promise<TranscriptManifest | null> {
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (!tDir) return null;
  const manifest = await readManifestUnlocked(dir, name);
  if (!manifest) return null;
  const models = manifest.models.map((m) => {
    if (m.id !== modelId) return m;
    return editId ? { ...m, activeEditId: editId } : m;
  });
  const newManifest: TranscriptManifest = { ...manifest, activeModelId: modelId, models };
  await writeFileJson(tDir, MANIFEST_NAME, newManifest);
  return newManifest;
}

export function requireVersionName(label: string): string {
  const value = label.trim();
  if (!value || !sanitizeForFilename(value) || value === "." || value === ".." || Array.from(value).some(c => c.charCodeAt(0) < 32)) {
    throw new Error(msg('localStore.m1505'));
  }
  return value;
}
export function transcriptFilename(title: string, version: string): string {
  return `${sanitizeForFilename(title)}_${sanitizeForFilename(requireVersionName(version))}.json`;
}

/** Snapshot every source before writing; publish the manifest only after verified copies exist. */
async function syncTranscriptNames(
  dir: FileSystemDirectoryHandle, previous: TranscriptManifest, proposed: TranscriptManifest, title: string,
): Promise<TranscriptManifest> {
  const previousRaw = await readManifestText(dir);
  const next: TranscriptManifest = { ...structuredClone(proposed), title };
  const files = next.models.flatMap(m => [
    ...(m.original ? [{ old: m.original, target: transcriptFilename(title, `${m.sourceKind === "import" && !m.designatedOriginal ? "导入稿" : "原始转录稿"}${next.models.length > 1 ? `_${m.engine}_${m.createdAt?.replace(/[:.]/g, "-") ?? m.id}` : ""}`), set: (file: string) => { m.original = file; } }] : []),
    ...m.edits.map(e => ({ old: e.file, target: transcriptFilename(title, e.label ?? defaultEditLabel(m.edits.indexOf(e))), set: (file: string) => { e.file = file; } })),
  ]);
  // Older model groups can each contain a default v1; preserve these versions distinctly.
  const counts = new Map<string, number>();
  for (const f of files) counts.set(f.target.toLocaleLowerCase(), (counts.get(f.target.toLocaleLowerCase()) ?? 0) + 1);
  for (const f of files) if ((counts.get(f.target.toLocaleLowerCase()) ?? 0) > 1) {
    const owner = next.models.find(m => m.edits.some(e => e.file === f.old));
    if (owner) f.target = f.target.replace(/\.json$/, `_${owner.id}.json`);
  }
  const sources = new Set(files.map(f => f.old));
  const targets = new Set<string>();
  const snapshots = new Map<string, string>();
  for (const file of files) {
    const key = file.target.toLocaleLowerCase();
    if (targets.has(key) || (file.target !== file.old && !sources.has(file.target) && await hasSidecar(dir, file.target))) {
      throw new Error(msg('localStore.m1508', { v0: file.target }));
    }
    targets.add(key);
    const raw = await readFileText(dir, file.old);
    if (raw === null) throw new Error(msg('localStore.m1509', { v0: file.old }));
    JSON.parse(raw);
    snapshots.set(file.old, raw);
    file.set(file.target);
  }
  const written = new Set<string>();
  try {
    for (const file of files) {
      const data = JSON.parse(snapshots.get(file.old)!);
      if (data.metadata) data.metadata = { ...data.metadata, title };
      written.add(file.target);
      await writeFileJson(dir, file.target, data);
      if (JSON.stringify(JSON.parse((await readFileText(dir, file.target)) ?? "null")) !== JSON.stringify(data)) throw new Error(msg('localStore.m1510'));
    }
    await writeFileJson(dir, MANIFEST_NAME, next);
    for (const file of files) if (!files.some(f => f.target === file.old)) await dir.removeEntry(file.old);
  } catch (error) {
    try {
      for (const [name, raw] of snapshots) {
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(raw); await w.close();
      }
      const manifestWriter = await (await dir.getFileHandle(MANIFEST_NAME, { create: true })).createWritable();
      await manifestWriter.write(previousRaw ?? JSON.stringify(previous)); await manifestWriter.close();
      for (const name of written) if (!sources.has(name)) await dir.removeEntry(name);
    } catch {
      throw new Error(msg('localStore.m1511'), { cause: error });
    }
    throw error;
  }
  return next;
}

/** 重命名模型（更新 manifest.label）。 */
async function setModelOriginalUnlocked(dir: FileSystemDirectoryHandle, name: string, modelId: string, designatedOriginal: boolean): Promise<TranscriptManifest> {
  const manifest = await readManifestUnlocked(dir, name);
  const tDir = await resolveTranscriptDir(dir, name, false);
  const model = manifest?.models.find(m => m.id === modelId);
  if (!manifest || !tDir || !model) throw new Error(msg('localStore.m1512'));
  if (model.sourceKind !== "import") throw new Error(msg('localStore.m1513'));
  if (!designatedOriginal && !model.edits.length) {
    const raw = await readFileText(tDir, model.original!);
    if (!raw) throw new Error(msg('localStore.m1514'));
    const source = JSON.parse(raw);
    const file = `editable-${crypto.randomUUID()}.json`;
    await writeFileJson(tDir, file, {kind:"te-edited",audio:name,metadata:{...defaultMetadata(stemOf(name)),...manifest.interviewDetails,...source.metadata},transcript:source.transcript});
    const next = {...manifest,models:manifest.models.map(m=>m.id===modelId?{...m,designatedOriginal:false,designatedOriginalEditId:undefined,activeEditId:"e1",edits:[{id:"e1",file,label:defaultEditLabel(0),updated_at:new Date().toISOString()}]}:m)};
    await writeFileJson(tDir, MANIFEST_NAME, next);return next;
  }
  const next = { ...manifest, models: manifest.models.map(m => m.id === modelId ? { ...m, designatedOriginal, designatedOriginalEditId: designatedOriginal ? (m.activeEditId || m.edits[0]?.id) : undefined } : m) };
  await writeFileJson(tDir, MANIFEST_NAME, next);
  return next;
}

async function renameModelLabelUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  modelId: string,
  label: string,
): Promise<TranscriptManifest> {
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (!tDir) throw new Error(msg('localStore.m1515'));
  const manifest = await readManifestUnlocked(dir, name);
  if (!manifest) throw new Error(msg('localStore.m1516'));
  const models = manifest.models.map((m) => (m.id === modelId ? { ...m, label: label || undefined } : m));
  const newManifest: TranscriptManifest = { ...manifest, models };
  await writeFileJson(tDir, MANIFEST_NAME, newManifest);
  return newManifest;
}

/** Rename a version without changing the shared interview title. */
async function renameEditLabelUnlocked(
  dir: FileSystemDirectoryHandle, name: string, modelId: string, editId: string, label: string,
): Promise<TranscriptManifest> {
  const manifest = await readManifestUnlocked(dir, name);
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (!manifest || !tDir) throw new Error(msg('localStore.m1517'));
  requireVersionName(label);
  if (!manifest.models.some(m => m.id === modelId && m.edits.some(e => e.id === editId))) throw new Error(msg('localStore.m1518'));
  const next = { ...manifest, models: manifest.models.map(m => m.id !== modelId ? m : {
    ...m, edits: m.edits.map(e => e.id === editId ? { ...e, label: label.trim() } : e),
  }) };
  if (manifest.models.some(m => m.edits.some(e => !(m.id === modelId && e.id === editId) && sanitizeForFilename(e.label ?? defaultEditLabel(m.edits.indexOf(e))).toLocaleLowerCase() === sanitizeForFilename(label.trim()).toLocaleLowerCase()))) throw new Error(msg('localStore.m1519'));
  const current = await readEditedUnlocked(dir, name);
  return syncTranscriptNames(tDir, manifest, next, manifest.title ?? current?.metadata.title ?? stemOf(name));
}

/** Publish the index before deleting content; a failed index write must never lose a manuscript. */
async function commitVersionRemoval(dir: FileSystemDirectoryHandle, previous: TranscriptManifest,
  next: TranscriptManifest, file: string): Promise<void> {
  const raw = await readManifestText(dir);
  await writeFileJson(dir, MANIFEST_NAME, next);
  try {
    await removeEntrySafe(dir, file);
  } catch (error) {
    try { await writeFileText(dir, MANIFEST_NAME, raw ?? JSON.stringify(previous)); }
    catch { throw new Error(msg('localStore.m1520'), { cause: error }); }
    throw error;
  }
}

/** 删除某模型的某个修改稿：删文件、更新 manifest，并处理 activeEditId 回落与空模型移除。 */
async function removeEditUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  modelId: string,
  editId: string,
): Promise<TranscriptManifest | null> {
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (!tDir) return null;
  const manifest = await readManifestUnlocked(dir, name);
  const model = manifest?.models.find((m) => m.id === modelId);
  const edit = model?.edits.find((e) => e.id === editId);
  if (!manifest || !model || !edit) return null;


  const remainingEdits = model.edits.filter((e) => e.id !== editId);
  let newModel: TranscriptModel;
  if (remainingEdits.length === 0) {
    if (model.original) {
      // 修改稿删光但仍有原稿：保留模型，仅剩原稿（只读），activeEditId 置空
      newModel = { ...model, edits: [], activeEditId: "" };
      const newModels = manifest.models.map((m) => (m.id === modelId ? newModel : m));
      const newManifest: TranscriptManifest = { ...manifest, models: newModels };
      await commitVersionRemoval(tDir, manifest, newManifest, edit.file);
      return newManifest;
    }
    // 既无修改稿也无原稿 → 整个模型移除
    const models = manifest.models.filter((m) => m.id !== modelId);
    const activeModelId = manifest.activeModelId === modelId ? (models[0]?.id ?? "") : manifest.activeModelId;
    const newManifest: TranscriptManifest = { ...manifest, models, activeModelId };
    await commitVersionRemoval(tDir, manifest, newManifest, edit.file);
    return newManifest;
  }

  newModel = {
    ...model,
    edits: remainingEdits,
    activeEditId: model.activeEditId === editId ? remainingEdits[0].id : model.activeEditId,
  };
  const newModels = manifest.models.map((m) => (m.id === modelId ? newModel : m));
  const newManifest: TranscriptManifest = { ...manifest, models: newModels };
  await commitVersionRemoval(tDir, manifest, newManifest, edit.file);
  return newManifest;
}

/** 删除某模型的引擎原稿（只读源）：删文件、清 manifest 标记；若该模型已无任何修改稿则整体移除。 */
async function removeModelOriginalUnlocked(
  dir: FileSystemDirectoryHandle,
  name: string,
  modelId: string,
): Promise<TranscriptManifest | null> {
  const tDir = await resolveTranscriptDir(dir, name, false);
  if (!tDir) return null;
  const manifest = await readManifestUnlocked(dir, name);
  const model = manifest?.models.find((m) => m.id === modelId);
  if (!manifest || !model || !model.original) return null;


  if (model.edits.length === 0) {
    // 原稿是最后一份内容 → 整个模型移除
    const models = manifest.models.filter((m) => m.id !== modelId);
    const activeModelId = manifest.activeModelId === modelId ? (models[0]?.id ?? "") : manifest.activeModelId;
    const newManifest: TranscriptManifest = { ...manifest, models, activeModelId };
    await commitVersionRemoval(tDir, manifest, newManifest, model.original);
    return newManifest;
  }

  const newModel: TranscriptModel = { ...model, original: undefined };
  const newModels = manifest.models.map((m) => (m.id === modelId ? newModel : m));
  const newManifest: TranscriptManifest = { ...manifest, models: newModels };
  await commitVersionRemoval(tDir, manifest, newManifest, model.original);
  return newManifest;
}

async function writeJson(dir: FileSystemDirectoryHandle, name: string, obj: unknown): Promise<void> {
  const fileHandle = await (dir as unknown as {
    getFileHandle: (n: string, o?: { create: boolean }) => Promise<{
      createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(obj, null, 2));
  await writable.close();
}

async function writeEditedUnlocked(dir: FileSystemDirectoryHandle, name: string, data: EditedFile): Promise<void> {
  await writeJson(dir, `${stemOf(name)}.edited.json`, {
    ...data,
    updated_at: new Date().toISOString(),
  });
}

/**
 * 转录的三个阶段。区分「读到音频」和「传到云端」是因为这两段的耗时差几个数量级：
 * 前者走 localhost，通常一两秒；后者要出公网，大文件可能是几十秒到十几分钟。
 * 把它们混成一个「上传中」，用户就分不清是自己这边慢还是已经卡死了。
 */
export type TranscriptionPhase =
  | "uploading" // 浏览器把音频读给本地后端（有字节进度）
  | "sending" // 本地后端把音频传到云端存储（大文件慢在这一段，有字节进度）
  | "saving"
  | "processing"; // 引擎在识别（没有进度可报，只能报时长）

/** 「后端 → 云端」的进度多久问一次。1 秒足够跟上，也不至于把本地服务问烦。 */
const PROGRESS_POLL_MS = 1000;

/**
 * 宽限期：上传交给后端之后，如果这么久还没看到后端登记的进度，就按老样子显示「识别中」。
 * 需要这个是因为「先传到云端」只有部分引擎有；没有这一步的引擎永远问不到进度，
 * 界面不该因此一直停在「读取音频 100%」。
 */
const SERVER_PROGRESS_GRACE_MS = 3000;

/** 后端 `/api/transcribe/progress` 的响应。字段可选，因为「没有这个任务」时只有 active。 */
interface ServerProgress {
  active: boolean;
  phase?: string;
  sent_bytes?: number;
  total_bytes?: number;
}

/**
 * 给这次转录生成一个身份，随表单一起提交；后端按它回报进度。
 * 用随机 id 而不是文件名：同一个文件先后跑两次不会互相串号。
 */
function newJobId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 问后端「音频传到哪儿了」。取不到就当没有进度——进度是锦上添花，不能让它影响转录本身。 */
async function readTranscribeProgress(jobId: string): Promise<ServerProgress | null> {
  try {
    const response = await fetch(
      `/api/transcribe/progress?job_id=${encodeURIComponent(jobId)}`, {signal: AbortSignal.timeout(5000)},
    );
    if (!response.ok) return null;
    return (await response.json()) as ServerProgress;
  } catch {
    return null;
  }
}

/**
 * 转录失败。code 是稳定标识，前端据此决定提示什么、给什么操作；
 * raw 保留服务商英文原文，供「复制错误信息」排查用。
 */
export class TranscriptionError extends Error {
  code: string;
  raw?: string;

  constructor(message: string, code: string, raw?: string) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    this.raw = raw;
  }
}

function failureForStatus(status: number, body: unknown): TranscriptionError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === "object") {
    const structured = detail as { message?: unknown; code?: unknown; raw?: unknown };
    if (typeof structured.message === "string" && structured.message) {
      return new TranscriptionError(
        apiErrorMessage(body, status),
        typeof structured.code === "string" ? structured.code : `http_${status}`,
        typeof structured.raw === "string" ? structured.raw : undefined,
      );
    }
  }
  const text = typeof detail === "string" ? detail : "";
  const known: Record<number, { message: string; code: string }> = {
    401: { message: msg('localStore.m1521'), code: "invalid_api_key" },
    403: { message: msg('localStore.m1522'), code: "invalid_api_key" },
    402: { message: msg('localStore.m1523'), code: "quota_exceeded" },
    409: { message: text || msg('localStore.m1524'), code: "no_api_key" },
    413: { message: msg('localStore.m1525'), code: "file_too_large" },
    422: { message: text || msg('localStore.m1526'), code: "bad_request" },
    429: { message: msg('localStore.m1527'), code: "rate_limited" },
  };
  const hit = known[status];
  if (hit) return new TranscriptionError(apiErrorMessage(body, status, hit.message), hit.code, text);
  if (status >= 500) {
    return new TranscriptionError(msg('localStore.m1528'), "upstream_error", text);
  }
  return new TranscriptionError(apiErrorMessage(body, status, msg('localStore.m1529', { v0: status })), `http_${status}`, text);
}

const transcriptionMarker = (name: string) => `.${name}.ripple-job.json`;
interface TranscriptionMarker { jobId: string; signature: string }
async function readTranscriptionMarker(dir: FileSystemDirectoryHandle, name: string): Promise<TranscriptionMarker | null> {
  try {
    const file = await (await dir.getFileHandle(transcriptionMarker(name))).getFile();
    const marker = JSON.parse(await file.text());
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(marker.jobId) || typeof marker.signature !== "string") throw new Error(msg('localStore.m1530'));
    return marker;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}
export async function acknowledgeTranscription(dir: FileSystemDirectoryHandle, name: string) {
  const marker = await readTranscriptionMarker(dir, name);
  // The transcript has already been saved. Removing the marker prevents a duplicate local version.
  await dir.removeEntry(transcriptionMarker(name));
  if (marker) await fetch(`/api/transcribe/jobs/${encodeURIComponent(marker.jobId)}`, {method:"DELETE"}).catch(() => {});
}

async function waitForTranscription(jobId: string, hooks?: {signal?: AbortSignal; onProgress?: (phase: TranscriptionPhase, ratio?: number) => void}): Promise<Transcript> {
  while (true) {
    if (hooks?.signal?.aborted) throw new TranscriptionError(msg('localStore.m1531'), "aborted");
    let response: Response;
    try { response = await fetch(`/api/transcribe/jobs/${encodeURIComponent(jobId)}`, {signal: hooks?.signal ? AbortSignal.any([hooks.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)}); }
    catch { throw new TranscriptionError(hooks?.signal?.aborted ? msg('localStore.m1532') : msg('localStore.m1533'), hooks?.signal?.aborted ? "aborted" : "backend_unreachable"); }
    if (response.status === 404) throw new TranscriptionError(msg('localStore.m1534'), "job_expired");
    if (!response.ok) throw failureForStatus(response.status, await response.json());
    const state = await response.json();
    if (state.state === "completed") return state.transcript as Transcript;
    if (state.state === "failed") throw failureForStatus(state.status, {detail:state.detail});
    const progress = await readTranscribeProgress(jobId);
    if (progress?.active && progress.phase === "sending") hooks?.onProgress?.("sending", progress.total_bytes ? (progress.sent_bytes ?? 0)/progress.total_bytes : 0);
    else hooks?.onProgress?.("processing");
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); hooks?.signal?.removeEventListener("abort", done); resolve(); };
      const timer = window.setTimeout(done, 1000);
      hooks?.signal?.addEventListener("abort", done, {once:true});
    });
  }
}

export async function transcribeAudio(
  dir: FileSystemDirectoryHandle,
  name: string,
  options: TranscriptionOptions,
  hooks?: {
    signal?: AbortSignal;
    onProgress?: (phase: TranscriptionPhase, ratio?: number) => void;
    providerId?: string;
  },
): Promise<Transcript> {
  const file = await (await (dir as unknown as {
    getFileHandle: (n: string) => Promise<{ getFile: () => Promise<File> }>;
  }).getFileHandle(name)).getFile();

  const signature = JSON.stringify([file.size, file.lastModified, hooks?.providerId, options]);
  const previous = await readTranscriptionMarker(dir, name);
  if (previous) {
    if (previous.signature !== signature) {
      if (!window.confirm(msg('localStore.m1535'))) throw new TranscriptionError(msg('localStore.m1536'), "aborted");
    } else {
      try { return await waitForTranscription(previous.jobId, hooks); }
      catch (error) {
        if (!(error instanceof TranscriptionError) || ["backend_unreachable", "aborted"].includes(error.code)) throw error;
        if (!window.confirm(msg('localStore.m1537', { v0: error.message }))) throw error;
        await fetch(`/api/transcribe/jobs/${encodeURIComponent(previous.jobId)}`, {method:"DELETE"}).catch(() => {});
      }
    }
  }
  if (hooks?.signal?.aborted) throw new TranscriptionError(msg('localStore.m1538'), "aborted");
  const jobId = newJobId();
  await writeJson(dir, transcriptionMarker(name), {jobId, signature});
  hooks?.onProgress?.("uploading", 0);
  const formData = new FormData();
  formData.append("file", file, name);
  formData.append("job_id", jobId);
  formData.append("background", "true");
  formData.append(
    "options",
    JSON.stringify({
      language_code: options.language_code,
      num_speakers: options.num_speakers,
      diarize: options.diarize,
      tag_audio_events: options.tag_audio_events,
      timestamps_granularity: options.timestamps_granularity,
    }),
  );
  if (hooks?.providerId) {
    formData.append("provider_id", hooks.providerId);
  }

  // 用 XHR 而不是 fetch：只有 XHR 能报上传进度，也方便中途取消。
  // 一次长音频要传几百 MB，用户需要知道到底有没有在动。
  //
  // 注意这里有**两段**上传，XHR 只看得见前一段：把音频读给本地后端（走 localhost，很快）。
  // 真正的慢活在后面——后端要把音频传到云端存储，而那个状态只有后端知道，所以音频一交出去
  // 就开始按秒问后端（见 backend/app/progress.py）。
  const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: number | undefined;
    let pollingStopped = false;
    const stopPolling = () => {
      pollingStopped = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    xhr.open("POST", "/api/transcribe");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) hooks?.onProgress?.("uploading", event.loaded / event.total);
    };
    xhr.upload.onload = () => {
      const handedOffAt = Date.now();
      let sawServerProgress = false;
      let busy = false;
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          const state = await readTranscribeProgress(jobId);
          if (pollingStopped) return;
          if (state?.active) {
            sawServerProgress = true;
            if (state.phase === "processing") {
              // 上传完了，引擎开始识别。这一段没有进度可报，界面改成显示已用时间。
              hooks?.onProgress?.("processing");
              stopPolling();
              return;
            }
            const total = state.total_bytes ?? 0;
            hooks?.onProgress?.("sending", total > 0 ? (state.sent_bytes ?? 0) / total : 0);
            return;
          }
          // 后端还没登记这次上传。有些引擎本来就没有「先传到云端」这一步，
          // 过了宽限期就按原来的样子显示「识别中」，别让界面停在「读取音频 100%」。
          if (!sawServerProgress && Date.now() - handedOffAt > SERVER_PROGRESS_GRACE_MS) {
            hooks?.onProgress?.("processing");
          }
        } finally {
          busy = false;
        }
      };
      void tick();
      timer = window.setInterval(() => void tick(), PROGRESS_POLL_MS);
    };
    xhr.onload = () => {
      stopPolling();
      resolve({ status: xhr.status, text: xhr.responseText });
    };
    xhr.onerror = () => {
      stopPolling();
      reject(
        new TranscriptionError(
          msg('localStore.m1539'),
          "backend_unreachable",
        ),
      );
    };
    xhr.ontimeout = () => {
      stopPolling();
      reject(new TranscriptionError(msg('localStore.m1540'), "timeout"));
    };
    xhr.onabort = () => {
      stopPolling();
      reject(new TranscriptionError(msg('localStore.m1541'), "aborted"));
    };
    const abort = () => { xhr.abort(); reject(new TranscriptionError(msg('localStore.m1542'), "aborted")); };
    hooks?.signal?.addEventListener("abort", abort, {once:true});
    xhr.onloadend = () => hooks?.signal?.removeEventListener("abort", abort);
    if (hooks?.signal?.aborted) abort();
    else xhr.send(formData);
  });

  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* 后端可能返回纯文本（比如反向代理的错误页），留待下面按状态码处理 */
  }

  if (status < 200 || status >= 300) throw failureForStatus(status, body);
  if (status === 202) return waitForTranscription(jobId, hooks);
  if (!body) throw new TranscriptionError(msg('localStore.m1543'), "bad_response", text);
  return body as Transcript;
}

// ---- Rename (sync audio filename + both transcript sidecars) -----------------

export function sanitizeForFilename(title: string): string {
  // 移除文件系统非法字符，并去掉首尾空白。空格与中文原样保留。
  return title.replace(/[/\\:*?"<>|]/g, "").trim();
}

async function readRawJson(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<Record<string, unknown> | null> {
  try {
    const fileHandle = await (dir as unknown as {
      getFileHandle: (n: string) => Promise<{ getFile: () => Promise<File> }>;
    }).getFileHandle(name);
    const text = await (await fileHandle.getFile()).text();
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Copy with bounded-memory byte verification before any source is removed. */
async function copyVerifiedFile(source: FileSystemFileHandle, target: FileSystemFileHandle): Promise<void> {
  const original = await source.getFile();
  const writable = await target.createWritable();
  try {
    await writable.write(original);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  const copied = await target.getFile();
  if (copied.size !== original.size) throw new Error(msg('localStore.m1544'));
  for (let offset = 0; offset < original.size; offset += 1024 * 1024) {
    const end = offset + 1024 * 1024;
    const [a, b] = await Promise.all([
      original.slice(offset, end).arrayBuffer(), copied.slice(offset, end).arrayBuffer(),
    ]);
    const left = new Uint8Array(a), right = new Uint8Array(b);
    if (left.length !== right.length || left.some((byte, i) => byte !== right[i])) {
      throw new Error(msg('localStore.m1545'));
    }
  }
}

async function copyVerifiedDirectory(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle): Promise<void> {
  const entries = source as FileSystemDirectoryHandle & {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  for await (const [name, handle] of entries.entries()) {
    if (handle.kind === "directory") {
      await copyVerifiedDirectory(await source.getDirectoryHandle(name), await target.getDirectoryHandle(name, { create: true }));
    } else {
      await copyVerifiedFile(await source.getFileHandle(name), await target.getFileHandle(name, { create: true }));
    }
  }
}

/** Rename through verified copies: local browser directory handles do not support move(). */
async function renameAudioUnlocked(
  dir: FileSystemDirectoryHandle,
  oldName: string,
  newStem: string,
  title?: string,
): Promise<string> {
  if (!newStem || newStem !== sanitizeForFilename(newStem) || Array.from(newStem).some(char => char.charCodeAt(0) < 32) || newStem === "." || newStem === "..") {
    throw new Error(msg('localStore.m1546'));
  }
  const ext = oldName.includes(".") ? oldName.slice(oldName.lastIndexOf(".") + 1) : "";
  const newName = ext ? `${newStem}.${ext}` : newStem;
  if (newName === oldName) {
    if (title) {
      const container = await resolveTranscriptDir(dir, oldName, false);
      const manifest = await readManifestUnlocked(dir, oldName);
      if (container && manifest) await syncTranscriptNames(container, manifest, manifest, title);
    }
    return oldName;
  }
  const targetDirName = `${newStem}${TRANSCRIPT_DIR_SUFFIX}`;
  if (await hasSidecar(dir, newName)) throw new Error(msg('localStore.m1547', { v0: newName }));
  if (await dirExists(dir, targetDirName)) throw new Error(msg('localStore.m1548', { v0: targetDirName }));

  const audioHandle = await dir.getFileHandle(oldName);
  const oldTDir = await resolveTranscriptDir(dir, oldName, false);
  const originals = new Map<string, string>();
  if (oldTDir) {
    const raw = await readManifestText(oldTDir);
    if (!raw) throw new Error(msg('localStore.m1549'));
    const manifest = JSON.parse(raw) as TranscriptManifest;
    originals.set(MANIFEST_NAME, raw);
    for (const model of manifest.models) {
      for (const file of [model.original, ...model.edits.map(e => e.file)]) {
        if (!file) continue;
        const content = await readFileText(oldTDir, file);
        if (!content) throw new Error(msg('localStore.m1550', { v0: file }));
        JSON.parse(content);
        originals.set(file, content);
      }
    }
  }
  let newAudio: FileSystemFileHandle | undefined;
  let newTDir: FileSystemDirectoryHandle | undefined;
  let removingSources = false;
  try {
    newAudio = await dir.getFileHandle(newName, { create: true });
    await copyVerifiedFile(audioHandle, newAudio);
    if (oldTDir) {
      newTDir = await dir.getDirectoryHandle(targetDirName, { create: true });
      await copyVerifiedDirectory(oldTDir, newTDir);
      for (const [file, raw] of originals) {
        const data = JSON.parse(raw);
        const updated = file === MANIFEST_NAME ? { ...data, audio: newName } : withAudioName(data, newName);
        await writeFileJson(newTDir, file, updated);
        if (JSON.stringify(JSON.parse((await readFileText(newTDir, file)) ?? "null")) !== JSON.stringify(updated)) {
          throw new Error(msg('localStore.m1551', { v0: file }));
        }
      }
    }
    if (title && newTDir) {
      const manifest = JSON.parse((await readFileText(newTDir, MANIFEST_NAME))!);
      await syncTranscriptNames(newTDir, manifest, manifest, title);
    }
    removingSources = true;
    if (oldTDir) await dir.removeEntry(oldTDir.name, { recursive: true });
    await dir.removeEntry(oldName);
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    if (removingSources) {
      try {
        // Recursive deletion can fail halfway; reconstruct from the verified copy.
        if (oldTDir && newTDir) {
          const copiedManifest = JSON.parse((await readFileText(newTDir, MANIFEST_NAME))!) as TranscriptManifest;
          const copiedNames = copiedManifest.models.flatMap(m => [m.original, ...m.edits.map(e => e.file)]).filter((file): file is string => Boolean(file));
          const restored = await dir.getDirectoryHandle(oldTDir.name, { create: true });
          await copyVerifiedDirectory(newTDir, restored);
          for (const [file, raw] of originals) {
            const writable = await (await restored.getFileHandle(file, { create: true })).createWritable();
            await writable.write(raw);
            await writable.close();
            if (await readFileText(restored, file) !== raw) throw new Error(msg('localStore.m1552'), { cause: error });
          }
          for (const file of copiedNames) if (!originals.has(file)) await restored.removeEntry(file);
        }
        if (!(await hasSidecar(dir, oldName)) && newAudio) {
          await copyVerifiedFile(newAudio, await dir.getFileHandle(oldName, { create: true }));
        }
      } catch (failure) { recoveryErrors.push(failure); }
    }
    // Keep the verified destination if recovery failed; it may be the only complete copy.
    if (!recoveryErrors.length) {
      if (newTDir) try { await dir.removeEntry(targetDirName, { recursive: true }); } catch (failure) { recoveryErrors.push(failure); }
      if (newAudio) try { await dir.removeEntry(newName); } catch (failure) { recoveryErrors.push(failure); }
    }
    invalidateCache(dir);
    if (recoveryErrors.length) throw new Error(msg('localStore.m1553'), { cause: error });
    throw error;
  }
  invalidateCache(dir);
  return newName;
}

// One queue per directory handle prevents stale manifest writes inside this app session.
const directoryWrites = new WeakMap<FileSystemDirectoryHandle, Promise<unknown>>();
function inDirectory<T>(dir: FileSystemDirectoryHandle, operation: () => Promise<T>): Promise<T> {
  const previous = directoryWrites.get(dir) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  directoryWrites.set(dir, next);
  void next.finally(() => {
    if (directoryWrites.get(dir) === next) directoryWrites.delete(dir);
  }).catch(() => {});
  return next;
}
export const readManifest: typeof readManifestUnlocked = (...args) => inDirectory(args[0], () => readManifestUnlocked(...args));
export const readEdited: typeof readEditedUnlocked = (...args) => inDirectory(args[0], () => readEditedUnlocked(...args));
export const readModelEdit: typeof readModelEditUnlocked = (...args) => inDirectory(args[0], () => readModelEditUnlocked(...args));
export const readModelOriginal: typeof readModelOriginalUnlocked = (...args) => inDirectory(args[0], () => readModelOriginalUnlocked(...args));
export const createModel: typeof createModelUnlocked = (...args) => inDirectory(args[0], () => createModelUnlocked(...args));
export const createEdit: typeof createEditUnlocked = (...args) => inDirectory(args[0], () => createEditUnlocked(...args));
export const saveActiveEdit: typeof saveActiveEditUnlocked = (...args) => inDirectory(args[0], () => saveActiveEditUnlocked(...args));
export const persistActiveModel: typeof persistActiveModelUnlocked = (...args) => inDirectory(args[0], () => persistActiveModelUnlocked(...args));
export const renameModelLabel: typeof renameModelLabelUnlocked = (...args) => inDirectory(args[0], () => renameModelLabelUnlocked(...args));
export const renameEditLabel: typeof renameEditLabelUnlocked = (...args) => inDirectory(args[0], () => renameEditLabelUnlocked(...args));
export const removeEdit: typeof removeEditUnlocked = (...args) => inDirectory(args[0], () => removeEditUnlocked(...args));
export const removeModelOriginal: typeof removeModelOriginalUnlocked = (...args) => inDirectory(args[0], () => removeModelOriginalUnlocked(...args));
export const writeEdited: typeof writeEditedUnlocked = (...args) => inDirectory(args[0], () => writeEditedUnlocked(...args));
export const renameAudio: typeof renameAudioUnlocked = (...args) => inDirectory(args[0], () => renameAudioUnlocked(...args));
export const migrateAllLegacy: typeof migrateAllLegacyUnlocked = (...args) => inDirectory(args[0], () => migrateAllLegacyUnlocked(...args));

/** AI review drafts are separate from the manifest and never become editable versions implicitly. */
export async function readAIReviewDraft(dir: FileSystemDirectoryHandle, audio: string, key: string): Promise<import("./components/AIEditingDialog").AIReviewDraft | null> {
  const container = await resolveTranscriptDir(dir, audio, false);
  if (!container) return null;
  try {
    const drafts = await container.getDirectoryHandle("ai-review");
    const file = await drafts.getFileHandle(`${encodeURIComponent(key)}.json`);
    return JSON.parse(await (await file.getFile()).text());
  } catch (error) {
    if ((error as {name?:string}).name === "NotFoundError") return null;
    throw error;
  }
}

export async function writeAIReviewDraft(dir: FileSystemDirectoryHandle, audio: string, key: string, draft: import("./components/AIEditingDialog").AIReviewDraft | null): Promise<void> {
  const container = await resolveTranscriptDir(dir, audio, false);
  if (!container) throw new Error(msg('localStore.m1554'));
  const drafts = await container.getDirectoryHandle("ai-review", {create:true});
  const name = `${encodeURIComponent(key)}.json`;
  if (draft) await writeFileJson(drafts, name, draft);
  else {
    try { await drafts.removeEntry(name); }
    catch (error) { if ((error as {name?:string}).name !== "NotFoundError") throw error; }
  }
}

/** Stable across audio renames and modification versions, separate for each transcript container. */
export async function aiEditingDocumentId(dir: FileSystemDirectoryHandle, audio: string): Promise<string> {
  const container = await resolveTranscriptDir(dir, audio, false);
  if (!container) throw new Error(msg('localStore.m1555'));
  const name = "ai-preferences-id.json";
  try {
    const file = await container.getFileHandle(name);
    const value = JSON.parse(await (await file.getFile()).text());
    if (typeof value.id !== "string" || !value.id) throw new Error(msg('localStore.m1556'));
    return value.id;
  } catch (error) {
    if ((error as {name?:string}).name !== "NotFoundError") throw error;
  }
  const id = crypto.randomUUID();
  await writeFileJson(container, name, {id});
  return id;
}

export const saveInterviewDetails: typeof saveInterviewDetailsUnlocked = (...args) => inDirectory(args[0], () => saveInterviewDetailsUnlocked(...args));

export const setModelOriginal: typeof setModelOriginalUnlocked = (...args) => inDirectory(args[0], () => setModelOriginalUnlocked(...args));
