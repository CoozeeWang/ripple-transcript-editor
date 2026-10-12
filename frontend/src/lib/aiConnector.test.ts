import { describe, expect, it, vi } from 'vitest';
import { AIConnector, type ConnectorDocument } from './aiConnector';
import { applyAISuggestions } from './aiVersionEdits';
import type { Transcript } from '../types';

function fixture() {
  // Entirely synthetic transcript, never a real interview.
  const baseline: Transcript = { audio: { filename: 'synthetic.wav', duration: 8 }, speakers: [{ id: 'sp', name: 'Synthetic speaker' }],
    segments: [{ id: 'a', speaker_id: 'sp', start: 0, end: 4, text: '开头不改。' },
      { id: 'b', speaker_id: 'sp', start: 4, end: 8, text: '嗯，我觉得可能有问题。',
        words: [...'嗯，我觉得可能有问题。'].map((text, i) => ({ text, start: 4 + i / 4, end: 4 + (i + 1) / 4 })) }] };
  const original = { id: 'm1:original', model_id: 'm1', edit_id: 'original', name: 'Original', kind: 'original' as const };
  let current: ConnectorDocument = { identity: '1', transcript: baseline, label: 'v1', title: 'Synthetic interview', names: ['v1'],
    version: { id: 'm1:e1', model_id: 'm1', edit_id: 'e1', name: 'v1', kind: 'edit' },
    references: async () => [{ version: original, load: async () => baseline }] };
  const publish = vi.fn(async (source: Transcript, changes: Parameters<typeof applyAISuggestions>[2], name: string) => {
    const next = applyAISuggestions(current.transcript, source, changes);
    current = { ...current, identity: '2', transcript: next };
    return { version: name, comparison_requested: true };
  });
  const c = new AIConnector({ current: async () => current, publish });
  return { c, baseline, publish, get current() { return current; }, set current(value) { current = value; } };
}
async function prepare(f: ReturnType<typeof fixture>, args: Record<string, unknown> = {}) {
  const read = await f.c.handle('read_current', {});
  return f.c.handle('prepare', { snapshot: read.snapshot, start_id: 'b', rules: ['删无意义填充词，保留不确定表达'], ...args });
}
const change = { segment_id: 'b', before: '嗯，我觉得可能有问题。', after: '我觉得可能有问题。' };

