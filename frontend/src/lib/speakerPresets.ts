import { validSpeakerColor } from './speakers';
const KEY = 'ripple-speaker-presets-v1';
export const SPEAKER_PRESETS_EVENT = 'ripple:speaker-presets';
export function readSpeakerPresets(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter(validSpeakerColor).map(c=>c.toUpperCase()))] : [];
  } catch { return []; }
}
export function saveSpeakerPresets(colors: string[]) {
  const clean = [...new Set(colors.filter(validSpeakerColor).map(c=>c.toUpperCase()))];
  localStorage.setItem(KEY,JSON.stringify(clean));
  window.dispatchEvent(new Event(SPEAKER_PRESETS_EVENT));
}
