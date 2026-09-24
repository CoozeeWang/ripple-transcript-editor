import { msg } from '../i18n';
import { recordProblem } from "../lib/diagnostics";
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useDismissable } from "../useDismissable";
import type { Transcript } from "../types";
import {
  AUDIO_EXT_LABEL,
  createModel,
  ensureWordSpeakers,
  listAudioFiles,
  stemOf,
} from "../localStore";
import { inspectTranscript } from "../lib/import";
import { probeAudioDuration } from "../lib/audio";
import { formatTime, today } from "../lib/format";
import type { NamingTarget } from "./useVersions";

/** 导入转录时无法确定对应音频的选择器状态。 */
export interface MatchPrompt {
  transcript: Transcript;
  sourceName: string;
  target: string;
  candidates: string[];
  choice: string;
  warning: string | null;
  checking: boolean;
}

/** 导入流程跨领域依赖：本 hook 只拥有匹配弹窗与导入内部 ref，
 *  loadAudio / 命名弹窗 / 错误提示等通过回调注入解耦。 */
export interface UseImportDeps {
  dirHandleRef: { current: FileSystemDirectoryHandle | null };
  audioFiles: { name: string }[];
  selectedAudio: string | null;
  loadAudio: (name: string) => Promise<void>;
  refreshAudioList: (dir: FileSystemDirectoryHandle | null) => Promise<void>;
  setLoadError: (m: string) => void;
  setImportRepairs: (r: string[]) => void;
  setNamingTarget: (t: NamingTarget | null) => void;
  setNamingOpen: (b: boolean) => void;
  setNamingValue: (v: string) => void;
}

