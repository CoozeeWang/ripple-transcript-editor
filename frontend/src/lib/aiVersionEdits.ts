import { mergeSegmentWithNext } from './segmentOps';
import type { Transcript } from '../types';
import { reanchorCharacters, reanchorRanges } from './transcriptOps';

/** A proposed text change that is published as a new, comparable version. */
export interface AISuggestion {
  action?: 'edit' | 'delete' | 'merge_previous';
  id: string;
  text: string;
  reason: string;
}

export function applyAISuggestions(current: Transcript, baseline: Transcript, suggestions: AISuggestion[]): Transcript {
  if (JSON.stringify(current) !== JSON.stringify(baseline)) throw new Error('source_changed_read_current_again');
  const changes = new Map(suggestions.map(suggestion => [suggestion.id, suggestion]));
  if (changes.size !== suggestions.length || suggestions.some(suggestion => !current.segments.some(segment => segment.id === suggestion.id) ||
    !['edit', 'delete', 'merge_previous'].includes(suggestion.action ?? 'edit') ||
    (suggestion.action === 'delete' ? Boolean(suggestion.text.trim()) : !suggestion.text.trim()))) throw new Error('invalid_change');
  let segments = current.segments.map(segment => {
    const suggestion = changes.get(segment.id);
    if (!suggestion || suggestion.action === 'delete' || suggestion.text === segment.text) return segment;
    return { ...segment, text: suggestion.text,
      words: reanchorCharacters(segment.words, segment.text, suggestion.text),
      highlights: segment.highlights ? reanchorRanges(segment.highlights, segment.text, suggestion.text) : undefined };
  });
  for (let index = 0; index < current.segments.length; index++) {
    const original = current.segments[index];
    const suggestion = changes.get(original.id);
    if (suggestion?.action === 'delete') segments = segments.filter(segment => segment.id !== original.id);
    if (suggestion?.action === 'merge_previous') {
      const previous = current.segments[index - 1];
      const target = segments.findIndex(segment => segment.id === original.id);
      if (!previous || previous.speaker_id !== original.speaker_id || changes.get(previous.id)?.action === 'delete' || target < 1 || segments[target - 1].speaker_id !== original.speaker_id) throw new Error('invalid_change');
      segments = mergeSegmentWithNext(segments, segments[target - 1].id)!;
    }
  }
  if (!segments.length) throw new Error('cannot_delete_all_segments');
  return { ...current, segments, lastEditedSegmentId: segments.find(segment => changes.has(segment.id))?.id ?? segments[0]?.id };
}

/** Number independently for a source label, including legacy AI version names. */
export function nextAIEditName(sourceLabel: string, existingLabels: string[]): string {
  const prefix = `${sourceLabel} · AI 辅助 `;
  const legacyPrefix = `${sourceLabel} · AI 修改稿 `;
  const numbers = existingLabels.filter(label => label.startsWith(prefix) || label.startsWith(legacyPrefix))
    .map(label => label.slice(label.startsWith(prefix) ? prefix.length : legacyPrefix.length))
    .filter(suffix => /^\d+$/.test(suffix)).map(Number).filter(Number.isSafeInteger);
  return prefix + String(Math.max(0, ...numbers) + 1).padStart(2, '0');
}
