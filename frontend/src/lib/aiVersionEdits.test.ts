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

it('merges a chain of 19 adjacent segments in source order without changing the source', () => {
  const source = { ...baseline, segments: Array.from({ length: 20 }, (_, i) => ({
    id: `synthetic-${i}`, speaker_id: 'sp', start: i, end: i + 1, text: `Synthetic ${i}`,
  })) };
  const next = applyAISuggestions(source, source, source.segments.slice(1).reverse().map(segment => ({
    id: segment.id, action: 'merge_previous', text: segment.text, reason: 'Synthetic chain',
  })));
  expect(next.segments).toHaveLength(1);
  expect(next.segments[0].text).toBe(source.segments.map(segment => segment.text).join('\n'));
  expect(next.segments[0].mergedFrom).toEqual(source.segments.map(segment => segment.id));
  expect(source.segments).toHaveLength(20);
});

it.each(['sp', 'other'])('merges newly adjacent same-speaker segments after deleting filler by %s', middleSpeaker => {
  const source: Transcript = { ...baseline, segments: [
    { ...baseline.segments[0], annotations: [{ id: 'left-note', text: 'Synthetic retained note', createdAt: '2026-01-01' }] },
    { id: 'filler', speaker_id: middleSpeaker, start: 4, end: 5, text: '嗯',
      annotations: [{ id: 'deleted-note', text: 'Synthetic removed note', createdAt: '2026-01-01' }] },
    { ...baseline.segments[1], start: 5, end: 6, highlights: [{ id: 'right-mark', start: 0, end: 2 }] },
  ] };
  const unchanged = structuredClone(source);
  const next = applyAISuggestions(source, source, [
    { id: 'b', action: 'merge_previous', text: '可能吧', reason: 'Synthetic merge after deletion' },
    { id: 'filler', action: 'delete', text: '', reason: 'Synthetic filler deletion' },
  ]);
  expect(next.segments).toHaveLength(1);
  expect(next.segments[0]).toMatchObject({ id: 'a', text: '我我觉得\n可能吧', start: 0, end: 6, mergedFrom: ['a', 'b'] });
  expect(next.segments[0].annotations?.map(note => note.id)).toEqual(['left-note']);
  expect(next.segments[0].highlights?.map(mark => mark.id)).toEqual(['h', 'right-mark']);
  expect(source).toEqual(unchanged);
});

it('skips consecutive deleted fillers while continuing an earlier merge chain', () => {
  const source: Transcript = { ...baseline, segments: [baseline.segments[0], baseline.segments[1],
    { id:'f1',speaker_id:'other',start:6,end:7,text:'嗯' },
    { id:'f2',speaker_id:'other',start:7,end:8,text:'啊' },
    { id:'c',speaker_id:'sp',start:8,end:9,text:'继续。' }] };
  const next=applyAISuggestions(source,source,[
    {id:'c',action:'merge_previous',text:'继续。',reason:'Synthetic retained merge'},
    {id:'b',action:'merge_previous',text:'可能吧',reason:'Synthetic first merge'},
    {id:'f2',action:'delete',text:'',reason:'Synthetic deletion'},
    {id:'f1',action:'delete',text:'',reason:'Synthetic deletion'},
  ]);
  expect(next.segments).toHaveLength(1);
  expect(next.segments[0]).toMatchObject({text:'我我觉得\n可能吧\n继续。',mergedFrom:['a','b','c'],end:9});
  expect(source.segments).toHaveLength(5);
});

it('preserves project tag IDs through AI edits, marks and actual merge operations',()=>{
 const source={...baseline,segments:baseline.segments.map((segment,i)=>({...segment,tagIds:i?['tag-b']:['tag-a']}))};
 const next=applyAISuggestions(source,source,[{id:'a',text:'我觉得',reason:'synthetic edit'},{id:'b',action:'merge_previous',text:'可能吧',reason:'synthetic merge'}]);
 expect(next.segments[0].tagIds).toEqual(['tag-a','tag-b']);expect(source.segments.map(segment=>segment.tagIds)).toEqual([['tag-a'],['tag-b']]);
});