export function useImport(deps: UseImportDeps) {
  const [matchPrompt, setMatchPrompt] = useState<MatchPrompt | null>(null);
  const matchRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // 导入时自动修补过的项目（缺说话人名单、缺段落编号等），在命名弹窗里告知用户。
  const pendingRepairsRef = useRef<string[]>([]);
  // 导入时从 JSON 顶层识别到的引擎（若导出方写了 engine），透传给 finishImport。
  const pendingEngineRef = useRef<string | null>(null);

  useDismissable(matchRef, Boolean(matchPrompt), () => setMatchPrompt(null));

  /** 把转录挂到指定音频下：写入模型后整体重载该音频，保证内存状态与磁盘一致。 */
  const finishImport = async (audioName: string, transcript: Transcript) => {
    const dir = deps.dirHandleRef.current;
    if (!dir) return;
    try {
      const label = `导入 · ${today()}`;
      const engine = pendingEngineRef.current || "imported";
      pendingEngineRef.current = null;
      const { model } = await createModel(dir, audioName, {
        engine,
        sourceKind: "import",
        original: transcript,
        transcript: {
          ...transcript,
          audio: { ...transcript.audio, filename: audioName },
        },
      });
      await deps.loadAudio(audioName);
      await deps.refreshAudioList(dir);
      deps.setLoadError("");
      deps.setImportRepairs(pendingRepairsRef.current);
      pendingRepairsRef.current = [];
      deps.setNamingTarget({ kind: "edit", modelId: model.id, editId: model.activeEditId });
      deps.setNamingOpen(true);
      deps.setNamingValue(label);
    } catch (error) {
        recordProblem("import", error);
      deps.setLoadError(error instanceof Error ? error.message : msg('useImport.m1124'));
    }
  };

  /** 落盘前的最后一道关：探一次音频时长，转录比音频长太多就先问一次。 */
  const importWithDurationGuard = async (
    audioName: string,
    transcript: Transcript,
    sourceName: string,
    candidates: string[],
  ) => {
    const dir = deps.dirHandleRef.current;
    if (!dir) return;
    const transcriptEnd = transcript.segments.reduce((max, s) => Math.max(max, s.end ?? 0), 0);
    const duration = await probeAudioDuration(dir, audioName);
    if (duration && transcriptEnd > duration + 30 && transcriptEnd > duration * 1.05) {
      setMatchPrompt({
        transcript,
        sourceName,
        target: audioName,
        candidates: candidates.includes(audioName) ? candidates : [audioName, ...candidates],
        choice: audioName,
        warning: msg('useImport.m1125', { v0: formatTime(transcriptEnd), v1: audioName, v2: formatTime(duration) }),
        checking: false,
      });
      return;
    }
    setMatchPrompt(null);
    await finishImport(audioName, transcript);
  };

  /**
   * 导入的转录该配哪个音频：先按转录里记录的 audio.filename 精确/同主干名匹配，
   * 匹配不上（或文件夹里音频不止一个且名字对不上）就交给用户明确选择，绝不静默挂错。
   */
  const matchAndImport = async (transcript: Transcript, sourceName: string) => {
    const dir = deps.dirHandleRef.current;
    if (!dir) return;
    let candidates: string[];
    try {
      candidates = (await listAudioFiles(dir)).map((entry) => entry.name);
    } catch {
      candidates = deps.audioFiles.map((entry) => entry.name);
    }
    if (candidates.length === 0) {
      deps.setLoadError(
        msg('useImport.m1126', { v0: AUDIO_EXT_LABEL }),
      );
      return;
    }

    const target = transcript.audio?.filename ?? "";
    const exact = target ? candidates.find((name) => name === target) : undefined;
    const byStem = target ? candidates.find((name) => stemOf(name) === stemOf(target)) : undefined;
    const unique = candidates.length === 1 ? candidates[0] : undefined;
    const matched = exact ?? byStem ?? unique;
    if (matched) {
      // 自动匹配也要过时长校验：名字对上但长度差一大截，同样可能是拿错了文件。
      await importWithDurationGuard(matched, transcript, sourceName, candidates);
      return;
    }

    setMatchPrompt({
      transcript,
      sourceName,
      target,
      candidates,
      choice:
        deps.selectedAudio && candidates.includes(deps.selectedAudio)
          ? deps.selectedAudio
          : candidates[0],
      warning: null,
      checking: false,
    });
  };

  // 选择器里点「确认导入」：同样先过时长校验。
  const confirmMatch = async () => {
    if (!matchPrompt) return;
    const { transcript, choice, sourceName, candidates } = matchPrompt;
    setMatchPrompt((prev) => (prev ? { ...prev, checking: true } : prev));
    await importWithDurationGuard(choice, transcript, sourceName, candidates);
  };

  const handleTranscriptFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    pendingRepairsRef.current = [];
    pendingEngineRef.current = null;
    const dir = deps.dirHandleRef.current;
    if (!dir) {
      deps.setLoadError(msg('useImport.m1127'));
      event.target.value = "";
      return;
    }

    try {
      if (!/\.json$/i.test(file.name)) {
        throw new Error(
          msg('useImport.m1128', { v0: file.name }),
        );
      }
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch (error) {
        recordProblem("import", error);
        const detail = error instanceof Error ? error.message : "";
        throw new Error(
          msg('useImport.m1129', { v0: file.name, v1: detail ? `：${detail}` : "" }),
          { cause: error },
        );
      }
      const checked = inspectTranscript(data);
      if (!checked.ok) throw new Error(checked.message);
      // 自愈导入来源中可能缺失的 word 级说话人（历史遗留/部分导出格式不带逐词说话人）。
      const transcript = ensureWordSpeakers(checked.transcript);
      pendingRepairsRef.current = checked.repairs;
      pendingEngineRef.current = checked.engine ?? null;
      await matchAndImport(transcript, file.name);
    } catch (error) {
        recordProblem("import", error);
      deps.setLoadError(error instanceof Error ? error.message : msg('useImport.m1130'));
    } finally {
      event.target.value = "";
    }
  };

  return {
    matchPrompt,
    setMatchPrompt,
    matchRef,
    importInputRef,
    finishImport,
    confirmMatch,
    handleTranscriptFile,
  };
}
