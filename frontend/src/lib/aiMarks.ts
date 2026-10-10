import type { Transcript } from '../types';

export interface AIMark {
  segment_id: string;
  before: string;
  annotation?: string | null;
  highlights?: { start: number; end: number; text: string }[];
}
function boundary(text: string, offset: number) {
  return offset === text.length || new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text).containing(offset)?.index === offset;
}
export function validateAIMark(transcript: Transcript, value: unknown): AIMark {
  const mark = value as AIMark;
  if (!mark || typeof mark !== 'object' || Object.keys(mark).some(key => !['segment_id', 'before', 'annotation', 'highlights'].includes(key))) throw new Error('invalid_mark');
  const segment = transcript.segments.find(s => s.id === mark.segment_id);
  if (!segment || typeof mark.before !== 'string' || segment.text !== mark.before) throw new Error('source_text_mismatch');
  if (mark.annotation != null && (typeof mark.annotation !== 'string' || !mark.annotation.trim() || mark.annotation.length > 4000)) throw new Error('invalid_annotation');
  if (mark.highlights !== undefined && (!Array.isArray(mark.highlights) || mark.highlights.length > 100)) throw new Error('invalid_highlights');
  for (const h of mark.highlights ?? []) {
    if (!h || Object.keys(h).some(key => !['start', 'end', 'text'].includes(key)) || !Number.isInteger(h.start) || !Number.isInteger(h.end) || h.start < 0 || h.end <= h.start || h.end > segment.text.length || !boundary(segment.text, h.start) || !boundary(segment.text, h.end) || segment.text.slice(h.start, h.end) !== h.text) throw new Error('invalid_highlight_range');
  }
  return structuredClone(mark);
}
/** Add marks only. The same text/range is retained once; text, words and human marks stay intact. */
export function applyAIMarks(baseline: Transcript, marks: AIMark[], taskId: string, createdAt = new Date().toISOString()) {
  const validated = marks.map(mark => validateAIMark(baseline, mark));
  if (new Set(validated.map(mark => mark.segment_id)).size !== validated.length) throw new Error('duplicate_segment');
  let annotations = 0, highlights = 0;
  const byId = new Map(validated.map(mark => [mark.segment_id, mark]));
  const segments = baseline.segments.map(segment => {
    const mark = byId.get(segment.id);
    if (!mark) return segment;
    const notes = [...segment.annotations ?? []], ranges = [...segment.highlights ?? []];
    const text = mark.annotation?.trim();
    if (text && !notes.some(note => note.text.trim() === text)) {
      notes.push({ id: `ai:${taskId}:${segment.id}`, text, createdAt, source: 'ai' }); annotations++;
    }
    for (const h of mark.highlights ?? []) if (!ranges.some(range => range.start === h.start && range.end === h.end)) {
      ranges.push({ id: `ai:${taskId}:${segment.id}:${h.start}:${h.end}`, start: h.start, end: h.end, source: 'ai' }); highlights++;
    }
    return { ...segment, ...(notes.length ? { annotations: notes } : {}), ...(ranges.length ? { highlights: ranges } : {}) };
  });
  return { transcript: annotations || highlights ? { ...baseline, segments } : baseline, added_annotations: annotations, added_highlights: highlights };
}
