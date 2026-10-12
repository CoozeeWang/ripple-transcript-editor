import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectorReferences, connectorVersions } from './connectorVersions';
import type { TranscriptModel } from '../types';
import { readModelEdit, readModelOriginal } from '../localStore';
import { setInterfaceLanguage } from '../i18n';

afterEach(async () => { vi.clearAllMocks(); await setInterfaceLanguage('zh-CN'); });

vi.mock('../localStore', () => ({ defaultEditLabel: (i: number) => `v${i + 1}`,
  readModelEdit: vi.fn(async () => null), readModelOriginal: vi.fn(async () => null) }));
const models: TranscriptModel[] = [
  { id: 'm1', engine: 'synthetic', designatedOriginal: true, original: 'original.json', activeEditId: '', edits: [] },
  { id: 'm2', engine: 'imported', sourceKind: 'import', label: 'Synthetic copy', original: 'copy-original.json', activeEditId: 'e1',
    edits: [{ id: 'e1', label: 'v1', file: 'copy-edit.json', updated_at: '' }] },
  { id: 'm3', engine: 'imported', activeEditId: 'e1', edits: [{ id: 'e1', label: 'v1', file: 'other-edit.json', updated_at: '' }] },
];
describe('MCP version catalog', () => {
  it('returns current interface labels in Chinese and English while preserving user version names', async () => {
    await setInterfaceLanguage('zh-CN');
    expect(connectorVersions(models)[0].name).toBe('原始转录稿（只读）');
    expect(connectorVersions(models)[1].name).toBe('Synthetic copy（只读）');
    await setInterfaceLanguage('en');
    expect(connectorVersions(models)[0].name).toBe('Original transcript (read-only)');
    expect(connectorVersions(models)[1].name).toBe('Synthetic copy (read-only)');
    expect(connectorVersions(models)[2].name).toBe('v1');
  });
  it('includes the designated original and other same-interview versions with unique IDs despite duplicate names', () => {
    const versions = connectorVersions(models);
    expect(versions.map(v => v.id)).toEqual(['m1:original', 'm2:original', 'm2:e1', 'm3:e1']);
    expect(versions.filter(v => v.name === 'v1')).toHaveLength(2);
    expect(connectorVersions([{ ...models[1], designatedOriginal: true }]).map(v => v.id)).toEqual(['m2:original']);
  });
  it('lazily loads exactly the selected original or edit within the bound recording', async () => {
    const dir = { name: 'synthetic-recording' } as FileSystemDirectoryHandle;
    const rows = connectorReferences(dir, 'synthetic.wav', models);
    expect(readModelOriginal).not.toHaveBeenCalled(); expect(readModelEdit).not.toHaveBeenCalled();
    await rows.find(r => r.version.id === 'm1:original')!.load();
    expect(readModelOriginal).toHaveBeenCalledWith(dir, 'synthetic.wav', 'm1');
    await rows.find(r => r.version.id === 'm3:e1')!.load();
    expect(readModelEdit).toHaveBeenCalledWith(dir, 'synthetic.wav', 'm3', 'e1');
  });
});
