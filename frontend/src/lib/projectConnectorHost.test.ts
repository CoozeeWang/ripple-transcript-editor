import { expect, it } from 'vitest';
import { ProjectConnectorHosts } from './projectConnectorHost';
import { projectConnectorFixture } from '../testUtils/syntheticProjectConnector';
import { readModelEdit, readModelOriginal, readManifest } from '../localStore';

async function setup() {
  const f = await projectConnectorFixture();
  const hosts = new ProjectConnectorHosts(() => ({ project: () => f.project,
    active: () => ({ interview_id: 'session-a', recording_id: 'recording-session-a', version_id: f.current.version.id, directory: f.dirA }) }), f.active);
  const bound = await hosts.bind('session-b', 'recording-session-b', 'm1:e1');
  const source = await bound.host.current();
  const save = (after: string) => bound.host.publish(source.transcript, [{ id: 's1', text: after, reason: 'Synthetic scoped change' }], source.label,
    { source_version: source.version, save_mode: 'current_version', identity: source.identity, task_id: crypto.randomUUID() });
  return { f, hosts, bound, source, save };
}
it('serializes competing B writes, rejecting the stale writer without affecting A', async () => {
  const { f, save } = await setup();
  const outcomes = await Promise.allSettled([save('First synthetic change'), save('Second synthetic change')]);
  expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect((await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!.transcript.segments[0].text).toBe('First synthetic change');
  expect(f.current.transcript.segments[0].text).toBe('A0');
});
it('rolls back B text after an index save failure, preserving the prior version', async () => {
  const { f, save } = await setup();
  const session = f.fs.dirs.get('interviews')!.dirs.get('session-b')!;
  const container = [...session.dirs.values()][0];
  let rejected = false;
  container.fail(name => name === 'manifest.json' && !rejected && (rejected = true));
  await expect(save('Must be rolled back')).rejects.toThrow();
  expect((await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!.transcript.segments[0].text).toBe('B0');
  expect((await readManifest(f.dirB, 'session-b.wav'))!.models[0].edits).toHaveLength(1);
});
it('revalidates project membership and recording identity before committing', async () => {
  const { f, save } = await setup();
  const changed = structuredClone(f.project!.data);
  changed.interviews[1].recordings[0].file = 'replacement.wav';
  f.fs.files.set('ripple-project.json', new File([JSON.stringify(changed)], 'ripple-project.json'));
  await expect(save('Do not follow the replacement')).rejects.toThrow('project_target_changed');
  expect((await readModelEdit(f.dirB, 'session-b.wav', 'm1', 'e1'))!.transcript.segments[0].text).toBe('B0');
});
it('forks a selected original and preserves its original text and active edit', async () => {
  const { f, hosts } = await setup();
  const bound = await hosts.bind('session-b', 'recording-session-b', 'm1:original');
  const source = await bound.host.current();
  const original = await readModelOriginal(f.dirB, 'session-b.wav', 'm1');
  const result = await bound.host.publish(source.transcript, [{ id: 's1', text: 'Synthetic forked original', reason: 'Test' }], 'Synthetic original copy',
    { source_version: source.version, save_mode: 'new_version', identity: source.identity, task_id: crypto.randomUUID() });
  expect(result).toMatchObject({ background: true, result_version: { kind: 'edit' } });
  expect(await readModelOriginal(f.dirB, 'session-b.wav', 'm1')).toEqual(original);
  expect((await readManifest(f.dirB, 'session-b.wav'))!.activeModelId).toBe('m1');
});
