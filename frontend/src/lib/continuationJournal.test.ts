import { expect, it, vi } from 'vitest';
import { createModel, readContinuationTasks } from '../localStore';
import { isContinuationTask } from './continuationJournal';
import { syntheticDirectory } from '../testUtils/syntheticDirectory';

const version = { id: 'm1:e1', model_id: 'm1', edit_id: 'e1', name: 'Synthetic edit', kind: 'edit' };
const task = () => ({ schema: 1, id: crypto.randomUUID(), source: version, target: version, saveMode: 'current_version',
  name: version.name, rules: ['Synthetic rule'], actions: ['edit'], ids: ['s1'], done: [], held: [], state: 'paused', summary: '{}', updated: '' });
async function fixture() {
  const directory = syntheticDirectory();
  await createModel(directory.handle, 'synthetic.wav', { engine: 'synthetic',
    transcript: { audio: { filename: 'synthetic.wav', duration: 1 }, speakers: [],
      segments: [{ id: 's1', speaker_id: '', start: 0, end: 1, text: 'Synthetic text' }] } });
  const folder = directory.dirs.get('synthetic.transcript')!;
  await folder.handle.getDirectoryHandle('ai-continuation-tasks', { create: true });
  return { directory, journals: folder.dirs.get('ai-continuation-tasks')! };
}
it('returns healthy journals and reports each damaged file without changing it', async () => {
  const { directory, journals } = await fixture();
  const healthy = task();
  journals.files.set(`${healthy.id}.json`, new File([JSON.stringify(healthy)], `${healthy.id}.json`));
  for (const value of ['{interrupted', 'null', JSON.stringify({ ...task(), held: [null] }), JSON.stringify({ ...task(), pending: {} })]) {
    const name = `${crypto.randomUUID()}.json`;
    journals.files.set(name, new File([value], name));
  }
  const before = await Promise.all([...journals.files].map(async ([name, file]) => [name, await file.text()]));
  const report = vi.fn();
  expect(await readContinuationTasks(directory.handle, 'synthetic.wav', report)).toEqual([healthy]);
  expect(report).toHaveBeenCalledWith(4);
  expect(await Promise.all([...journals.files].map(async ([name, file]) => [name, await file.text()]))).toEqual(before);
  for (const name of [...journals.files.keys()]) if (name !== `${healthy.id}.json`) journals.files.delete(name);
  await readContinuationTasks(directory.handle, 'synthetic.wav', report);
  expect(report).toHaveBeenLastCalledWith(0);
});
it('keeps permission errors actionable instead of treating all tasks as damaged', async () => {
  const { directory, journals } = await fixture();
  const healthy = task();
  journals.files.set(`${healthy.id}.json`, new File([JSON.stringify(healthy)], `${healthy.id}.json`));
  vi.spyOn(journals.files.get(`${healthy.id}.json`)!, 'text').mockRejectedValue(new DOMException('Synthetic access revoked', 'NotAllowedError'));
  await expect(readContinuationTasks(directory.handle, 'synthetic.wav')).rejects.toMatchObject({ name: 'NotAllowedError' });
});
it.each([
  null, { ...task(), target: null }, { ...task(), rules: null }, { ...task(), done: ['unplanned'] },
  { ...task(), held: [{}] }, { ...task(), receipts: [{}] }, { ...task(), batch: { checked: null } },
])('rejects malformed nested journal data before recovery: %j', value => expect(isContinuationTask(value)).toBe(false));
