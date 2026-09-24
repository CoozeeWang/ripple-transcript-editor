import { msg } from '../i18n';
import { flushEditorDrafts } from "../lib/editorDrafts";
import type { ParagraphEditorElement } from "../lib/paragraphEditor";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Transcript } from "../types";
import { AUDIO_EXT_LABEL } from "../localStore";
import {
  FOLLOW_PLAYBACK_KEY,
  PLAYBACK_RATE_KEY,
  SKIP_SECONDS_KEY,
  loadBooleanPreference,
  loadNumberPreference,
  saveBooleanPreference,
  saveNumberPreference,
} from "../lib/preferences";
import { reanchorCharacters, timeForCharacter } from "../lib/transcriptOps";

const DEFAULT_SKIP_SECONDS = 3;

/** 播放控制跨领域依赖：本 hook 只拥有音频元素与播放/跟随状态，
 *  transcript 编辑、选中片段、错误提示等共享状态通过回调注入解耦。 */
export interface UsePlaybackDeps {
  transcript: Transcript | null;
  mutateTranscript: (
    updater: (current: Transcript) => Transcript,
    groupKey?: string,
  ) => void;
  activeSegmentId: string;
  setActiveSegmentId: (id: string) => void;
  setSelectedSegmentId: (id: string) => void;
  effectiveSelectedSegmentId: string;
  textareaRefs: { current: Map<string, ParagraphEditorElement> };
  setLoadError: (m: string) => void;
}

