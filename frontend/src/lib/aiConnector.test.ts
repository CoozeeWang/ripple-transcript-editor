import { describe, expect, it, vi } from 'vitest';
import { AIConnector, type ConnectorDocument, type ConnectorSaveTarget } from './aiConnector';
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
  const publish = vi.fn(async (source: Transcript, changes: Parameters<typeof applyAISuggestions>[2], name: string, target: ConnectorSaveTarget) => {
    const next = applyAISuggestions(current.transcript, source, changes);
    current = { ...current, identity: '2', transcript: next };
    return { version: name, comparison_requested: target.save_mode === 'new_version' };
  });
  const c = new AIConnector({ current: async () => current, publish });
  return { c, baseline, publish, get current() { return current; }, set current(value) { current = value; } };
}
async function prepare(f: ReturnType<typeof fixture>, args: Record<string, unknown> = {}) {
  const read = await f.c.handle('read_current', {});
  return f.c.handle('prepare', { snapshot: read.snapshot, start_id: 'b', rules: ['删无意义填充词，保留不确定表达'], save_mode:'new_version', ...args });
}
const change = { segment_id: 'b', before: '嗯，我觉得可能有问题。', after: '我觉得可能有问题。' };

it('requires an explicit save choice and rejects in-place writes to read-only originals', async () => {
 const f=fixture(),ask=await prepare(f,{save_mode:undefined});
 expect(ask).toMatchObject({needs_clarification:['save_mode'],writable:false,save_options:['new_version','current_version']});
 expect(ask.task_id).toBeUndefined();expect(f.publish).not.toHaveBeenCalled();
 await expect(prepare(f,{save_mode:'automatic'})).rejects.toThrow('invalid_save_mode');
 f.current={...f.current,editable:false,version:{...f.current.version,kind:'original',edit_id:'original',id:'m1:original'}};
 expect(await prepare(f,{save_mode:undefined})).toMatchObject({save_options:['new_version'],writable:false});
 await expect(prepare(f,{save_mode:'current_version'})).rejects.toThrow('current_version_read_only');
 expect(await prepare(f,{save_mode:'new_version'})).toMatchObject({save_mode:'new_version'});
});
it('binds the current-version choice and target ID to confirmation, preserving repeated-publish safety', async () => {
 const f=fixture(),version=f.current.version,plan=await prepare(f,{save_mode:'current_version'});
 expect(plan).toMatchObject({save_mode:'current_version',target_version:version});expect(plan.new_version).toBeUndefined();
 const summary=JSON.parse(String(plan.summary));expect(summary).toMatchObject({save_mode:'current_version',source_version:version,result_version_name:'v1'});
 await f.c.handle('stage',{task_id:plan.task_id,changes:[change]});
 await expect(f.c.handle('publish',{task_id:plan.task_id,confirmed_summary:JSON.stringify({...summary,save_mode:'new_version'})})).rejects.toThrow('confirmation_changed');
 const args={task_id:plan.task_id,confirmed_summary:plan.summary};
 const results=await Promise.all([f.c.handle('publish',args),f.c.handle('publish',args)]);
 expect(results[0]).toMatchObject({saved:true,save_mode:'current_version',new_version_created:false,version:'v1'});
 expect(await f.c.handle('publish',args)).toEqual(results[0]);expect(f.publish).toHaveBeenCalledOnce();
 expect(f.publish.mock.calls[0][3]).toMatchObject({save_mode:'current_version',source_version:version,identity:'1',task_id:plan.task_id});
 expect((await f.c.handle('status',{task_id:plan.task_id})).target_version).toEqual(version);
});

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
    expect(result.examples).toEqual([expect.objectContaining({ id: 'a', ambiguous: true, reason: 'source_mapping_unavailable' })]);
  });
  it('rejects results if the interview changes while loading the baseline', async () => {
    const f = fixture(); const original = (await f.current.references())[0];
    f.current = { ...f.current, references: async () => [{ ...original, load: async () => {
      f.current = { ...f.current, identity: 'another-interview' }; return f.baseline;
    } }] };
    const read = await f.c.handle('read_current', {});
    await expect(f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['a'] })).rejects.toThrow('source_changed');
  });
  it('returns actual independently imported version pairs when time and unique text establish alignment', async () => {
    const f = fixture(); const anchor = '这个明确写出的合成长句可以作为唯一文本锚点。';
    const before = { ...f.baseline, segments: [{ ...f.baseline.segments[0], text: '嗯，' + anchor }] };
    f.current = { ...f.current, version: { ...f.current.version, id: 'm2:e1', model_id: 'm2' },
      transcript: { ...f.baseline, segments: [{ ...f.baseline.segments[0], id: 'imported', text: anchor }] },
      references: async () => [{ version: { id: 'm1:original', model_id: 'm1', edit_id: 'original', name: 'Original', kind: 'original' }, load: async () => before }] };
    const read = await f.c.handle('read_current', {});
    const result = await f.c.handle('read_examples', { snapshot: read.snapshot, segment_ids: ['imported'], comparison_version_id: 'm1:original' });
    expect(result.comparison_status).toBe('resolved'); expect(result.changed_examples).toBe(1);
    expect(result.comparison).toEqual({ before_version: expect.objectContaining({ id: 'm1:original' }), after_version: f.current.version });
    expect(result.examples).toEqual([expect.objectContaining({ before: '嗯，' + anchor, after: anchor,
      alignment: expect.objectContaining({ method: 'complete_timestamp_window_and_unique_text' }) })]);
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

// Synthetic structural operations exercise the public task boundary, not only the helper.
it('merges and deletes only in a new version, idempotently, preserving source and merge marks',async()=>{
 const f=fixture();
 const source:Transcript={...f.baseline,segments:[
  {...f.baseline.segments[0],annotations:[{id:'note',text:'Synthetic human note',createdAt:'t'}]},
  {...f.baseline.segments[1],highlights:[{id:'highlight',start:0,end:1}]},
  {id:'c',speaker_id:'sp',text:'Synthetic filler',start:8,end:9},
 ]};
 f.current={...f.current,transcript:source};
 const plan=await prepare(f,{start_id:'a',allowed_actions:['edit','merge_previous','delete']});
 expect(JSON.parse(String(plan.summary)).allowed_actions).toEqual(['edit','merge_previous','delete']);
 // Reverse submission order must not change document order or merge destination.
 await f.c.handle('stage',{task_id:plan.task_id,changes:[
  {segment_id:'c',before:'Synthetic filler',after:'',action:'delete'},
  {segment_id:'b',before:source.segments[1].text,after:source.segments[1].text,action:'merge_previous'},
  {segment_id:'a',before:source.segments[0].text,after:source.segments[0].text},
 ]});
 const args={task_id:plan.task_id,confirmed_summary:plan.summary};
 const result=await f.c.handle('publish',args);
 expect(result).toMatchObject({saved:true,merged_segments:1,deleted_segments:1});
 expect(await f.c.handle('publish',args)).toEqual(result);expect(f.publish).toHaveBeenCalledOnce();
 expect(f.current.transcript.segments).toHaveLength(1);
 const merged=f.current.transcript.segments[0];
 expect(merged.id).toBe('a');expect(merged.text).toBe(source.segments[0].text+'\n'+source.segments[1].text);
 expect(merged.annotations?.[0].id).toBe('note');expect(merged.highlights?.[0].id).toBe('highlight');
 expect(merged.mergedFrom).toEqual(['a','b']);expect(merged.end).toBe(8);
 expect(source.segments).toHaveLength(3);expect(source.segments[0].annotations).toHaveLength(1);
});
it('defaults to text editing and rejects structural edits without the prepared permission',async()=>{
 const f=fixture(),plan=await prepare(f);
 await expect(f.c.handle('stage',{task_id:plan.task_id,changes:[{...change,after:'',action:'delete'}]})).rejects.toThrow('action_not_allowed');
 expect((await f.c.handle('status',{task_id:plan.task_id})).staged_ids).toEqual([]);
});
it('rejects out-of-scope merges and structural edits across partial character boundaries',async()=>{
 for(const args of [{},{start_id:'a',start_offset:1},{end_offset:2}]){
  const f=fixture(),plan=await prepare(f,{allowed_actions:['edit','merge_previous','delete'],...args});
  await expect(f.c.handle('stage',{task_id:plan.task_id,changes:[{...change,action:'merge_previous'}]})).rejects.toThrow(/outside_scope|requires_full_segments/);
 }
 const f=fixture(),plan=await prepare(f,{allowed_actions:['delete'],start_offset:1});
 await expect(f.c.handle('stage',{task_id:plan.task_id,changes:[{...change,after:'',action:'delete'}]})).rejects.toThrow('requires_full_segments');
});
it('rejects mixed speakers, delete/merge conflicts across batches and deletion of the entire transcript atomically',async()=>{
 const f=fixture();f.current={...f.current,transcript:{...f.baseline,segments:[f.baseline.segments[0],{...f.baseline.segments[1],speaker_id:'other'}]}};
 const plan=await prepare(f,{start_id:'a',allowed_actions:['edit','merge_previous']});
 await expect(f.c.handle('stage',{task_id:plan.task_id,changes:[{...change,action:'merge_previous'}]})).rejects.toThrow('merge_previous_requires_same_speaker');
 const g=fixture(),p=await prepare(g,{start_id:'a',allowed_actions:['edit','merge_previous','delete']});
 await g.c.handle('stage',{task_id:p.task_id,changes:[{...change,action:'merge_previous'}]});
 await expect(g.c.handle('stage',{task_id:p.task_id,changes:[{segment_id:'a',before:g.baseline.segments[0].text,after:'',action:'delete'}]})).rejects.toThrow('merge_previous_outside_scope');
 expect((await g.c.handle('status',{task_id:p.task_id})).staged_ids).toEqual(['b']);
 const h=fixture(),q=await prepare(h,{start_id:'a',allowed_actions:['delete']});
 await expect(h.c.handle('stage',{task_id:q.task_id,changes:h.baseline.segments.map(s=>({segment_id:s.id,before:s.text,after:'',action:'delete'}))})).rejects.toThrow('cannot_delete_all_segments');
 expect((await h.c.handle('status',{task_id:q.task_id})).staged_ids).toEqual([]);
});

function fillerFixture() {
 const f=fixture();
 f.current={...f.current,transcript:{...f.baseline,segments:[f.baseline.segments[0],
  {id:'filler',speaker_id:'other',start:4,end:5,text:'嗯'},
  {...f.baseline.segments[1],id:'c',start:5,end:8,text:'接着说。'}]}};
 return f;
}
it.each(['one batch','deletion first','same-speaker merge first'])('supports deleting filler and merging retained neighbors in %s',async order=>{
 const f=fillerFixture();
 if(order==='same-speaker merge first')f.current={...f.current,transcript:{...f.current.transcript,segments:f.current.transcript.segments.map(s=>({...s,speaker_id:'sp'}))}};
 const source=structuredClone(f.current.transcript),plan=await prepare(f,{start_id:'a',allowed_actions:['edit','delete','merge_previous']});
 const deletion={segment_id:'filler',before:'嗯',after:'',action:'delete'};
 const merge={segment_id:'c',before:'接着说。',after:'接着说。',action:'merge_previous'};
 if(order==='one batch')await f.c.handle('stage',{task_id:plan.task_id,changes:[merge,deletion]});
 else {
  await f.c.handle('stage',{task_id:plan.task_id,changes:[order==='deletion first'?deletion:merge]});
  await f.c.handle('stage',{task_id:plan.task_id,changes:[order==='deletion first'?merge:deletion]});
 }
 await f.c.handle('stage',{task_id:plan.task_id,changes:[{segment_id:'a',before:source.segments[0].text,after:source.segments[0].text}]});
 const args={task_id:plan.task_id,confirmed_summary:plan.summary},result=await f.c.handle('publish',args);
 expect(result).toMatchObject({saved:true,merged_segments:1,deleted_segments:1});
 expect(f.current.transcript.segments).toHaveLength(1);
 expect(f.current.transcript.segments[0].text).toBe(source.segments[0].text+'\n接着说。');
 expect(source.segments).toHaveLength(3);
 expect(await f.c.handle('publish',args)).toEqual(result);expect(f.publish).toHaveBeenCalledOnce();
});
it('does not auto-merge for deletion alone, or bypass the range, partial target or remaining speaker boundary',async()=>{
 const deletion={segment_id:'filler',before:'嗯',after:'',action:'delete'};
 const merge={segment_id:'c',before:'接着说。',after:'接着说。',action:'merge_previous'};
 for(const [args,error] of [[{start_id:'filler'},'merge_previous_outside_scope'],[{start_id:'a',start_offset:1},'structural_action_requires_full_segments']] as const){
  const f=fillerFixture(),plan=await prepare(f,{...args,allowed_actions:['edit','delete','merge_previous']});
  await expect(f.c.handle('stage',{task_id:plan.task_id,changes:[deletion,merge]})).rejects.toThrow(error);
  expect((await f.c.handle('status',{task_id:plan.task_id})).staged_ids).toEqual([]);
 }
 const g=fillerFixture();g.current={...g.current,transcript:{...g.current.transcript,segments:g.current.transcript.segments.map(s=>s.id==='a'?{...s,speaker_id:'third'}:s)}};
 const p=await prepare(g,{start_id:'a',allowed_actions:['edit','delete','merge_previous']});
 await expect(g.c.handle('stage',{task_id:p.task_id,changes:[deletion,merge]})).rejects.toThrow('merge_previous_requires_same_speaker');
 expect((await g.c.handle('status',{task_id:p.task_id})).staged_ids).toEqual([]);
 const h=fillerFixture(),q=await prepare(h,{start_id:'a',allowed_actions:['edit','delete']});
 await h.c.handle('stage',{task_id:q.task_id,changes:h.current.transcript.segments.map(s=>s.id==='filler'?deletion:{segment_id:s.id,before:s.text,after:s.text})});
 expect(await h.c.handle('publish',{task_id:q.task_id,confirmed_summary:q.summary})).toMatchObject({deleted_segments:1,merged_segments:0});
 expect(h.current.transcript.segments).toHaveLength(2);
});


it.each([false, true])('keeps atomic task rules task-only, including unchanged=%s', async unchanged => {
  const f = fixture(), remember = vi.fn(async () => {});
  f.current = { ...f.current, remember, rules: ['Explicit lasting preference'] };
  const task = await prepare(f);
  await f.c.handle('stage', { task_id: task.task_id, changes: [{ ...change, after: unchanged ? change.before : change.after }] });
  await f.c.handle('publish', { task_id: task.task_id, confirmed_summary: task.summary });
  expect(remember).not.toHaveBeenCalled();
  expect(await f.c.handle('read_current', {})).toMatchObject({ current_interview_rules: ['Explicit lasting preference'] });
  expect((await f.c.handle('status', { task_id: task.task_id })).summary).toBeUndefined();
  expect(await f.c.handle('status', { task_id: task.task_id, include_history_details: true })).toMatchObject({ summary: task.summary, rules_scope: 'historical-not-current-instructions' });
});

it('requires explicit future preference agreement and supports replacement and clearing', async () => {
  const f = fixture(), remember = vi.fn(async (rules: string[]) => { f.current.rules = rules; });
  f.current.remember = remember;
  const read = await f.c.handle('read_current', {});
  await expect(f.c.handle('set_rules', { snapshot: read.snapshot, rules: ['Keep uncertainty'] })).rejects.toThrow('explicit_future_rules_confirmation_required');
  expect(remember).not.toHaveBeenCalled();
  await f.c.handle('set_rules', { snapshot: read.snapshot, rules: ['Keep uncertainty'], confirmed_for_future_tasks: true });
  expect((await f.c.handle('read_current', {})).current_interview_rules).toEqual(['Keep uncertainty']);
  await f.c.handle('set_rules', { snapshot: read.snapshot, rules: [], confirmed_for_future_tasks: true });
  expect((await f.c.handle('read_current', {})).current_interview_rules).toEqual([]);
});
