import { msg } from '../i18n';
import { startTranscriptionTiming } from "../lib/transcriptionTimings";
import { recordProblem } from "../lib/diagnostics";
import { useLayoutEffect, useEffect, useRef, useState } from "react";
import type {
  InterviewMetadata,
  Transcript,
  TranscriptManifest,
  TranscriptionOptions,
} from "../types";
import {
  type TranscriptionPhase,
  TranscriptionError,
  createModel,
  acknowledgeTranscription,
  transcribeAudio,
} from "../localStore";
import type { NamingTarget, ProcessStatus } from "./useVersions";

export type SaveStatus = "loading" | "unsaved" | "saving" | "saved" | "error";

// 转录失败后，每种原因给一句「下一步做什么」。光说哪里错了没用，得说怎么修。
const TRANSCRIPTION_HINTS: Record<string, string> = {
  get invalid_api_key() { return msg('useTranscription.m1148'); },
  get no_api_key() { return msg('useTranscription.m1149'); },
  get no_base_url() { return msg('useTranscription.m1150'); },
  get quota_exceeded() { return msg('useTranscription.m1151'); },
  get rate_limited() { return msg('useTranscription.m1152'); },
  get file_too_large() { return msg('useTranscription.m1153'); },
  get too_long() { return msg('useTranscription.m1154'); },
  get unsupported_format() { return msg('useTranscription.m1155'); },
  get unsupported_option() { return msg('useTranscription.m1156'); },
  get service_not_enabled() { return msg('useTranscription.m1157'); },
  get bad_request() { return msg('useTranscription.m1158'); },
  // 这三条只说「下一步做什么」。事发经过与「多半是网络波动」由后端写在报错正文里，
  // 所以这里不重复，也不点名任何具体引擎（提示是给所有用户看的，不带某个人的引擎配置）。
  get network() { return msg('useTranscription.m1159'); },
  get upload_timeout() { return msg('useTranscription.m1160'); },
  get response_timeout() { return msg('useTranscription.m1161'); },
  get backend_unreachable() { return msg('useTranscription.m1162'); },
  get upstream_error() { return msg('useTranscription.m1163'); },
  get empty_result() { return msg('useTranscription.m1164'); },
  get bad_response() { return msg('useTranscription.m1165'); },
};

/** 正在跑的那个转录任务。任务是「某个文件」的事，不是「当前这一屏」的事——
 *  用户切到别的文件时它照跑，界面必须据此继续显示进度，而不是把它当成没发生过。 */
export interface TranscribeJob {
  /** 正在转录的音频文件名。 */
  audio: string;
  /** 转录目标所属的上下文（模型 / 版本 / 是否原稿）；用于判断「当前看的正是它」。 */
  contextKey?: string;
  /** 引擎名，提示条上要写清是哪个引擎在跑。 */
  engine: string;
}

/** 转录流程跨领域依赖：本 hook 只拥有转录过程状态与启动/取消，
 *  transcript / 版本 / 进度提示等共享状态通过回调注入解耦。 */
export interface UseTranscriptionDeps {
  initialMetadata?: InterviewMetadata;
  beforeChange?: () => Promise<void>;
  contextKey?: string;
  setViewingOriginal?: (value: boolean) => void;
  dirHandleRef: { current: FileSystemDirectoryHandle | null };
  selectedAudio: string | null;
  providers: { id: string; name: string }[];
  setActiveProviderName: (name: string) => void;
  processStatus: ProcessStatus;
  setProcessStatus: (s: ProcessStatus) => void;
  setProcessMessage: (m: string) => void;
  setMetadata: (m: InterviewMetadata | null) => void;
  reset: (t: Transcript) => void;
  setSelectedSegmentId: (id: string) => void;
  setHasLoadedTranscript: (b: boolean) => void;
  setSaveStatus: (s: SaveStatus) => void;
  applyManifest: (manifest: TranscriptManifest | null, modelId?: string | null) => void;
  setNamingTarget: (t: NamingTarget | null) => void;
  setNamingOpen: (b: boolean) => void;
  setNamingValue: (v: string) => void;
  refreshAudioList: (dir: FileSystemDirectoryHandle | null) => Promise<void>;
}

