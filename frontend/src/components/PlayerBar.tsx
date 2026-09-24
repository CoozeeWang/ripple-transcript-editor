import { msg, useInterfaceLanguage } from '../i18n';
import type { CSSProperties } from "react";

import { formatTime } from "../lib/format";

/** 播放条：audio 元素 + 播放/暂停 + 快进快退 + 进度条 + 倍速 + 段位置。
 *  播放域状态与操作全部 props 注入。 */
export interface PlayerBarProps {
  audioRef: { current: HTMLAudioElement | null };
  audioUrl: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  skipSeconds: number;
  playbackRate: number;
  selectedIndex: number;
  segmentCount: number;
  handleAudioMetadata: () => void;
  handleAudioError: () => void;
  updateCurrentSegment: () => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlayback: () => void;
  seekTo: (seconds: number, shouldPlay?: boolean) => void;
  setPlaybackRate: (rate: number) => void;
}

export function PlayerBar(props: PlayerBarProps) {
  useInterfaceLanguage();
  const {
    audioRef,
    audioUrl,
    isPlaying,
    currentTime,
    duration,
    skipSeconds,
    playbackRate,
    selectedIndex,
    segmentCount,
    handleAudioMetadata,
    handleAudioError,
    updateCurrentSegment,
    setIsPlaying,
    togglePlayback,
    seekTo,
    setPlaybackRate,
  } = props;

  return (
    <footer className="player-bar">
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onLoadedMetadata={handleAudioMetadata}
        onError={handleAudioError}
        onTimeUpdate={updateCurrentSegment}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
      <button
        className={"play-button" + (isPlaying ? " play-button--playing" : "")}
        type="button"
        onClick={togglePlayback}
        disabled={!audioUrl}
        aria-label={isPlaying ? msg('PlayerBar.m0628') : msg('PlayerBar.m0629')}
      >
        {isPlaying ? "Ⅱ" : "▶"}
      </button>
      <button
        type="button"
        className="skip-button"
        onClick={() => seekTo(currentTime - skipSeconds)}
        disabled={!audioUrl}
        aria-label={msg('PlayerBar.m0630', { v0: skipSeconds })}
      >
        <svg
          className="skip-icon"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M13 7 L8 12 L13 17" />
          <path d="M20 7 L15 12 L20 17" />
        </svg>
        {skipSeconds}s
      </button>
      <div className="timeline">
        <input
          type="range"
          min="0"
          max={Math.max(duration, 0.1)}
          step="0.05"
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => seekTo(Number(event.target.value))}
          disabled={!audioUrl}
          aria-label={msg('PlayerBar.m0631')}
          style={
            {
              "--progress": `${(Math.min(currentTime, duration || 0) / Math.max(duration, 0.1)) * 100}%`,
            } as CSSProperties
          }
        />
        <div className="time-labels">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <button
        type="button"
        className="skip-button"
        onClick={() => seekTo(currentTime + skipSeconds)}
        disabled={!audioUrl}
        aria-label={msg('PlayerBar.m0632', { v0: skipSeconds })}
      >
        <svg
          className="skip-icon"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 7 L16 12 L11 17" />
          <path d="M4 7 L9 12 L4 17" />
        </svg>
        {skipSeconds}s
      </button>
      <select
        className="speed-select"
        value={playbackRate}
        aria-label={msg('PlayerBar.m0633')}
        onChange={(event) => {
          const rate = Number(event.target.value);
          setPlaybackRate(rate);
          if (audioRef.current) audioRef.current.playbackRate = rate;
        }}
      >
        {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
          <option value={rate} key={rate}>
            {rate}×
          </option>
        ))}
      </select>
      <div className="segment-position">
        {selectedIndex >= 0 ? `${selectedIndex + 1} / ${segmentCount}` : "—"}
      </div>
    </footer>
  );
}
