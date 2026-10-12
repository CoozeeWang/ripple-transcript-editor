import { expect, it } from 'vitest';
import { editingExamples } from './editingExamples';
import type { Transcript, Segment } from '../types';
import type { ConnectorVersion } from './aiConnector';
const version = (model: string, edit: string): ConnectorVersion => ({ id: `${model}:${edit}`, model_id: model,
  edit_id: edit, name: edit, kind: edit === 'original' ? 'original' : 'edit' });
const segment = (id: string, text: string, sources: string[] = []): Segment => ({ id, text, start: 0, end: 2,
  speaker_id: 'synthetic', words: sources.map(source => ({ text: '字', start: 0, end: 1,
    origins: [{ model: 'm1', segment: source, from: 0, to: 1, start: 0, end: 1 }] })) });
const transcript = (segments: Segment[]): Transcript => ({ audio: { filename: 'synthetic.wav', duration: 2 }, speakers: [], segments });

it('compares complete groups when the baseline is merged and the current version is split', () => {
  const before = transcript([segment('merged', 'Earlier edit', ['a', 'b'])]);
  const after = transcript([segment('a', 'Current first', ['a']), segment('b', 'Current second', ['b'])]);
  expect(editingExamples(before, after, version('m1', 'e1'), version('m1', 'e2'), ['b'])).toEqual([
    expect.objectContaining({ before: 'Earlier edit', after: 'Current first\n\nCurrent second', source_segment_ids: ['merged'], current_segment_ids: ['a', 'b'], changed: true }),
  ]);
});
it('accepts explicit cross-model lineage and refuses an incomplete source group', () => {
  const before = transcript([segment('a', 'Original')]);
  const after = transcript([segment('imported', 'Changed', ['a'])]);
  expect(editingExamples(before, after, version('m1', 'original'), version('m2', 'e1'), ['imported'])[0]).toMatchObject({ before: 'Original', after: 'Changed' });
  const partial = transcript([segment('merged', 'Changed', ['a', 'missing'])]);
  expect(editingExamples(before, partial, version('m1', 'original'), version('m2', 'e1'), ['merged'])[0]).toEqual({ id: 'merged', ambiguous: true, reason: 'source_context_incomplete' });
});
it('supports the current original as after without silently choosing an editable baseline', () => {
  const before = transcript([segment('a', 'Edit')]); const after = transcript([segment('a', 'Original')]);
  expect(editingExamples(before, after, version('m1', 'e1'), version('m1', 'original'), ['a'])[0]).toMatchObject({ before: 'Edit', after: 'Original' });
});
it('never emits partial before/after text for missing segments or oversized groups', () => {
  const before = transcript([segment('a', 'x'.repeat(12001))]); const after = transcript([segment('a', 'Edit')]);
  expect(editingExamples(before, after, version('m1', 'original'), version('m1', 'e1'), ['a', 'missing'])).toEqual([
    { id: 'a', too_large: true, reason: 'comparison_group_too_large' }, { id: 'missing', ambiguous: true, reason: 'current_segment_missing' },
  ]);
});