describe('current interview connector', () => {
  it('identifies both versions without interpreting unchanged selected samples as a whole-manuscript result', async () => {
    const f = fixture();
    f.current = { ...f.current, transcript: { ...f.baseline, segments: [f.baseline.segments[0], { ...f.baseline.segments[1], text: '修改正文。' }] } };
    const read = await f.c.handle('read_current', {});
    expect(read.current_version).toEqual(f.current.version);
    const pairs = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a', 'b'] });
    expect(pairs.comparison).toEqual({ before_version: expect.objectContaining({ id: 'm1:original', name: 'Original' }), after_version: f.current.version });
    expect(pairs.examples).toEqual([expect.objectContaining({ changed: false }), expect.objectContaining({ changed: true, before: f.baseline.segments[1].text, after: '修改正文。' })]);
    expect(pairs.changed_examples).toBe(1);
  });
  it('asks when multiple versions exist and loads only the explicitly selected baseline', async () => {
    const f = fixture(); const original = (await f.current.references())[0];
    const other = { version: { ...f.current.version, id: 'm1:e2', edit_id: 'e2', name: 'v1' }, load: vi.fn(async () => f.baseline) };
    const load = vi.fn(original.load);
    f.current = { ...f.current, references: async () => [{ ...original, load }, other] };
    const read = await f.c.handle('read_current', {});
    const discovery = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: [] });
    expect(discovery.comparison_status).toBe('selection_required'); expect(discovery.comparison_versions).toHaveLength(2);
    expect(load).not.toHaveBeenCalled(); expect(other.load).not.toHaveBeenCalled();
    const result = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['b'], comparison_version_id: 'm1:e2' });
    expect(result.comparison).toEqual({ before_version: other.version, after_version: f.current.version });
    expect(other.load).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled();
  });
  it('requires a choice for a sole edit and excludes the current version', async () => {
    const f = fixture();
    f.current = { ...f.current, references: async () => [
      { version: f.current.version, load: async () => f.baseline },
      { version: { ...f.current.version, id: 'm1:e2', edit_id: 'e2' }, load: async () => f.baseline },
    ] };
    const read = await f.c.handle('read_current', {});
    const result = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: [] });
    expect(result.comparison_status).toBe('selection_required');
    expect(result.comparison_versions).toEqual([expect.objectContaining({ id: 'm1:e2' })]);
  });
  it('returns explicit reasons for unavailable, self-selected and unreadable versions', async () => {
    const f = fixture(); const original = (await f.current.references())[0];
    for (const id of ['m1:e1', 'another-interview:e1']) {
      const read = await f.c.handle('read_current', {});
      const result = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a'], comparison_version_id: id });
      expect(result.reason).toBe('comparison_version_not_available'); expect(result.examples).toEqual([]);
    }
    f.current = { ...f.current, references: async () => [{ ...original, load: async () => { throw Error('private path must not leak'); } }] };
    let read = await f.c.handle('read_current', {});
    expect((await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a'] })).reason).toBe('comparison_version_unreadable');
    f.current = { ...f.current, references: async () => [] };
    read = await f.c.handle('read_current', {});
    expect((await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a'] })).reason).toBe('no_comparison_versions');
  });
  it('does not match coincidental segment IDs and timestamps from different models', async () => {
    const f = fixture(); const original = (await f.current.references())[0];
    f.current = { ...f.current, references: async () => [{ ...original, version: { ...original.version, id: 'm2:original', model_id: 'm2' } }] };
    const read = await f.c.handle('read_current', {});
    const result = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a'] });
    expect(result.comparison_status).toBe('unreliable');
    expect(result.examples).toEqual([{ id: 'a', ambiguous: true, reason: 'source_mapping_unavailable' }]);
  });
  it('rejects results if the interview changes while loading the baseline', async () => {
    const f = fixture(); const original = (await f.current.references())[0];
    f.current = { ...f.current, references: async () => [{ ...original, load: async () => {
      f.current = { ...f.current, identity: 'another-interview' }; return f.baseline;
    } }] };
    const read = await f.c.handle('read_current', {});
    await expect(f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a'] })).rejects.toThrow('source_changed');
  });
  it('reads a merged human example against both original paragraphs without guessing by time', async () => {
    const f = fixture();
    f.current = { ...f.current, transcript: { ...f.baseline, segments: [{ ...f.baseline.segments[0],
      end: 8, mergedFrom: ['a', 'b'], text: '开头不改。\n\n我觉得可能有问题。' }] } };
    const read = await f.c.handle('read_current', {});
    const result = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a'] });
    expect(result.examples).toEqual([expect.objectContaining({ before: '开头不改。\n\n嗯，我觉得可能有问题。',
      after: '开头不改。\n\n我觉得可能有问题。', source_segment_ids: ['a', 'b'], current_segment_ids: ['a'] })]);
  });
  it('returns complete recorded source context for a split instead of falsely treating it as missing', async () => {
    const f = fixture();
    const word = { text: '字', start: 4, end: 5, origins: [{ model: 'm1', segment: 'b', from: 0, to: 1, start: 4, end: 5 }] };
    f.current = { ...f.current, transcript: { ...f.baseline, segments: [f.baseline.segments[0],
      { ...f.baseline.segments[1], end: 6, text: '嗯，我觉得', words: [word] },
      { ...f.baseline.segments[1], id: 'split', start: 6, text: '可能有问题。', words: [word] }] } };
    const read = await f.c.handle('read_current', {});
    const result = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['split'] });
    expect(result.examples).toEqual([expect.objectContaining({ before: '嗯，我觉得可能有问题。',
      after: '嗯，我觉得\n\n可能有问题。', current_segment_ids: ['b', 'split'] })]);
  });
  it('returns compact summaries without full text or word timestamps', async () => {
    const f = fixture();
    const data = await f.c.handle('read_current', {});
    expect(data.segment_count).toBe(2);
    expect(data).not.toHaveProperty('segments');
    const page = await f.c.handle('read_page', { snapshot: data.snapshot });
    expect(page.segments).toHaveLength(2);
    expect(JSON.stringify(page)).not.toContain('words');
  });
  it('asks only for missing start and never asks about overwrite mode', async () => {
    const f = fixture();
    const p = await prepare(f, { start_id: undefined });
    expect(p.needs_clarification).toEqual(['continuation_start']);
    expect(f.publish).not.toHaveBeenCalled();
    expect(JSON.stringify(p)).not.toContain('save_mode');
  });
  it('publishes a new version once for concurrent and repeated calls, keeping source and timestamps', async () => {
    const f = fixture(); const plan = await prepare(f);
    await f.c.handle('stage', { task_id: plan.task_id, changes: [change] });
    const args = { task_id: plan.task_id, confirmed_summary: plan.summary };
    const results = await Promise.all([f.c.handle('publish', args), f.c.handle('publish', args)]);
    expect(results[0]).toEqual(results[1]);
    expect(await f.c.handle('publish', args)).toEqual(results[0]);
    expect(f.publish).toHaveBeenCalledTimes(1);
    expect(f.baseline.segments[1].text).toBe(change.before);
    expect(f.current.transcript.segments[0]).toEqual(f.baseline.segments[0]);
    expect(f.current.transcript.segments[1].words?.slice(0, 2)).toEqual(f.baseline.segments[1].words?.slice(2, 4));
  });
  it('refuses changed text, a switch or close, including same text in another interview', async () => {
    for (const mutation of ['text', 'identity']) {
      const f = fixture(); const plan = await prepare(f);
      f.current = { ...f.current, ...(mutation === 'identity' ? { identity: 'other' } : { transcript: { ...f.baseline, segments: f.baseline.segments.slice(1) } }) };
      await expect(f.c.handle('stage', { task_id: plan.task_id, changes: [change] })).rejects.toThrow('source_changed');
      expect(f.publish).not.toHaveBeenCalled();
    }
  });
  it('validates the entire batch before storing any changes', async () => {
    const f = fixture(); const plan = await prepare(f);
    await expect(f.c.handle('stage', { task_id: plan.task_id, changes: [change, { ...change, segment_id: 'a' }] })).rejects.toThrow();
    const status = await f.c.handle('status', { task_id: plan.task_id });
    expect(status.staged_ids).toEqual([]);
    await expect(f.c.handle('stage', { task_id: plan.task_id, changes: [{ ...change, before: 'wrong' }] })).rejects.toThrow('before_text_mismatch');
  });
  it('requires complete coverage and exact confirmation; cancellation prevents publication', async () => {
    const f = fixture(); const plan = await prepare(f, { start_id: 'a' });
    await f.c.handle('stage', { task_id: plan.task_id, changes: [change] });
    await expect(f.c.handle('publish', { task_id: plan.task_id, confirmed_summary: plan.summary })).rejects.toThrow('incomplete_task');
    await expect(f.c.handle('publish', { task_id: plan.task_id, confirmed_summary: 'changed' })).rejects.toThrow('confirmation_changed');
    await f.c.handle('cancel', { task_id: plan.task_id });
    await expect(f.c.handle('publish', { task_id: plan.task_id, confirmed_summary: plan.summary })).rejects.toThrow('task_not_editable');
  });
  it('preserves text before a character start and after a character end', async () => {
    const f = fixture(); const plan = await prepare(f, { start_offset: 2, end_id: 'b', end_offset: 9 });
    await expect(f.c.handle('stage', { task_id: plan.task_id, changes: [change] })).rejects.toThrow('start_prefix_changed');
    await expect(f.c.handle('stage', { task_id: plan.task_id, changes: [{ ...change, after: '嗯，修改了结尾' }] })).rejects.toThrow('end_suffix_changed');
  });
  it('handles no-op tasks without writing and generates nonconflicting names', async () => {
    const f = fixture(); f.current = { ...f.current, names: ['v1', 'v1-AI-ed'] };
    const plan = await prepare(f);
    expect(plan.new_version).not.toBe('v1-AI-ed');
    await f.c.handle('stage', { task_id: plan.task_id, changes: [{ ...change, after: change.before }] });
    const result = await f.c.handle('publish', { task_id: plan.task_id, confirmed_summary: plan.summary });
    expect(result.saved).toBe(false); expect(f.publish).not.toHaveBeenCalled();
  });
  it('pages a 100k character transcript exactly once, keeping grapheme boundaries', async () => {
    const f = fixture();
    const text = '中文🙂e\u0301'.repeat(18000);
    f.current = { ...f.current, transcript: { ...f.baseline, segments: [{ ...f.baseline.segments[0], text }] } };
    const summary = await f.c.handle('read_current', {});
    let cursor: unknown = '0:0'; let result = ''; let pages = 0;
    do {
      const page = await f.c.handle('read_page', { snapshot: summary.snapshot, cursor, max_chars: 1000 });
      const rows = page.segments as { text: string }[];
      expect(rows[0].text.startsWith('\u0301')).toBe(false);
      result += rows.map(row => row.text).join(''); cursor = page.next_cursor; pages++;
    } while (cursor);
    expect(result).toBe(text); expect(pages).toBeGreaterThan(90);
  });
  it('does not treat original/current pairs as proof of human authorship', async () => {
    const f = fixture(); const read = await f.c.handle('read_current', {});
    const examples = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a'] });
    expect(JSON.stringify(examples)).toContain('not_proof_of_human_authorship');
  });
  it('keeps drafts after a save failure so status and retry can recover', async () => {
    const f = fixture(); f.publish.mockRejectedValueOnce(new Error('synthetic_save_failure'));
    const plan = await prepare(f); await f.c.handle('stage', { task_id: plan.task_id, changes: [change] });
    const args = { task_id: plan.task_id, confirmed_summary: plan.summary };
    await expect(f.c.handle('publish', args)).rejects.toThrow('synthetic_save_failure');
    expect((await f.c.handle('status', { task_id: plan.task_id })).state).toBe('draft');
    expect((await f.c.handle('publish', args)).saved).toBe(true);
  });
});