export function useTranscription(deps: UseTranscriptionDeps) {
  const latest = useRef(deps);
  useLayoutEffect(() => { latest.current = deps; }, [deps]);
  const [transcriptionDialogOpen, setTranscriptionDialogOpen] = useState(false);
  const [transcribePhase, setTranscribePhase] =
    useState<TranscriptionPhase>("uploading");
  const [transcribeRatio, setTranscribeRatio] = useState(0);
  const [transcribeElapsed, setTranscribeElapsed] = useState(0);
  const [transcribeHint, setTranscribeHint] = useState("");
  const [transcribeRaw, setTranscribeRaw] = useState("");
  const [transcribeJob, setTranscribeJob] = useState<TranscribeJob | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 转录期间的计时：识别阶段没有进度可报，至少让用户知道时间在走、程序没死。
  // 计时跟着任务走而不是跟着界面状态走——切到别的文件时任务还在跑，秒数不能停。
  const transcribing = transcribeJob !== null;
  useEffect(() => {
    if (!transcribing) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setTranscribeElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [transcribing]);

  const startTranscription = async (
    options: TranscriptionOptions,
    providerId: string,
  ) => {
    const dir = deps.dirHandleRef.current;
    if (!dir || !deps.selectedAudio) {
      deps.setProcessStatus("error");
      deps.setProcessMessage(msg('useTranscription.m1166'));
      throw new Error(msg('review.RS029'));
    }
    if (abortRef.current) {
      // 同一时间只允许一个任务。提示里带上是谁在跑，否则用户不知道怎么脱身。
      throw new Error(
        transcribeJob
          ? msg('useTranscription.m1167', { v0: transcribeJob.audio })
          : msg('useTranscription.m1168'),
      );
    }
    const audioName = deps.selectedAudio;
    const contextKey = deps.contextKey;
    const isCurrent = () => latest.current.dirHandleRef.current === dir &&
      latest.current.selectedAudio === audioName && latest.current.contextKey === contextKey;
    const controller = new AbortController();
    abortRef.current = controller;
    // 关掉设置弹窗，否则它会盖住顶部的进度条和取消按钮。
    setTranscriptionDialogOpen(false);
    const engineLabel =
      deps.providers.find((p) => p.id === providerId)?.name ?? msg('useTranscription.m1169');
    // 先登记任务，再改状态：任务身份是「转录中」这块界面唯一的依据。
    setTranscribeJob({ audio: audioName, contextKey, engine: engineLabel });
    deps.setProcessStatus("transcribing");
    setTranscribePhase("uploading");
    setTranscribeRatio(0);
    setTranscribeElapsed(0);
    setTranscribeHint("");
    setTranscribeRaw("");
    deps.setActiveProviderName(engineLabel);
    deps.setProcessMessage(msg('useTranscription.m1170'));
    const timing = startTranscriptionTiming();
    let saved = false;
    let wasCancelled = false;
    try {
      await deps.beforeChange?.();
      const transcript = await transcribeAudio(dir, audioName, options, {
        signal: controller.signal,
        providerId,
        onProgress: (phase, ratio) => {
          timing.stage(phase);
          setTranscribePhase(phase);
          if (ratio !== undefined) setTranscribeRatio(ratio);
        },
      });
      if (controller.signal.aborted) throw new TranscriptionError(msg('useTranscription.m1171'), "aborted");
      if (!transcript.segments || transcript.segments.length === 0) {
        // 识别成功但一个片段都没有：多半是音频无声或格式被静音处理，
        // 不该写一份空稿进去让用户以为转录坏了。
        throw new TranscriptionError(
          msg('useTranscription.m1172'),
          "empty_result",
        );
      }
      if (isCurrent()) await latest.current.beforeChange?.();
      if (controller.signal.aborted) throw new TranscriptionError(msg('useTranscription.m1173'), "aborted");
      timing.stage("saving");
      setTranscribePhase("saving");
      const { model, manifest, edited } = await createModel(dir, audioName, {
        engine: engineLabel,
        transcript,
        original: transcript,
        originalOnly: true,
        metadata: deps.initialMetadata,
      });
      saved = true;
      await acknowledgeTranscription(dir, audioName).catch(() => {});
      if (!isCurrent()) {
        // 用户已经切走（换了文件或换了版本）。稿子已经写进磁盘，但绝不能拿它去覆盖
        // 他正在看的内容；只刷新文件列表，并留一句话告诉他成果在哪。
        await deps.refreshAudioList(dir);
        deps.setProcessStatus("done");
        deps.setProcessMessage(
          msg('useTranscription.m1174', { v0: audioName, v1: edited.transcript.segments.length }),
        );
        return;
      }
      deps.setViewingOriginal?.(true);
      deps.setMetadata(edited.metadata);
      deps.reset(edited.transcript);
      deps.setSelectedSegmentId(edited.transcript.segments[0]?.id ?? "");
      deps.applyManifest(manifest, model.id);
      deps.setHasLoadedTranscript(true);
      deps.setSaveStatus("saved");
      deps.setProcessStatus("done");
      deps.setProcessMessage(
        msg('useTranscription.m1175', { v0: edited.transcript.segments.length }),
      );
      setTranscriptionDialogOpen(false);

      await deps.refreshAudioList(dir);
    } catch (error) {
      const failure =
        error instanceof TranscriptionError
          ? error
          : new TranscriptionError(
              error instanceof Error ? error.message : msg('useTranscription.m1176'),
              "unknown",
            );
      // 用户自己取消不算出错，用中性样式显示，不染成红色。
      const cancelled = failure.code === "aborted";
      wasCancelled = cancelled;
      if (!cancelled) recordProblem("transcription", failure);
      if (!isCurrent()) {
        // 切走之后才失败/取消的：调用方早已不在界面上，别再往它那儿抛，
        // 只在当前这一屏留一句交代，说明刚才那个任务怎么了。
        deps.setProcessStatus(cancelled ? "idle" : "error");
        deps.setProcessMessage(
          cancelled
            ? msg('useTranscription.m1177', { v0: audioName })
            : msg('useTranscription.m1178', { v0: audioName, v1: failure.message }),
        );
        return;
      }
      deps.setProcessStatus(cancelled ? "idle" : "error");
      deps.setProcessMessage(failure.message);
      setTranscribeHint(cancelled ? "" : TRANSCRIPTION_HINTS[failure.code] ?? "");
      setTranscribeRaw(cancelled ? "" : failure.raw ?? "");
      throw error;
    } finally {
      timing.finish(saved ? "ok" : wasCancelled || controller.signal.aborted ? "cancelled" : "failed");
      if (abortRef.current === controller) abortRef.current = null;
      setTranscribeJob(null);
    }
  };

  const cancelTranscription = () => {
    abortRef.current?.abort();
  };

  return {
    transcriptionDialogOpen,
    setTranscriptionDialogOpen,
    /** 正在跑的任务（含它属于哪个文件）；为 null 表示没有任务。 */
    transcribeJob,
    transcribePhase,
    transcribeRatio,
    transcribeElapsed,
    transcribeHint,
    transcribeRaw,
    startTranscription,
    cancelTranscription,
  };
}
