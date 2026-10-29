import channelConfig from '../../../desktop/segment-link-config.json';
import { msg } from '../i18n';
import type { Segment, Transcript } from '../types';
import { formatTime } from './format';

// Version the public contract independently of application releases. No filesystem paths.
export const SEGMENT_SCHEME = `${import.meta.env.PROD ? channelConfig.production.scheme : channelConfig.development.scheme}:`;
export interface SegmentTarget { project: string; recording: string; model: string; version: string; segment: string; identity: string }
const fields = ['project', 'recording', 'model', 'version', 'segment', 'identity'] as const;
const validId = (value: string) => /^[A-Za-z0-9_-]{1,160}$/.test(value);
export function segmentLink(target: SegmentTarget): string {
  if (!fields.every(field => validId(target[field])) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(target.identity)) throw new Error('Invalid segment identity');
  const url = new URL(`${SEGMENT_SCHEME}//open/v2`);
  for (const field of fields) url.searchParams.set(field, target[field]);
  return url.href;
}
export function parseSegmentLink(raw: string): SegmentTarget {
  if (typeof raw === 'string' && raw.startsWith(`${SEGMENT_SCHEME}//open/v1?`)) throw Error(msg('segmentTransfer.oldLink'));
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith(`${SEGMENT_SCHEME}//open/v2?`)) throw new Error('Invalid segment link');
  const url = new URL(raw);
  if (url.protocol !== SEGMENT_SCHEME || url.hostname !== 'open' || url.pathname !== '/v2' || url.port || url.username || url.password || url.hash ||
    [...url.searchParams.keys()].length !== fields.length || [...url.searchParams.keys()].some(key => !fields.includes(key as typeof fields[number]))) throw new Error('Invalid segment link');
  const target = Object.fromEntries(fields.map(field => [field, url.searchParams.get(field) ?? ''])) as unknown as SegmentTarget;
  if (!fields.every(field => validId(target[field])) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(target.identity)) throw new Error('Invalid segment identity');
  return target;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
// RTF is ASCII, with signed UTF-16 escapes including surrogate pairs.
export const escapeRtf = (value: string) => value.split('').map(char => {
  const code = char.charCodeAt(0);
  if (char === '\n') return '\\line ';
  if ('\\{}'.includes(char)) return '\\' + char;
  return code > 127 ? `\\u${code > 32767 ? code - 65536 : code}?` : char;
}).join('');
export function segmentTransfer(transcript: Transcript, segment: Segment, title: string, target?: SegmentTarget) {
  const index = transcript.segments.findIndex(item => item.id === segment.id);
  if (index < 0) throw new Error('Segment no longer exists');
  const speaker = transcript.speakers.find(item => item.id === segment.speaker_id)?.name ?? segment.speaker_id;
  const time = transcript.timeAligned === false ? '' : ` [${formatTime(segment.start)}–${formatTime(segment.end)}]`;
  const heading = `${speaker}${time} (${index + 1})`;
  const body = segment.text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  const url = target ? segmentLink(target) : undefined;
  return {
    plain: `${heading}\n${body}\n${title}${url ? `\n${url}` : ''}`,
    rtf: `{\\rtf1\\ansi\\uc1{\\colortbl ;\\red112\\green74\\blue161;} ${escapeRtf(heading)}\\par ${escapeRtf(body)}\\par ${url ? `{\\field{\\*\\fldinst HYPERLINK "${escapeRtf(url)}"}{\\fldrslt \\cf1\\ul ${escapeRtf(title)}\\ulnone\\cf0 }}` : escapeRtf(title)}}`,
    html: `<div><div>${escapeHtml(heading)}</div><div>${escapeHtml(body).replace(/\n/g, '<br>')}</div><div>${url ? `<a href="${escapeHtml(url)}" style="color:#704aa1;text-decoration:underline">${escapeHtml(title)}</a>` : escapeHtml(title)}</div></div>`,
  };
}
