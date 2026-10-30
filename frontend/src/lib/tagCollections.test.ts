import { describe, expect, it } from 'vitest';
import type { Transcript } from '../types';
import { isTagLibrary, setTagPath, tagPath, type TagLibrary } from './tags';
import { admitTags, changeSharedTag, collectionFromLibrary, collectionLibrary, projectTagCatalog,
    removeVersionTagBranch, TagCollectionConflict, TagMergeRequired, validateTagCollection, versionTagCollection, type TagCollection } from './tagCollections';

const empty = (): TagLibrary => ({ schemaVersion: 3, tags: [], groups: [] });
const collection = (): TagCollection => ({ schemaVersion: 1, tagIds: [], groups: [] });
const transcript = (ids: string[] = [], tags?: TagCollection): Transcript => ({ audio: { filename: 'synthetic.wav', duration: 10 },
    speakers: [{ id: 's', name: '合成说话人' }], segments: [{ id: 'p', text: '纯合成验收片段', speaker_id: 's', start: 0, end: 1, tagIds: ids }],
    ...(tags ? { tagCollection: tags } : {}) });
function fixture() {
    const a = setTagPath(empty(), '甲/教育/小学');
    const b = setTagPath(a.library, '乙/工作/创业');
    return { library: b.library, a: a.tag.id, b: b.tag.id };
}

describe('project catalog and version admission', () => {
    it('allows repeated leaves across full paths and reuses an exact case-insensitive path', () => {
        const a = setTagPath(empty(), '甲/A/1'), b = setTagPath(a.library, '乙/1');
        expect(isTagLibrary(b.library)).toBe(true);
        const again = setTagPath(b.library, '甲/a/1');
        expect(again.tag.id).toBe(a.tag.id);
        expect(again.library.tags).toHaveLength(5);
        expect(() => admitTags(b.library, admitTags(b.library, collection(), [a.tag.id]), [b.tag.id], '稿甲'))
            .toThrow(TagCollectionConflict);
    });
    it('admits ancestors atomically, keeps unused tags, and does not assign them to segments or groups', () => {
        const { library, a } = fixture(), c = admitTags(library, collection(), [a]);
        expect(c.tagIds.map(id => tagPath(library, id))).toEqual(['甲/教育/小学', '甲/教育', '甲']);
        expect(c.groups).toEqual([]);
        const t = transcript([], c);
        expect(versionTagCollection(t, library)).toBe(c);
        expect(t.segments[0].tagIds).toEqual([]);
        const invalid = { ...c, tagIds: [a] };
        expect(() => validateTagCollection(library, invalid)).toThrow();
    });
    it('retains legacy IDs, unused project definitions, and flattens groups without mutating the source', () => {
        const legacy: TagLibrary = { schemaVersion: 2, tags: [
            { id: 'root', name: '经历', parentId: null, groupIds: [] },
            { id: 'child', name: '求学', parentId: 'root', groupIds: ['g'] },
            { id: 'unused', name: '未使用', parentId: null, groupIds: [] },
        ], groups: [{ id: 'g', name: '合成组', parentId: null }] };
        const before = JSON.stringify(legacy), c = versionTagCollection(transcript(['child', 'deleted']), legacy);
        expect(c.tagIds).toEqual(['child', 'root']);
        expect(c.groups[0].tagIds).toEqual(['child']);
        expect(projectTagCatalog(legacy).tags.map(tag => tag.id)).toContain('unused');
        expect(versionTagCollection(transcript(['child']), projectTagCatalog(legacy)).groups).toEqual(c.groups);
        expect(JSON.stringify(legacy)).toBe(before);
    });
    it('group selection admits ancestors but adds only explicit members and remains a pure draft', () => {
        const { library, a } = fixture(), before = collection();
        const view = collectionLibrary(library, before);
        const pending = { ...view, groups: [{ id: 'g', name: '组甲', parentId: null }],
            tags: view.tags.map(tag => ({ ...tag, groupIds: tag.id === a ? ['g'] : [] })) };
        const next = collectionFromLibrary(pending, before);
        expect(next.tagIds).toHaveLength(3);
        expect(next.groups[0].tagIds).toEqual([a]);
        expect(before).toEqual(collection());
        expect(library.groups).toEqual([]);
        expect(projectTagCatalog(pending).legacyGroups).toBeUndefined();
    });
});

