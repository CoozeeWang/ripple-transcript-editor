import { describe, expect, it, vi } from 'vitest';
import { AIConnector, type ConnectorDocument } from './aiConnector';
import { applyAIMarks } from './aiMarks';
import type { Transcript } from '../types';
function fixture() {
  const original: Transcript = { audio: { filename: 'synthetic.wav', duration: 3 }, speakers: [], segments: [
    { id: 'a', speaker_id: 'sp', start: 0, end: 2, text: '河边😀生活。', words: [{ text: '河边', start: 0, end: 1 }],
      annotations: [{ id: 'human', text: '人工批注', createdAt: '2026-01-01' }], highlights: [{ id: 'human', start: 0, end: 2 }] },
    { id: 'b', speaker_id: 'sp', start: 2, end: 3, text: '未添加标记。' } ] };
  let current: ConnectorDocument = { identity: '1', editable: true, transcript: structuredClone(original), title: 'Synthetic', label: 'v1', names: ['v1'],
    version: { id: 'm1:e1', model_id: 'm1', edit_id: 'e1', name: 'v1', kind: 'edit' }, references: async () => [] };
  const publish = vi.fn();
  const apply = vi.fn(async (source, marks, taskId) => { const result = applyAIMarks(source, marks, taskId); current = { ...current, transcript: result.transcript }; return { saved: true, version: 'v1', added_annotations: result.added_annotations, added_highlights: result.added_highlights }; });
  const c = new AIConnector({ current: async () => current, publish, applyMarks: apply });
  return { c, original, apply, publish, get current() { return current; }, set current(v) { current = v; } };
}
async function prepare(f: ReturnType<typeof fixture>, extra: Record<string, unknown> = { whole_interview: true }) {
  const s = await f.c.handle('read_current', {});
  return f.c.handle('prepare_marks', { snapshot: s.snapshot, instructions: '批注河边生活，高亮生活', ...extra });
}
const mark = { segment_id: 'a', before: '河边😀生活。', annotation: 'AI 分析', highlights: [{ start: 4, end: 6, text: '生活' }, { start: 0, end: 2, text: '河边' }] };
describe('AI marks on current version', () => {
  it('requires an explicit scope and an editable version', async () => {
    const f = fixture(); expect(await prepare(f, {})).toMatchObject({ needs_clarification: ['mark_scope'], writable: false });
    f.current = { ...f.current, editable: false };
    await expect(prepare(f)).rejects.toThrow('select_editable_version');
  });
  it('applies once, preserves human marks/text/timing, and does not publish a version', async () => {
    const f = fixture(), task = await prepare(f);
    await f.c.handle('stage_marks', { task_id: task.task_id, marks: [mark, { segment_id: 'b', before: '未添加标记。' }] });
    const args = { task_id: task.task_id, confirmed_summary: task.summary };
    const results = await Promise.all([f.c.handle('apply_marks', args), f.c.handle('apply_marks', args)]);
    expect(results[0]).toMatchObject({ saved: true, added_annotations: 1, added_highlights: 1, new_version_created: false });
    expect(await f.c.handle('apply_marks', args)).toEqual(results[0]); expect(f.apply).toHaveBeenCalledTimes(1); expect(f.publish).not.toHaveBeenCalled();
    const segment = f.current.transcript.segments[0];
    expect(segment.text).toBe(f.original.segments[0].text); expect(segment.words).toEqual(f.original.segments[0].words);
    expect(segment.annotations?.[0]).toEqual(f.original.segments[0].annotations?.[0]);
    expect(segment.annotations?.[1]).toMatchObject({ source: 'ai', text: 'AI 分析' });
    expect(segment.highlights).toHaveLength(2); expect(segment.highlights?.[0].id).toBe('human');
    expect(applyAIMarks(f.current.transcript, [mark], 'another').transcript).toBe(f.current.transcript);
  });
  it('validates a whole batch before staging, including UTF-16 and grapheme boundaries', async () => {
    const f = fixture(), task = await prepare(f);
    await expect(f.c.handle('stage_marks', { task_id: task.task_id, marks: [mark, { segment_id: 'b', before: 'wrong' }] })).rejects.toThrow('source_text_mismatch');
    expect(await f.c.handle('marks_status', { task_id: task.task_id })).toMatchObject({ remaining_ids: ['a', 'b'] });
    for (const range of [{ start: 2, end: 3, text: '\ud83d' }, { start: 4, end: 6, text: '错误' }, { start: -1, end: 6, text: '' }]) {
      await expect(f.c.handle('stage_marks', { task_id: task.task_id, marks: [{ ...mark, highlights: [range] }] })).rejects.toThrow('invalid_highlight_range');
    }
  });
  it('blocks missing coverage, incorrect agreement, and changed source', async () => {
    const f = fixture(), task = await prepare(f);
    await f.c.handle('stage_marks', { task_id: task.task_id, marks: [mark] });
    await expect(f.c.handle('apply_marks', { task_id: task.task_id, confirmed_summary: 'different' })).rejects.toThrow('confirm_task_summary');
    await expect(f.c.handle('apply_marks', { task_id: task.task_id, confirmed_summary: task.summary })).rejects.toThrow('incomplete_scope');
    await f.c.handle('stage_marks', { task_id: task.task_id, marks: [{ segment_id: 'b', before: '未添加标记。' }] });
    f.current = { ...f.current, identity: '2' };
    expect(await f.c.handle('apply_marks', { task_id: task.task_id, confirmed_summary: task.summary })).toMatchObject({ saved: false, error: 'source_changed_read_current_again' });
    expect(f.apply).not.toHaveBeenCalled();
  });
  it('keeps uncertain write outcomes queryable without attempting a second write', async () => {
    const f = fixture(), task = await prepare(f, { segment_ids: ['a'] });
    f.apply.mockRejectedValueOnce(new Error('mark_save_failed_changes_retained_in_ripple'));
    await f.c.handle('stage_marks', { task_id: task.task_id, marks: [mark] });
    const args = { task_id: task.task_id, confirmed_summary: task.summary };
    expect(await f.c.handle('apply_marks', args)).toMatchObject({ saved: false });
    expect(await f.c.handle('marks_status', args)).toMatchObject({ state: 'failed' });
    await f.c.handle('apply_marks', args); expect(f.apply).toHaveBeenCalledTimes(1);
  });
  it('cancels drafts and rejects out-of-scope marks', async () => {
    const f = fixture(), task = await prepare(f, { segment_ids: ['b'] });
    await expect(f.c.handle('stage_marks', { task_id: task.task_id, marks: [mark] })).rejects.toThrow('outside_confirmed_scope');
    await f.c.handle('cancel_marks', { task_id: task.task_id });
    await expect(f.c.handle('stage_marks', { task_id: task.task_id, marks: [mark] })).rejects.toThrow('task_not_editable');
  });
});
