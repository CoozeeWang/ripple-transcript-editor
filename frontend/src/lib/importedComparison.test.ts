import { expect, it } from 'vitest';
import { importedComparison } from './importedComparison';
import type { Segment, Transcript } from '../types';
const row = (id: string, start: number, end: number, text: string): Segment => ({ id, start, end, text, speaker_id: 'synthetic' });
const doc = (segments: Segment[]): Transcript => ({ audio: { filename: 'synthetic.wav', duration: 20 }, speakers: [], segments });
const anchor = '这一段完全合成的长句是唯一的文本锚点。';

it('compares independently imported merged paragraphs by complete time edges and unique text, not IDs', () => {
  const before = doc([row('original-a', 0, 3, anchor), row('original-b', 3, 6, '嗯，还要保留不确定语气。')]);
  const after = doc([row('imported-17', 0, 6, anchor + '还要保留不确定语气。')]);
  expect(importedComparison(before, after)('imported-17')).toMatchObject({ changed: true,
    before: anchor + '\n\n嗯，还要保留不确定语气。', after: anchor + '还要保留不确定语气。',
    source_segment_ids: ['original-a', 'original-b'], current_segment_ids: ['imported-17'],
    alignment: { method: 'complete_timestamp_window_and_unique_text', start: 0, end: 6 } });
});
it('expands split imports to a whole group and returns unchanged independent imports honestly', () => {
  const before = doc([row('original', 0, 6, anchor + '末尾。')]);
  const after = doc([row('new-a', 0, 3, anchor), row('new-b', 3, 6, '末尾。')]);
  expect(importedComparison(before, after)('new-b')).toMatchObject({ before: anchor + '末尾。', after: anchor + '\n\n末尾。', current_segment_ids: ['new-a', 'new-b'] });
  expect(importedComparison(before, doc([row('new', 0, 6, anchor + '末尾。')]))('new')).toMatchObject({ changed: false });
});
it('rejects coincidental timestamp overlap, repeated anchors and missing complete edges', () => {
  const before = doc([row('a', 0, 6, anchor)]);
  expect(importedComparison(before, doc([row('a', 0, 6, '一个完全无关、即使同号同时间也不能对应的句子。')]))('a')).toMatchObject({ ambiguous: true, alignment_reason: 'no_unique_unchanged_text_anchor' });
  const repeated = doc([row('a', 0, 6, anchor), row('b', 10, 16, anchor)]);
  expect(importedComparison(repeated, doc([row('new', 0, 6, anchor)]))('new')).toMatchObject({ ambiguous: true, alignment_reason: 'no_unique_unchanged_text_anchor' });
  expect(importedComparison(before, doc([row('new', 2, 6, anchor)]))('new')).toMatchObject({ ambiguous: true, alignment_reason: 'incomplete_timestamp_edges' });
});
it('rejects overlapping or zero-duration context without emitting partial text pairs', () => {
  const after = doc([row('new', 0, 6, anchor)]);
  const overlap = doc([row('a', 0, 6, anchor), row('b', 3, 6, '另一句话')]);
  expect(importedComparison(overlap, after)('new')).toMatchObject({ ambiguous: true, alignment_reason: 'overlapping_or_unordered_timestamps' });
  const zero = doc([row('a', 0, 6, anchor), row('b', 3, 3, '另一句话')]);
  expect(importedComparison(zero, after)('new')).toMatchObject({ ambiguous: true, alignment_reason: 'zero_duration_context_ambiguous' });
  expect(importedComparison(doc([]), after)('new')).not.toHaveProperty('before');
});