it('removes only the current admitted branch and keeps zero-use ancestors outside it',()=>{
    const {library,a}=fixture(), c=admitTags(library,collection(),[a]);
    const root=library.tags.find(tag=>tag.name==='甲')!, parent=library.tags.find(tag=>tag.name==='教育')!;
    c.groups=[{id:'g',name:'Synthetic group',tagIds:[root.id,a]}];
    const before=transcript([a],c),other=transcript([a],structuredClone(c));
    const next=removeVersionTagBranch(library,before,parent.id);
    expect(next.tagCollection?.tagIds).toEqual([root.id]);expect(next.tagCollection?.groups[0].tagIds).toEqual([root.id]);
    expect(next.segments[0].tagIds).toEqual([]);expect(next.segments[0].text).toBe(before.segments[0].text);
    expect(other.tagCollection?.tagIds).toHaveLength(3);expect(other.segments[0].tagIds).toEqual([a]);
    expect(tagPath(library,a)).toBe('甲/教育/小学');
});

describe('shared rename, movement and explicit subtree merge preflight', () => {
    it('updates shared paths without changing assignments in other versions', () => {
        const { library, a, b } = fixture();
        const ca = admitTags(library, collection(), [a]), cb = admitTags(library, collection(), [b]);
        const result = changeSharedTag(library, a, '甲/教育/童年', [
            { id: 'one', label: '合成稿一', transcript: transcript([a], ca) },
            { id: 'two', label: '合成稿二', transcript: transcript([b], cb) },
        ]);
        expect(tagPath(result.library, a)).toBe('甲/教育/童年');
        expect(result.consumers[1].transcript.segments[0].tagIds).toEqual([b]);
        expect(result.consumers[1].transcript.tagCollection?.tagIds).not.toContain(a);
    });
    it('blocks an entire shared edit on a consumer-only leaf conflict, including new ancestors', () => {
        const { library, a, b } = fixture(), c = admitTags(library, collection(), [a, b]);
        const original = JSON.stringify(library);
        try {
            changeSharedTag(library, a, '甲/教育/创业', [{ id: 'v', label: '冲突稿', transcript: transcript([a], c) }]);
            expect.fail('must reject');
        } catch (error) {
            expect(error).toBeInstanceOf(TagCollectionConflict);
            expect((error as TagCollectionConflict).consumer).toBe('冲突稿');
            expect((error as TagCollectionConflict).paths).toEqual(expect.arrayContaining(['甲/教育/创业', '乙/工作/创业']));
        }
        expect(JSON.stringify(library)).toBe(original);
        expect(() => changeSharedTag(library, a, '创业/童年', [{ id: 'v', label: '冲突稿', transcript: transcript([a], c) }]))
            .toThrow(TagCollectionConflict);
    });
    it('requires explicit merge and remaps every consumer reference without adding assignments', () => {
        const initial = fixture(), { a, b } = initial; let library = initial.library;
        const extra = setTagPath(library, '甲/教育/小学/操场'); library = extra.library;
        const c = admitTags(library, collection(), [extra.tag.id]);
        c.groups = [{ id: 'g', name: '合成组', tagIds: [a, extra.tag.id] }];
        const consumers = [{ id: 'one', label: '稿一', transcript: transcript([a, extra.tag.id], c) },
            { id: 'two', label: '稿二', transcript: transcript([b], admitTags(library, collection(), [b])) }];
        const before = JSON.stringify(consumers);
        expect(() => changeSharedTag(library, a, '乙/工作/创业', consumers)).toThrow(TagMergeRequired);
        expect(JSON.stringify(consumers)).toBe(before);
        const result = changeSharedTag(library, a, '乙/工作/创业', consumers, true);
        expect(result.library.tags.some(tag => tag.id === a)).toBe(false);
        expect(tagPath(result.library, extra.tag.id)).toBe('乙/工作/创业/操场');
        expect(result.consumers[0].transcript.segments[0].tagIds).toEqual([b, extra.tag.id]);
        expect(result.consumers[0].transcript.tagCollection?.groups[0].tagIds).toEqual([b, extra.tag.id]);
        expect(result.consumers[1].transcript.segments[0].tagIds).toEqual([b]);
    });
    it('preflights descendant overlaps as well as parent overlap and rejects cycles', () => {
        let library = setTagPath(empty(), '来源/孩子').library;
        library = setTagPath(library, '目标/孩子').library;
        const source = library.tags.find(tag => tag.name === '来源')!;
        const child = library.tags.find(tag => tag.parentId === source.id)!;
        const targetChild = library.tags.find(tag => tag.name === '孩子' && tag.id !== child.id)!;
        const c = admitTags(library, collection(), [child.id]);
        const result = changeSharedTag(library, source.id, '目标', [{ id: 'v', label: '稿', transcript: transcript([child.id], c) }], true);
        expect(result.remap.get(child.id)).toBe(targetChild.id);
        expect(() => changeSharedTag(library, source.id, '来源/孩子/新名', [])).toThrow('cycle');
    });
});
