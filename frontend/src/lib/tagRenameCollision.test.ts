import { expect, it } from 'vitest';
import type { Transcript } from '../types';
import { setTagPath, tagPath } from './tags';
import { admitTags, changeSharedTag, TagMergeRequired } from './tagCollections';
import { applyTagBatch } from './tagBatch';

function fixture() {
  const source = setTagPath({ schemaVersion: 3, tags: [], groups: [] }, 'Parent/Source');
  const child = setTagPath(source.library, 'Parent/Source/Child');
  const target = setTagPath(child.library, 'Target');
  const library = target.library;
  const collection = admitTags(library, { schemaVersion: 1, tagIds: [], groups: [] }, [source.tag.id, child.tag.id, target.tag.id]);
  const transcript: Transcript = { audio: { filename: 'synthetic.wav', duration: 2 }, speakers: [], segments: [{ id: 's', speaker_id: 'p', start: 0, end: 2, text: 'Synthetic body', tagIds: [source.tag.id, child.tag.id, target.tag.id] }], tagCollection: collection };
  return { library, source: source.tag.id, child: child.tag.id, target: target.tag.id, consumers: [{ id: 'v', label: 'Synthetic version', transcript }] };
}
it('full path and basename propose the same existing identity and commit the same subtree merge', () => {
  const f = fixture(), before = JSON.stringify(f);
  for (const input of ['Target', 'Parent/Target', ' Parent / target ']) {
    try { changeSharedTag(f.library, f.source, input, f.consumers); expect.fail('explicit merge required'); }
    catch (error) { expect(error).toBeInstanceOf(TagMergeRequired); expect((error as TagMergeRequired).targetId).toBe(f.target); }
    expect(JSON.stringify(f)).toBe(before);
  }
  const full = changeSharedTag(f.library, f.source, 'Parent/Target', f.consumers, true);
  const leaf = changeSharedTag(f.library, f.source, 'Target', f.consumers, true);
  expect(full).toEqual(leaf); expect(full.remap.get(f.source)).toBe(f.target);
  expect(tagPath(full.library, f.child)).toBe('Target/Child');
  expect(full.consumers[0].transcript.segments[0].text).toBe('Synthetic body');
  expect(full.consumers[0].transcript.segments[0].tagIds).toEqual([f.target, f.child]);
});
it('preserves nonconflicting input parent semantics and does not bypass cycle or path validation', () => {
  const f = fixture();
  expect(tagPath(changeSharedTag(f.library, f.source, 'Parent/New', f.consumers).library, f.source)).toBe('Parent/New');
  expect(tagPath(changeSharedTag(f.library, f.source, 'New', f.consumers).library, f.source)).toBe('New');
  expect(() => changeSharedTag(f.library, f.source, 'Parent/Source/Target', f.consumers, true)).toThrow('cycle');
  expect(() => changeSharedTag(f.library, f.source, 'Parent//Target', f.consumers, true)).toThrow('invalid_path');
});
it('does not pick an arbitrary target when different versions have different identities with the same true name', () => {
  const f = fixture(), other = setTagPath(f.library, 'Other/Legacy target');
  other.tag.name='Target'; // Synthetic legacy data with an ambiguous identity.
  const second = { ...f.consumers[0].transcript, tagCollection: admitTags(other.library, { schemaVersion: 1, tagIds: [], groups: [] }, [f.source, other.tag.id]) };
  const consumers = [...f.consumers, { id: 'w', label: 'Synthetic other version', transcript: second }];
  expect(() => changeSharedTag(other.library, f.source, 'Parent/Target', consumers)).toThrow('path_conflict');
});
it('shares collision resolution with MCP rename/path batches and requires explicit target merge', () => {
  const f = fixture(), before = JSON.stringify(f);
  for (const change of [{ action: 'rename_tag' as const, tag_id: f.source, name: 'Target' }, { action: 'set_tag_path' as const, tag_id: f.source, path: 'Parent/Target' }]) {
    try { applyTagBatch(f.library, f.consumers, 'v', [change]); expect.fail('explicit merge required'); }
    catch (error) { expect(error).toBeInstanceOf(TagMergeRequired); expect((error as TagMergeRequired).targetId).toBe(f.target); }
    expect(JSON.stringify(f)).toBe(before);
  }
  const result = applyTagBatch(f.library, f.consumers, 'v', [{ action: 'merge_tag', tag_id: f.source, target_tag_id: f.target }]);
  expect(result.library.tags.some(tag => tag.id === f.source)).toBe(false);
  expect(tagPath(result.library, f.child)).toBe('Target/Child');
});
