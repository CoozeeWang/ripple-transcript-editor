import { vi } from 'vitest';
import { ProjectAIConnector } from '../lib/projectAIConnector';
import { syntheticDirectory } from './syntheticDirectory';
import { createModel, readManifest } from '../localStore';
import { recordingDirectory, type OpenProject } from '../lib/projectStore';
import { connectorReferences } from '../lib/connectorVersions';
import type { ConnectorDocument } from '../lib/aiConnector';
import type { Transcript } from '../types';

export async function projectConnectorFixture() {
  const fs = syntheticDirectory();
  let project: OpenProject | null = { directory: fs.handle, data: { kind: 'ripple-project', schemaVersion: 1,
    id: 'synthetic-project', title: 'Synthetic project', description: '', revision: 0,
    interviews: ['session-a','session-b'].map(id => ({ id, title: 'Synthetic duplicate session',
      recordings: [{ id: `recording-${id}`, name: 'Synthetic duplicate manuscript', file: `${id}.wav`, storage: 'none', fingerprint: '' }] })) } };
  fs.files.set('ripple-project.json', new File([JSON.stringify(project.data)], 'ripple-project.json'));
  const interviews = await fs.handle.getDirectoryHandle('interviews', { create: true });
  for (const session of project.data.interviews) await interviews.getDirectoryHandle(session.id, { create: true });
  const dirA = await recordingDirectory(project, 'session-a', project.data.interviews[0].recordings[0]);
  const dirB = await recordingDirectory(project, 'session-b', project.data.interviews[1].recordings[0]);
  const transcript = (text: string): Transcript => ({ audio: { filename: 'synthetic.wav', duration: 4 },
    speakers: [{ id: 'speaker', name: 'Synthetic speaker' }], segments: ['s1','s2'].map((id,index) => ({ id,
      speaker_id: 'speaker', start: index * 2, end: index * 2 + 2, text: `${text}${index}`,
      annotations: [{ id: `human-${id}`, text: 'Synthetic human note', createdAt: '2026-01-01' }],
      highlights: [{ id: `human-${id}`, start: 0, end: 2 }] })) });
  const a = await createModel(dirA, 'session-a.wav', { engine: 'synthetic', label: 'Synthetic model', editLabel: 'Synthetic v1', transcript: transcript('A'), original: transcript('A') });
  await createModel(dirB, 'session-b.wav', { engine: 'synthetic', label: 'Synthetic model', editLabel: 'Synthetic v1', transcript: transcript('B'), original: transcript('B') });
  let current: ConnectorDocument = { identity: 'active-a', transcript: a.edited.transcript, title: 'Synthetic A', label: 'Synthetic v1', names: ['Synthetic v1'],
    version: { id: 'm1:e1', model_id: 'm1', edit_id: 'e1', name: 'Synthetic v1', kind: 'edit' }, references: async () => connectorReferences(dirA, 'session-a.wav', (await readManifest(dirA, 'session-a.wav'))!.models) };
  const active = { current: vi.fn(async () => current), publish: vi.fn(async () => ({})), applyMarks: vi.fn(async () => ({})) };
  const access = () => ({ project: () => project, active: () => ({ interview_id: 'session-a', recording_id: 'recording-session-a', directory: dirA, version_id: current.version.id }) });
  const connector = () => new ProjectAIConnector(active, access);
  return { fs, dirA, dirB, active, connector, get current() { return current; },
    set current(value: ConnectorDocument) { current = value; }, get project() { return project; }, set project(value: OpenProject | null) { project = value; } };
}
