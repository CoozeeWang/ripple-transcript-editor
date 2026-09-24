import { msg } from '../i18n';
import type { CSSProperties } from "react";
import type { Speaker } from "../types";

// 规范化说话人名称：去首尾空格、全角转半角、转小写。用于合并检测时忽略
// 半角/全角、大小写等细微差异（例如「Speaker 1」与「ｓｐｅａｋｅｒ 1」应判为同名）。
export function normalizeSpeakerName(name: string): string {
  return name
    .trim()
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .toLowerCase();
}

export const speakerColorNames = () => [msg('speakers.m1469'), msg('speakers.m1470'), msg('speakers.m1471'), msg('speakers.m1472'), msg('speakers.m1473'), msg('speakers.m1474'), msg('speakers.m1475'), msg('speakers.m1476'), msg('speakers.m1477'), msg('speakers.m1478')];
export const SPEAKER_PALETTE = ["#327884", "#B56555", "#596FA8", "#5B865F", "#9272A5", "#B2953F", "#B65E7F", "#649EB7", "#8B8175", "#805C47"];

// Prefer the first unused preset; after all presets are used, repeat in palette order.
export function nextSpeakerColorIndex(speakers: Speaker[]): number {
  const used = new Set(speakers.map((speaker,index) =>
    SPEAKER_PALETTE.findIndex(color => color.toLowerCase() === speakerAccent(speaker,index).toLowerCase())));
  for (let i = 0; i < SPEAKER_PALETTE.length; i++) if (!used.has(i)) return i;
  return speakers.length % SPEAKER_PALETTE.length;
}

export function validSpeakerColor(color: unknown): color is string {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
}
export function speakerAccent(speaker: Speaker | undefined, index = 0): string {
  if (validSpeakerColor(speaker?.color)) return speaker.color;
  return SPEAKER_PALETTE[(speaker?.colorIndex ?? Math.max(0, index)) % SPEAKER_PALETTE.length] ?? SPEAKER_PALETTE[0];
}
export function speakerColorStyle(speaker: Speaker | undefined, panel = false, index = 0): CSSProperties {
  const color = speakerAccent(speaker, index);
  return {
    "--speaker-accent": color,
    "--speaker-bg": `${color}${panel ? "24" : "0d"}`,
    "--speaker-hover-bg": `${color}12`,
    "--speaker-selected-bg": `${color}1c`,
  } as CSSProperties;
}
