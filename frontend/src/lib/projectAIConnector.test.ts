import { recordingDirectory, savePortableProject } from './projectStore';
import { syntheticDirectory } from '../testUtils/syntheticDirectory';
import { describe, expect, it, vi } from 'vitest';
import { ProjectAIConnector } from './projectAIConnector';
import { projectConnectorFixture as fixture } from '../testUtils/syntheticProjectConnector';
import { readContinuationTasks, readModelEdit, readManifest, saveActiveEdit, removeEdit } from '../localStore';

const readB = (c: ProjectAIConnector, version_id = 'm1:e1') => c.handle('read_project', { interview_id: 'session-b', recording_id: 'recording-session-b', version_id });
const changedB = { segment_id: 's1', before: 'B0', after: 'B0 Test' };
async function prepared(c: ProjectAIConnector, delivery_mode = 'atomic', save_mode = 'current_version') {
  const read = await readB(c);
  return c.handle('prepare', { snapshot: read.snapshot, start_id: 's1', end_id: 's1', rules: ['Synthetic test edit'], save_mode, delivery_mode });
}
describe('current-project AI routing', () => {
  it('keeps a WorkBuddy task protected after a validation error, and reconciles its actual saved receipt', async () => {
    const f = await fixture(), c = f.connector();
    const read = await c.handle('read_project', { interview_id: 'session-b', recording_id: 'recording-session-b', version_id: 'm1:e1' }, 'workbuddy');
    const task = await c.handle('prepare_marks', { snapshot: read.snapshot, segment_ids: ['s1'], instructions: 'Synthetic note' }, 'workbuddy');
    await expect(c.handle('stage_marks', { task_id: task.task_id, marks: [] }, 'workbuddy')).rejects.toThrow('invalid_batch');
    await c.handle('stage_marks', { task_id: task.task_id, marks: [{ segment_id: 's1', before: 'B0', annotation: 'Synthetic WorkBuddy note' }] }, 'workbuddy');
    await c.handle('apply_marks', { task_id: task.task_id, confirmed_summary: task.summary }, 'workbuddy');
    // A late invalid request must never replace a completed disk receipt with failed/zero.
    await expect(c.handle('stage_marks', { task_id: task.task_id, marks: [] }, 'workbuddy')).rejects.toThrow('task_not_editable');
    expect(await c.handle('marks_status', { task_id: task.task_id }, 'workbuddy')).toMatchObject({ state: 'completed', editing_state: 'completed', result: { saved: true } });
    expect(c.editing.get(String(task.task_id))).toMatchObject({ state: 'completed', saved: 1, total: 1 });
  });
  it('reserves writes across clients, allows readonly analysis and rejects foreign task adoption', async () => {
    const f = await fixture(), c = f.connector();
    const a = await readB(c);
    expect(c.editing.values()).toHaveLength(0);
    const task = await c.handle('prepare_marks', { snapshot: a.snapshot, segment_ids: ['s1'], instructions: 'Synthetic note' });
    const other = await c.handle('read_project', { interview_id: 'session-b', recording_id: 'recording-session-b', version_id: 'm1:e1' }, 'claude');
    await expect(c.handle('prepare_marks', { snapshot: other.snapshot, segment_ids: ['s1'], instructions: 'Other synthetic note' }, 'claude')).rejects.toThrow('locked_by_other_ai');
    await expect(c.handle('stage_marks', { task_id: task.task_id, marks: [] }, 'claude')).rejects.toThrow('another_client');
    await c.handle('end_editing', { task_id: task.task_id }, 'window');
    await expect(c.handle('stage_marks', { task_id: task.task_id, marks: [] })).rejects.toThrow('editing_task_ended');
    expect(c.editing.values().find(t => t.task_id === task.task_id)?.state).toBe('ended');
    const next = await c.handle('prepare_marks', { snapshot: other.snapshot, segment_ids: ['s1'], instructions: 'Other synthetic note' }, 'claude');
    expect(next.task_id).toBeTruthy();
  });
  it('revokes a marks write while validation waits and still allows a status lookup', async () => {
    const f = await fixture(), c = f.connector();
    const read = await c.handle('read_current', {});
    const task = await c.handle('prepare_marks', { snapshot: read.snapshot, segment_ids: ['s1'], instructions: 'Synthetic annotation' });
    await c.handle('stage_marks', { task_id: task.task_id, marks: [{ segment_id: 's1', before: 'A0', annotation: 'Synthetic AI note' }] });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const originalCurrent = f.active.current.getMockImplementation()!;
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    f.active.current.mockImplementation(async () => { enter(); await gate; return originalCurrent(); });
    const pending = c.handle('apply_marks', { task_id: task.task_id, confirmed_summary: task.summary });
    await entered;
    await c.handle('end_editing', { task_id: task.task_id }, 'window'); release();
    const result = await pending;
    expect(result.saved).toBe(false); expect(f.active.applyMarks).not.toHaveBeenCalled();
    expect(await c.handle('marks_status', { task_id: task.task_id })).toMatchObject({ state: 'failed', result: { saved: false } });
  });
  it('never redirects an active save if the viewed recording changes during host validation', async () => {
    const f = await fixture(); let active = 'a';
    const c = new ProjectAIConnector(f.active, () => ({ project: () => f.project, active: () => ({
      interview_id: `session-${active}`, recording_id: `recording-session-${active}`,
      version_id: 'm1:e1', directory: active === 'a' ? f.dirA : f.dirB,
    }) }));
    const read = await c.handle('read_current', {});
    const task = await c.handle('prepare', { snapshot: read.snapshot, start_id: 's1', end_id: 's1', save_mode: 'current_version', rules: ['Synthetic edit'] });
    await c.handle('stage', { task_id: task.task_id, changes: [{ segment_id: 's1', before: 'A0', after: 'A0 Test' }] });
    let release!: () => void, enter!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
    f.active.current.mockImplementationOnce(async () => f.current).mockImplementationOnce(async () => { enter(); await gate; return f.current; });
    const pending = c.handle('publish', { task_id: task.task_id, confirmed_summary: task.summary });
    await entered; active = 'b'; release();
    await expect(pending).rejects.toThrow('source_changed_read_current_again');
    expect(f.active.publish).not.toHaveBeenCalled();
    expect((await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!.transcript.segments[0].text).toBe('B0');
  });
  it('lists duplicate names with stable IDs and refuses unspecified versions even with one edit', async () => {
    const f = await fixture(), c = f.connector();
    const directory = await c.handle('project_directory', { query: 'duplicate', limit: 1 });
    expect(directory.candidates).toHaveLength(1); expect(directory.next_cursor).toBe('1');
    expect(JSON.stringify(directory)).not.toContain('B0'); expect(JSON.stringify(directory)).not.toContain('session-b.wav');
    const ask = await c.handle('read_project', { interview_id: 'session-b', recording_id: 'recording-session-b' });
    expect(ask).toMatchObject({ needs_clarification: ['exact_version'], writable: false });
    expect(ask.snapshot).toBeUndefined(); expect(ask.versions).toHaveLength(2);
    await expect(c.handle('read_project', { interview_id: 'outside', recording_id: '../outside', version_id: 'm1:e1' })).rejects.toThrow('target_not_in_current_project');
    await expect(readB(c,'m1:missing')).rejects.toThrow('target_version_unavailable');
  });
  it('publishes to B while A stays unchanged; repeated writes are idempotent and notes survive', async () => {
    const f = await fixture(), c = f.connector(), beforeA = structuredClone(f.current.transcript);
    const originalB = JSON.stringify(await c.handle('read_project', { interview_id: 'session-b', recording_id: 'recording-session-b', version_id: 'm1:original' }));
    const task = await prepared(c);
    expect(JSON.parse(String(task.summary)).target.recording_id).toBe('recording-session-b');
    await c.handle('read_current', {}); // A read does not change B's task target.
    await c.handle('stage', { task_id: task.task_id, changes: [changedB] });
    const one = await c.handle('publish', { task_id: task.task_id, confirmed_summary: task.summary });
    expect(one).toMatchObject({ saved: true, background: true, undo_available: false, target: { recording_id: 'recording-session-b', version_id: 'm1:e1' } });
    expect(await c.handle('publish', { task_id: task.task_id, confirmed_summary: task.summary })).toEqual(one);
    const b = (await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!.transcript;
    expect(b.segments[0].text).toBe('B0 Test'); expect(b.segments[0].annotations?.[0].id).toBe('human-s1');
    expect(b.segments[1].text).toBe('B1'); expect(f.current.transcript).toEqual(beforeA);
    expect(f.active.publish).not.toHaveBeenCalled(); expect(f.active.applyMarks).not.toHaveBeenCalled();
    const read = await readB(c), page = await c.handle('read_page', { snapshot: read.snapshot });
    expect((page.segments as {text:string}[])[0].text).toBe('B0 Test');
    expect(originalB).toContain('original');
  });
  it('adds AI annotations/highlights to exact B version without creating a version or changing A', async () => {
    const f = await fixture(), c = f.connector(), read = await readB(c);
    const task = await c.handle('prepare_marks', { snapshot: read.snapshot, segment_ids: ['s2'], instructions: 'Synthetic annotation' });
    await c.handle('stage_marks', { task_id: task.task_id, marks: [{ segment_id: 's2', before: 'B1', annotation: 'Synthetic AI note', highlights: [{ start: 0, end: 1, text: 'B' }] }] });
    const result = await c.handle('apply_marks', { task_id: task.task_id, confirmed_summary: task.summary });
    expect(result).toMatchObject({ saved: true, new_version_created: false, added_annotations: 1, added_highlights: 1 });
    expect(result.transcript).toBeUndefined();
    expect((await readManifest(f.dirB, 'session-b.wav'))!.models[0].edits).toHaveLength(1);
    const b = (await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!.transcript;
    expect(b.segments[1].text).toBe('B1'); expect(b.segments[1].annotations).toHaveLength(2);
    expect(f.current.transcript.segments[1].annotations).toHaveLength(1);
    expect(await c.handle('apply_marks', { task_id: task.task_id, confirmed_summary: task.summary })).toEqual(result);
  });
  it('rejects stale text and removed/project-switched targets before saving', async () => {
    const f = await fixture(), c = f.connector(), task = await prepared(c);
    await c.handle('stage', { task_id: task.task_id, changes: [changedB] });
    const b = (await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!;
    b.transcript.segments[0].text = 'Synthetic human changed B';
    await saveActiveEdit(f.dirB, 'session-b.wav', 'm1', 'e1', b);
    await expect(c.handle('publish', { task_id: task.task_id, confirmed_summary: task.summary })).rejects.toThrow('source_changed_read_current_again');
    const fresh = await readB(c);
    await removeEdit(f.dirB, 'session-b.wav', 'm1', 'e1');
    await expect(c.handle('read_page', { snapshot: fresh.snapshot })).rejects.toThrow('target_version_unavailable');
    f.project = null;
    await expect(readB(c)).rejects.toThrow('no_open_project');
  });
  it('forks B without changing its active version and continues batches in the new work version', async () => {
    const f = await fixture(), c = f.connector(), task = await prepared(c, 'incremental', 'new_version');
    const batch = await c.handle('batch', { task_id: task.task_id });
    const result = await c.handle('checkpoint', { task_id: task.task_id, batch_id: batch.batch_id, confirmed_summary: task.summary, changes: [changedB] });
    expect(result).toMatchObject({ saved: true, complete: true, target: { version_id: 'm1:e2' } });
    const manifest = (await readManifest(f.dirB, 'session-b.wav'))!;
    expect(manifest.models[0].activeEditId).toBe('e1'); expect(manifest.models[0].edits).toHaveLength(2);
    expect((await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!.transcript.segments[0].text).toBe('B0');
    expect((await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e2'))!.transcript.segments[0].text).toBe('B0 Test');
    const reconnected = f.connector();
    const tasks = await reconnected.handle('project_tasks', {});
    expect(tasks.tasks).toMatchObject([{ task_id: task.task_id, target: { version_id: 'm1:e2' }, state: 'completed' }]);
    expect(await reconnected.handle('checkpoint', { task_id: task.task_id, batch_id: batch.batch_id, confirmed_summary: task.summary })).toMatchObject({ saved: true, repeated: true });
  });
  it('routes later batches and recovered tasks to B work version while preserving a conflict proposal', async () => {
    const f = await fixture(), c = f.connector();
    const source = (await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!;
    source.transcript.segments = Array.from({ length: 30 }, (_, i) => ({ id: `segment-${i}`, speaker_id: 'speaker', start: i, end: i + 1, text: `Synthetic B segment ${i}` }));
    await saveActiveEdit(f.dirB, 'session-b.wav', 'm1', 'e1', source);
    const read = await readB(c);
    const task = await c.handle('prepare', { snapshot: read.snapshot, start_id: 'segment-0', rules: ['Synthetic long task'], save_mode: 'new_version', delivery_mode: 'incremental' });
    const first = await c.handle('batch', { task_id: task.task_id });
    expect(first.segments).toHaveLength(24);
    const saved = await c.handle('checkpoint', { task_id: task.task_id, batch_id: first.batch_id, confirmed_summary: task.summary,
      changes: [{ segment_id: 'segment-0', before: 'Synthetic B segment 0', after: 'Synthetic B segment 0 Test' }],
      unchanged_ids: Array.from({ length: 23 }, (_, i) => `segment-${i + 1}`) });
    expect(saved).toMatchObject({ saved: true, complete: false, target: { version_id: 'm1:e2' } });
    const next = saved.next_batch as { batch_id: string; segments: {id:string;text:string}[] };
    expect(next.segments).toHaveLength(6);
    const manual = (await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e2'))!;
    manual.transcript.segments[24].text = 'Synthetic manual correction';
    await saveActiveEdit(f.dirB, 'session-b.wav', 'm1', 'e2', manual);
    const conflict = await c.handle('stage', { task_id: task.task_id, batch_id: next.batch_id,
      changes: [{ segment_id: 'segment-24', before: 'Synthetic B segment 24', after: 'Synthetic AI proposal' }],
      unchanged_ids: next.segments.slice(1).map(s => s.id) });
    expect(conflict).toMatchObject({ state: 'paused', conflict: true, proposals_retained: true, target: { version_id: 'm1:e2' } });
    const reconnected = f.connector(), listed = await reconnected.handle('project_tasks', {});
    expect(listed.tasks).toMatchObject([{ task_id: task.task_id, state: 'paused', target: { recording_id: 'recording-session-b', version_id: 'm1:e2' } }]);
    expect(await reconnected.handle('proposals', { task_id: task.task_id })).toMatchObject({ proposals: [{ after: 'Synthetic AI proposal', current_text: 'Synthetic manual correction' }] });
    await reconnected.handle('resume', { task_id: task.task_id });
    const reread = await reconnected.handle('batch', { task_id: task.task_id });
    expect((reread.segments as {text:string}[])[0].text).toBe('Synthetic manual correction');
    expect(await reconnected.handle('cancel', { task_id: task.task_id })).toMatchObject({ already_saved_batches_retained: true });
    expect((await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e2'))!.transcript.segments[0].text).toBe('Synthetic B segment 0 Test');
    expect(f.current.transcript.segments[0].text).toBe('A0');
  });
  it('allows durable task listings after annotations and never restores an atomic draft after reconnect', async () => {
    const f = await fixture(), c = f.connector(), read = await readB(c);
    const task = await c.handle('prepare_marks', { snapshot: read.snapshot, segment_ids: ['s2'], instructions: 'Synthetic mark' });
    const listed = await c.handle('project_tasks', {});
    expect(listed.tasks).toMatchObject([{ task_id: task.task_id, state: 'draft', target: { recording_id: 'recording-session-b' } }]);
    await expect(f.connector().handle('marks_status', { task_id: task.task_id })).rejects.toThrow('task_expired');
  });
});

it('recovers a copied project task beside a damaged journal and saves only to the new project after explicit resume', async () => {
  const f = await fixture(), originalConnector = f.connector();
  const task = await prepared(originalConnector, 'incremental', 'current_version');
  const folder = await f.dirB.getDirectoryHandle('session-b.transcript');
  const journals = await folder.getDirectoryHandle('ai-continuation-tasks');
  const damagedName = `${crypto.randomUUID()}.json`;
  const writer = await (await journals.getFileHandle(damagedName, { create: true })).createWritable();
  await writer.write('{synthetic damaged journal'); await writer.close();
  const copy = await savePortableProject(f.project!, syntheticDirectory('synthetic backup').handle, 'Synthetic copy');
  const warning = vi.fn();
  const copyConnector = new ProjectAIConnector({ ...f.active, continuationWarning: warning }, () => ({
    project: () => copy, active: () => ({ interview_id: '', recording_id: '', version_id: null, directory: null }),
  }));
  const listed = await copyConnector.handle('project_tasks', {});
  expect(listed.tasks).toMatchObject([{ task_id: task.task_id, state: 'paused', target: { project_id: copy.data.id } }]);
  expect(warning.mock.calls.some(([, count]) => count === 1)).toBe(true);
  expect(f.active.publish).not.toHaveBeenCalled();
  const copiedRecording = copy.data.interviews[1].recordings[0];
  const copiedDir = await recordingDirectory(copy, 'session-b', copiedRecording);
  const copiedTask = (await readContinuationTasks(copiedDir, 'session-b.wav'))[0];
  expect(JSON.parse(copiedTask.summary).target.project_id).toBe(copy.data.id);
  expect((await readModelEdit(copiedDir, 'session-b.wav', 'm1', 'e1'))!.transcript.segments[0].text).toBe('B0');
  await copyConnector.handle('resume', { task_id: task.task_id });
  const batch = await copyConnector.handle('batch', { task_id: task.task_id });
  expect(await copyConnector.handle('checkpoint', { task_id: task.task_id, batch_id: batch.batch_id,
    confirmed_summary: copiedTask.summary, changes: [changedB] })).toMatchObject({ saved: true, target: { project_id: copy.data.id } });
  expect((await readModelEdit(copiedDir, 'session-b.wav', 'm1', 'e1'))!.transcript.segments[0].text).toBe('B0 Test');
  expect((await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!.transcript.segments[0].text).toBe('B0');
  expect((await readContinuationTasks(f.dirB, 'session-b.wav'))[0].state).toBe('draft');
});