export function usePlayback(deps: UsePlaybackDeps) {
  const { transcript, setActiveSegmentId, setSelectedSegmentId, setLoadError, textareaRefs } = deps;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioFilename, setAudioFilename] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [actualDuration, setActualDuration] = useState(0);
  const [isPlaying, updateIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(() => loadNumberPreference(PLAYBACK_RATE_KEY, 1));
  const [skipSeconds, setSkipSeconds] = useState(() => loadNumberPreference(SKIP_SECONDS_KEY, DEFAULT_SKIP_SECONDS));
  const [defaultPlaybackRate, setDefaultPlaybackRate] = useState(() => loadNumberPreference(PLAYBACK_RATE_KEY, 1));
  const [followPlayback, setFollowPlayback] = useState<boolean>(() =>
    loadBooleanPreference(FOLLOW_PLAYBACK_KEY, true),
  );
  const [followingPaused, setFollowingPaused] = useState(false);
  const programScrollRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  const followPlaybackRef = useRef(followPlayback);
  const transcriptPanelRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    isPlayingRef.current = isPlaying;
    followPlaybackRef.current = followPlayback;
  }, [isPlaying, followPlayback]);

  type Cursor = { segmentId: string; charIndex: number };
  const lastEditorCursorRef = useRef<Cursor | null>(null);
  const pendingCursorRef = useRef(false);
  const playRequestedRef = useRef(false);
  const playRequestIdRef = useRef(0);


  const setIsPlaying = useCallback((playing: boolean) => {
    updateIsPlaying(playing);
    if (!playing) {
      setFollowingPaused(false);
      playRequestedRef.current = false;
    }
  }, []);

  useEffect(() => {
    saveNumberPreference(PLAYBACK_RATE_KEY, defaultPlaybackRate);
  }, [defaultPlaybackRate]);

  useEffect(() => {
    saveNumberPreference(SKIP_SECONDS_KEY, skipSeconds);
  }, [skipSeconds]);

  useEffect(() => {
    saveBooleanPreference(FOLLOW_PLAYBACK_KEY, followPlayback);
  }, [followPlayback]);

  useEffect(() => {
    return () => {
      if (audioUrl.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);


  useEffect(() => {
    lastEditorCursorRef.current = null;
    pendingCursorRef.current = false;
    playRequestedRef.current = false;
    playRequestIdRef.current++;
  }, [audioUrl]);

  const playAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const requestId = ++playRequestIdRef.current;
    playRequestedRef.current = true;
    void audio.play().catch((error: unknown) => {
      if (requestId !== playRequestIdRef.current) return;
      playRequestedRef.current = false;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : msg('usePlayback.m1140'));
    });
  }, [setLoadError]);

  const seekTo = useCallback((seconds: number, shouldPlay = false) => {
    const audio = audioRef.current;
    if (!audioUrl || !audio) return;
    // 明确跳转后，旧光标不能在下一次恢复播放时再次覆盖进度。
    pendingCursorRef.current = false;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
    setCurrentTime(audio.currentTime);
    const segment = transcript?.segments.find(item =>
      item.start <= audio.currentTime && audio.currentTime < item.end,
    );
    setActiveSegmentId(segment?.id ?? "");
    if (segment) setSelectedSegmentId(segment.id);
    if (shouldPlay && audio.paused) playAudio();
  }, [audioUrl, transcript, setActiveSegmentId, setSelectedSegmentId, playAudio]);

  const recordEditorCursor = useCallback((segmentId: string, charIndex: number, explicit = false) => {
    const last = lastEditorCursorRef.current;
    if (explicit || last?.segmentId !== segmentId || last.charIndex !== charIndex) {
      pendingCursorRef.current = true;
    }
    lastEditorCursorRef.current = { segmentId, charIndex };
  }, []);

  // 主动暂停后重新播放，从编辑光标开始；播放中输入本身不触发定位。
  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audioUrl || !audio) return;
    if (!audio.paused || (playRequestedRef.current && !audio.ended)) {
      playRequestedRef.current = false;
      playRequestIdRef.current++;
      // 快捷键暂停时保留最新光标；按钮暂停时使用编辑框失焦记录的光标。
      for (const [segmentId, editor] of textareaRefs.current) {
        if (document.activeElement !== editor) continue;
        const cursor = { segmentId, charIndex: editor.selectionStart };
        lastEditorCursorRef.current = cursor;
        break;
      }
      pendingCursorRef.current = lastEditorCursorRef.current !== null;
      audio.pause();
      return;
    }
    let target = pendingCursorRef.current ? lastEditorCursorRef.current : null;
    for (const [id, editor] of textareaRefs.current.entries()) {
      if (document.activeElement !== editor) continue;
      const cursor = { segmentId: id, charIndex: editor.selectionStart };
      target = cursor;
      break;
    }
    // 先记下输入框中最新文字，再 flush（flush 可能重建/卸载输入框）。
    const draft = target ? textareaRefs.current.get(target.segmentId)?.value : undefined;
    flushEditorDrafts();
    if (target && transcript?.timeAligned !== false) {
      const segment = transcript?.segments.find(item => item.id === target.segmentId);
      if (segment) {
        lastEditorCursorRef.current = target;
        // 从文字光标播放属于编辑操作，保留视口，不把长片段的中部滚到眼前。
        setFollowingPaused(true);
        programScrollRef.current = false;
        const panel = transcriptPanelRef.current;
        panel?.scrollTo?.({ top: panel.scrollTop, behavior: "instant" });
        seekTo(timeForCharacter(draft === undefined ? segment : { ...segment, text: draft, words: reanchorCharacters(segment.words, segment.text, draft) }, target.charIndex), true);
        return;
      }
    }
    pendingCursorRef.current = false;
    playAudio();
  }, [audioUrl, textareaRefs, transcript, seekTo, playAudio]);

  const togglePlayFromCursor = togglePlayback;

  const handleAudioMetadata = () => {
    const duration = audioRef.current?.duration ?? 0;
    // 载入音频时套用偏好里的默认播放速度。
    if (audioRef.current) audioRef.current.playbackRate = playbackRate || defaultPlaybackRate;
    setPlaybackRate(playbackRate || defaultPlaybackRate);
    setActualDuration(duration);
    deps.mutateTranscript((current) => ({
      ...current,
      audio: { filename: audioFilename, duration },
    }));
  };

  /**
   * 解码不了的格式（浏览器的锅，不是文件的锅）不会抛异常、也不会播放，
   * 以前点了播放毫无反应，用户只会以为软件坏了。这里把原因说出来。
   */
  const handleAudioError = () => {
    if (!audioUrl) return;
    const name = audioFilename || msg('usePlayback.m1141');
    const code = audioRef.current?.error?.code;
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      deps.setLoadError(
        msg('usePlayback.m1142', { v0: name, v1: AUDIO_EXT_LABEL }),
      );
    } else if (code === MediaError.MEDIA_ERR_DECODE) {
      // 解码失败 ≠ 文件坏了：常见于录音工具导出的裸 .aac 带一个浏览器解不开的首帧。
      // 别让用户去「重新导出一份音频」——先让他确认文件内容到底在不在。
      deps.setLoadError(
        msg('usePlayback.m1143', { v0: name }),
      );
    } else if (code === MediaError.MEDIA_ERR_NETWORK) {
      deps.setLoadError(msg('usePlayback.m1144', { v0: name }));
    } else {
      deps.setLoadError(msg('usePlayback.m1145', { v0: name, v1: AUDIO_EXT_LABEL }));
    }
    setIsPlaying(false);
  };

  // 手动滚动只暂停视口跟随，不改变当前片段或右侧面板内容。
  useEffect(() => {
    const panel = transcriptPanelRef.current;
    if (!panel || !deps.transcript) return;
    const onScroll = () => {
      if (!programScrollRef.current && isPlayingRef.current && followPlaybackRef.current) {
        setFollowingPaused(true);
      }
    };
    const onPointerDown = () => {
      if (!isPlayingRef.current) return;
      // 点击文字时停止正在进行的平滑滚动，避免内容在按下与松开之间移动。
      setFollowingPaused(true);
      programScrollRef.current = false;
      panel.scrollTo({ top: panel.scrollTop, behavior: "instant" });
    };
    panel.addEventListener("scroll", onScroll, { passive: true });
    panel.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      panel.removeEventListener("scroll", onScroll);
      panel.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [deps.transcript]);

  const updateCurrentSegment = () => {
    const audio = audioRef.current;
    if (!audio || !deps.transcript) return;
    setCurrentTime(audio.currentTime);
    const active = deps.transcript.segments.find(
      (segment) => segment.start <= audio.currentTime && audio.currentTime < segment.end,
    );
    deps.setActiveSegmentId(active?.id ?? "");
    // 播放时焦点片段跟随播放位置，批注栏随之滚动到当前片段。
    if (active?.id) deps.setSelectedSegmentId(active.id);
  };

  // 回到播放位置：清除暂停态并立即把当前片段滚到转录区中央。
  const resumeFollow = useCallback(() => {
    setFollowingPaused(false);
    const panel = transcriptPanelRef.current;
    const el = panel?.querySelector(`#segment-${deps.activeSegmentId}`);
    if (panel && el) {
      programScrollRef.current = true;
      const panelRect = panel.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const target = panel.scrollTop + (elRect.top - panelRect.top) - panel.clientHeight / 2 + elRect.height / 2;
      panel.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      window.setTimeout(() => {
        programScrollRef.current = false;
      }, 700);
    }
  }, [deps.activeSegmentId]);

  // 播放时把当前片段滚到转录区中央（仅滚面板，不动整页）。手动滚动会置 followingPaused 暂停跟随。
  useEffect(() => {
    if (!isPlaying || !followPlayback || followingPaused || !deps.activeSegmentId) return;
    const panel = transcriptPanelRef.current;
    const el = panel?.querySelector(`#segment-${deps.activeSegmentId}`);
    if (!panel || !el) return;
    programScrollRef.current = true;
    const panelRect = panel.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const target = panel.scrollTop + (elRect.top - panelRect.top) - panel.clientHeight / 2 + elRect.height / 2;
    panel.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    window.setTimeout(() => {
      programScrollRef.current = false;
    }, 700);
  }, [isPlaying, followPlayback, followingPaused, deps.activeSegmentId]);

  return {
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
    followPlayback,
    setFollowPlayback,
    followingPaused,
    setFollowingPaused,
    programScrollRef,
    isPlayingRef,
    followPlaybackRef,
    transcriptPanelRef,
    seekTo,
    togglePlayback,
    togglePlayFromCursor,
    recordEditorCursor,
    updateCurrentSegment,
    resumeFollow,
    handleAudioMetadata,
    handleAudioError,
  };
}
