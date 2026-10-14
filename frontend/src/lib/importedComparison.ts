import type { Segment, Transcript } from '../types';

const ANCHOR_LENGTH = 12;
const EPSILON = 0.000001;
const equalTime = (a: number, b: number) => Math.abs(a - b) < EPSILON;
const text = (rows: Segment[]) => rows.map(row => row.text).join('\n\n');
const compact = (value: string) => value.replace(/\s/g, '');

/** Independent imports have no shared segment IDs. Exact complete time windows
 * AND unique unchanged text identify a comparison; overlap alone never does. */
export function importedComparison(before: Transcript, after: Transcript) {
  let countsBefore: Map<string, number> | undefined, countsAfter: Map<string, number> | undefined;
  const counts = (value: string) => {
    const chars = Array.from(compact(value)), found = new Map<string, number>();
    for (let i = 0; i <= chars.length - ANCHOR_LENGTH; i++) {
      const key = chars.slice(i, i + ANCHOR_LENGTH).join('');
      found.set(key, Math.min(2, (found.get(key) ?? 0) + 1));
    }
    return found;
  };
  return (id: string): Record<string, unknown> => {
    const unavailable = (alignment_reason: string) => ({ id, ambiguous: true, reason: 'source_mapping_unavailable', alignment_reason });
    const target = after.segments.find(row => row.id === id);
    if (!target) return { id, ambiguous: true, reason: 'current_segment_missing' };
    if (!Number.isFinite(target.start) || !Number.isFinite(target.end) || target.end <= target.start)
      return unavailable('invalid_timestamp_window');
    let start = target.start, end = target.end;
    let source: Segment[] = [], current: Segment[] = [];
    // Closure handles resegmentation on either side, but rejects incomplete edges.
    for (let n = 0; n <= before.segments.length + after.segments.length; n++) {
      source = before.segments.filter(row => row.end > start + EPSILON && row.start < end - EPSILON);
      current = after.segments.filter(row => row.end > start + EPSILON && row.start < end - EPSILON);
      if (!source.length || !current.length) return unavailable('timestamp_window_missing');
      if (source.length + current.length > 500) return unavailable('timestamp_group_too_large');
      const rows = [...source, ...current];
      const nextStart = Math.min(...rows.map(row => row.start)), nextEnd = Math.max(...rows.map(row => row.end));
      if (equalTime(nextStart, start) && equalTime(nextEnd, end)) break;
      start = nextStart; end = nextEnd;
      if (source.length + current.length > 500) return unavailable('timestamp_group_too_large');
    }
    if ([before, after].some(doc => doc.segments.some(row => row.start === row.end && row.start >= start && row.start <= end)))
      return unavailable('zero_duration_context_ambiguous');
    const ordered = (rows: Segment[]) => rows.every((row, i) => Number.isFinite(row.start) && Number.isFinite(row.end)
      && row.end > row.start && (!i || rows[i - 1].end <= row.start + EPSILON));
    if (!ordered(source) || !ordered(current)) return unavailable('overlapping_or_unordered_timestamps');
    if (![source, current].every(rows => equalTime(rows[0].start, start) && equalTime(rows.at(-1)!.end, end)))
      return unavailable('incomplete_timestamp_edges');
    const beforeText = text(source), afterText = text(current);
    if (beforeText.length + afterText.length > 12000) return { id, too_large: true, reason: 'comparison_group_too_large' };
    const beforeAll = text(before.segments), afterAll = text(after.segments);
    if (beforeAll.length + afterAll.length > 3000000) return unavailable('text_anchor_scan_too_large');
    countsBefore ??= counts(beforeAll); countsAfter ??= counts(afterAll);
    const groupBefore = compact(beforeText), chars = Array.from(compact(afterText));
    let matched = false;
    for (let i = 0; i <= chars.length - ANCHOR_LENGTH; i++) {
      const key = chars.slice(i, i + ANCHOR_LENGTH).join('');
      if (countsBefore.get(key) === 1 && countsAfter.get(key) === 1 && groupBefore.includes(key)) { matched = true; break; }
    }
    if (!matched) return unavailable('no_unique_unchanged_text_anchor');
    return { id, start: target.start, end: target.end, before: beforeText, after: afterText,
      source_segment_ids: source.map(row => row.id), current_segment_ids: current.map(row => row.id),
      changed: beforeText !== afterText, alignment: { method: 'complete_timestamp_window_and_unique_text', start, end },
      provenance: 'aligned_imported_versions_not_proof_of_human_authorship' };
  };
}
