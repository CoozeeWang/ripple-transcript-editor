// localStorage 偏好的读写工具。前端持久、不依赖后端 .env。
// 所有读写都用 try/catch 包裹，localStorage 不可用（隐私模式等）时静默降级为默认值。

export const LAST_INTERVIEW_KEY = "te-last-interview";

export function saveInterviewId(id: string): void {
  try {
    localStorage.setItem(LAST_INTERVIEW_KEY, id);
  } catch {
    /* localStorage unavailable; ignore */
  }
}

// 播放相关的偏好。
export const PLAYBACK_RATE_KEY = "te-default-playback-rate";
export const SKIP_SECONDS_KEY = "te-skip-seconds";
export const HIDDEN_SPEAKERS_KEY = "te-hidden-speakers";
export const FOLLOW_PLAYBACK_KEY = "te-follow-playback";
// 界面布局偏好：侧栏是否收起。说话人栏在左、批注栏在右，各自独立持久化。
export const SPEAKER_PANEL_COLLAPSED_KEY = "te-speaker-panel-collapsed";
export const ANNOTATION_PANEL_COLLAPSED_KEY = "te-annotation-panel-collapsed";

export function loadNumberPreference(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function saveNumberPreference(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* localStorage unavailable; ignore */
  }
}

export function loadSetPreference(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((item): item is string => typeof item === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function saveSetPreference(key: string, value: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    /* localStorage unavailable; ignore */
  }
}

export function loadBooleanPreference(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

export function saveBooleanPreference(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* localStorage unavailable; ignore */
  }
}
