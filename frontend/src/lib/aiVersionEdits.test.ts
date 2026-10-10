import { expect, it } from 'vitest';
import type { Transcript } from '../types';
import { applyAISuggestions, nextAIEditName } from './aiVersionEdits';

const baseline: Transcript = {
  audio: { filename: 'synthetic.wav', duration: 6 },
  speakers: [{ id: 'sp', name: 'Synthetic speaker' }],
  segments: [
    { id: 'a', speaker_id: 'sp', start: 0, end: 4, text: '我我觉得', words: [...'我我觉得'].map((text, start) => ({ text, start, end: start + 1 })), highlights: [{ id: 'h', start: 2, end: 4 }] },
    { id: 'b', speaker_id: 'sp', start: 4, end: 6, text: '可能吧' },
  ],
};

it('publishes only the staged change while retaining character anchors and highlights', () => {
  const next = applyAISuggestions(baseline, baseline, [{ id: 'a', text: '我觉得', reason: 'synthetic correction' }]);
  expect(next.segments[1]).toBe(baseline.segments[1]);
  expect(next.segments[0].words?.filter(word => '觉得'.includes(word.text))).toEqual(baseline.segments[0].words?.slice(2));
  expect(next.segments[0].highlights).toEqual([{ id: 'h', start: 1, end: 3 }]);
  expect(baseline.segments[0].text).toBe('我我觉得');
});

it('keeps version names per source and includes legacy AI version labels', () => {
  expect(nextAIEditName('修改稿 v1', ['修改稿 v1 · AI 辅助 01', '修改稿 v1 · AI 修改稿 03', '修改稿 v2 · AI 辅助 09']))
    .toBe('修改稿 v1 · AI 辅助 04');
});
