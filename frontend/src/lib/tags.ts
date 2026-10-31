import type { Segment, Transcript } from '../types';
/** Definitions are project-owned. Segment associations belong to one version. */
export interface ProjectTag {
    id: string;
    name: string;
    groupIds: string[];
    parentId?: string | null;
}
export interface TagGroup {
    id: string;
    name: string;
    parentId: string | null;
}
export interface TagLibrary {
    schemaVersion: 1 | 2 | 3;
    tags: ProjectTag[];
    groups: TagGroup[];
    /** Immutable fallback for versions saved before groups became version-owned. */
    legacyGroups?: { groups: TagGroup[]; memberships: { tagId: string; groupIds: string[] }[] };
}
export const emptyTagLibrary = (): TagLibrary => ({ schemaVersion: 1, tags: [], groups: [] });
const identity = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const normalizeTagName = (name: string): string => name.trim().normalize('NFC');
const validName = (name: unknown): name is string => typeof name === 'string' && !!normalizeTagName(name) && name.length <= 120 && !Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
/** Optional extension: absence means an empty library, never a write-on-open migration. */
export function isTagLibrary(value: unknown): value is TagLibrary {
    if (!record(value) || ![1,2,3].includes(value.schemaVersion as number) || !Array.isArray(value.tags) || !Array.isArray(value.groups))
        return false;
    if (value.legacyGroups !== undefined) {
        const legacy = value.legacyGroups;
        if (value.schemaVersion !== 3 || !record(legacy) || !Array.isArray(legacy.groups) || !Array.isArray(legacy.memberships)
            || !isTagLibrary({ schemaVersion: 1, tags: [], groups: legacy.groups })
            || legacy.memberships.some(item => !record(item) || !identity(item.tagId) || !Array.isArray(item.groupIds)
                || item.groupIds.some(id => typeof id !== 'string' || !(legacy.groups as TagGroup[]).some(group => group.id === id)))) return false;
    }
    const groups = new Map<string, string | null>();
    for (const group of value.groups) {
        if (!record(group) || !identity(group.id) || groups.has(group.id) || !validName(group.name) || (group.parentId !== null && !identity(group.parentId)))
            return false;
        groups.set(group.id, group.parentId as string | null);
    }
    for (const [id, parent] of groups) {
        const seen = new Set([id]);
        let next = parent;
        while (next !== null) {
            if (!groups.has(next) || seen.has(next))
                return false;
            seen.add(next);
            next = groups.get(next)!;
        }
    }
    const ids = new Set<string>(), names = new Set<string>();
    for (const tag of value.tags) {
        if (!record(tag) || !identity(tag.id) || ids.has(tag.id) || !validName(tag.name) || !Array.isArray(tag.groupIds) || !tag.groupIds.every(id => typeof id === 'string' && groups.has(id)) || new Set(tag.groupIds).size !== tag.groupIds.length)
            return false;
        const name = normalizeTagName(tag.name).toLowerCase();
        if (value.schemaVersion !== 1 && (tag.name.includes('/') || (tag.parentId !== null && !identity(tag.parentId)))) return false;
        if (value.schemaVersion !== 3 && names.has(name))
            return false;
        ids.add(tag.id);
        names.add(name);
    }
    if (value.schemaVersion !== 1) {
        const parents = new Map(value.tags.map(tag => [(tag as ProjectTag).id, (tag as ProjectTag).parentId ?? null]));
        for (const id of parents.keys()) {
            const seen = new Set<string>(); let next: string | null = id;
            while (next !== null) { if (seen.has(next) || !parents.has(next)) return false; seen.add(next); next = parents.get(next)!; }
        }
        if (value.schemaVersion === 3) {
            const paths = new Set<string>();
            for (const tag of value.tags as ProjectTag[]) {
                const path = tagPath(value as unknown as TagLibrary, tag.id).split('/').map(part => normalizeTagName(part).toLowerCase()).join('/');
                if (paths.has(path)) return false;
                paths.add(path);
            }
        }
    }
    return true;
}
const pinyin = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true, sensitivity: 'base' });
const unicode = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const bucket = (s: string) => /^\p{Number}/u.test(s) ? 0 : /^\p{Script=Latin}/u.test(s) ? 1 : /^\p{Script=Han}/u.test(s) ? 2 : 3;
export function compareTagNames(a: string, b: string): number {
    const x = a.trim(), y = b.trim();
    return bucket(x) - bucket(y) || pinyin.compare(x, y) || unicode(x, y);
}
export function sortTags(tags: readonly ProjectTag[], key: 'name' | 'count', direction: 1 | -1, count: (id: string) => number): ProjectTag[] {
    return [...tags].sort((a, b) => key === 'count' ? direction * (count(a.id) - count(b.id)) || compareTagNames(a.name, b.name) || unicode(a.id, b.id) : direction * (compareTagNames(a.name, b.name) || unicode(a.id, b.id)));
}
export function segmentTagIds(segment: Segment): string[] {
    return [...new Set(Array.isArray(segment.tagIds) ? segment.tagIds.filter(identity) : [])];
}
/** Full substring matching; prefix matches precede infix matches, then normal name/ID order. */
export function suggestTags(tags: readonly ProjectTag[], input: string, assigned: readonly string[] = []): ProjectTag[] {
    const query = normalizeTagName(input).toLowerCase(), excluded = new Set(assigned);
    if (!query) return [];
    const library:TagLibrary={schemaVersion:2,tags:[...tags],groups:[]};
    const rank=(tag:ProjectTag)=>tag.name.toLowerCase().startsWith(query)?0:tag.name.toLowerCase().includes(query)?1:tagPath(library,tag.id).toLowerCase().includes(query)?2:3;
    return sortTags(tags.filter(tag=>!excluded.has(tag.id)&&rank(tag)<3),'name',1,()=>0).sort((a,b)=>rank(a)-rank(b));
}
/** All read paths ignore dangling IDs. A deleted entity never matches by name. */
export function tagsForSegment(segment: Segment, library: TagLibrary): ProjectTag[] {
    const ids = new Set(segmentTagIds(segment));
    return library.tags.filter(tag => ids.has(tag.id));
}
export function countTaggedSegments(transcript: Transcript, tagId: string, _library?: TagLibrary): number {
    void _library;
    return transcript.segments.filter(segment => segmentTagIds(segment).includes(tagId)).length;
}
export function setSegmentTag(transcript: Transcript, segmentId: string, tagId: string, enabled: boolean): Transcript {
    if (!identity(tagId))
        throw new Error('invalid_tag_identity');
    const target = transcript.segments.find(segment => segment.id === segmentId);
    if (!target || segmentTagIds(target).includes(tagId) === enabled) return transcript;
    return { ...transcript, segments: transcript.segments.map(segment => segment !== target ? segment : { ...segment, tagIds: enabled ? [...segmentTagIds(segment), tagId] : segmentTagIds(segment).filter(id => id !== tagId) }) };
}
export type TagFilter = string | { ids: readonly string[]; mode: 'and' | 'or'; scopeIds?: Readonly<Record<string, readonly string[]>> } | null;
export function matchesTagFilter(segment: Segment, filter: TagFilter): boolean {
    if (!filter) return true;
    const ids = typeof filter === 'string' ? [filter] : [...new Set(filter.ids)];
    if (!ids.length) return true;
    const assigned = new Set(segmentTagIds(segment));
    const hit = (id: string) => (typeof filter !== 'string' && filter.scopeIds?.[id] || [id]).some(value => assigned.has(value));
    return typeof filter === 'string' || filter.mode === 'and' ? ids.every(hit) : ids.some(hit);
}
export function filteredTagSegments(transcript: Transcript, hiddenSpeakers: ReadonlySet<string>, filter: TagFilter): Segment[] {
    return transcript.segments.filter(segment => !hiddenSpeakers.has(segment.speaker_id) && matchesTagFilter(segment, filter));
}
export function removeTagGroup(library: TagLibrary, groupId: string, scope: 'level' | 'tree' = 'level'): TagLibrary {
    const group = library.groups.find(group => group.id === groupId);
    if (!group)
        return library;
    const removed = new Set([groupId]);
    if (scope === 'tree') {
        for (let changed = true; changed;) {
            changed = false;
            for (const child of library.groups) if (child.parentId && removed.has(child.parentId) && !removed.has(child.id)) {
                removed.add(child.id);
                changed = true;
            }
        }
    }
    const children = library.groups.filter(child => child.parentId === groupId);
    const childIds = new Set(children.map(child => child.id));
    const groups = scope === 'tree' ? library.groups.filter(item => !removed.has(item.id))
        : library.groups.flatMap(item => item.id === groupId
            ? children.map(child => ({ ...child, parentId: group.parentId }))
            : childIds.has(item.id) ? [] : [item]);
    return { ...library, groups, tags: library.tags.map(tag => ({ ...tag, groupIds: tag.groupIds.filter(id => !removed.has(id)) })) };
}
/** Move only the explicit source membership; copying always reuses the same tag entity. */
export function transferTagGroup(library: TagLibrary, tagId: string, sourceId: string | null, targetId: string, copy: boolean, detachedSource=false): TagLibrary {
    const tag = library.tags.find(tag => tag.id === tagId);
    if (!tag || sourceId === targetId || !library.groups.some(group => group.id === targetId)) return library;
    if (sourceId ? !tag.groupIds.includes(sourceId) : !detachedSource && tag.groupIds.length > 0) return library;
    const groupIds = sourceId && !copy ? tag.groupIds.filter(id => id !== sourceId) : [...tag.groupIds];
    if (!groupIds.includes(targetId)) groupIds.push(targetId);
    if (groupIds.length === tag.groupIds.length && groupIds.every((id, index) => id === tag.groupIds[index])) return library;
    return { ...library, tags: library.tags.map(item => item.id === tagId ? { ...item, groupIds } : item) };
}
export function moveTagGroup(library: TagLibrary, sourceId: string, targetId: string | null, mode: 'before' | 'after' | 'inside'): TagLibrary {
    const source = library.groups.find(group => group.id === sourceId), target = library.groups.find(group => group.id === targetId);
    if (!source || (targetId !== null && !target) || sourceId === targetId)
        return library;
    const parentId = mode === 'inside' ? targetId : target?.parentId ?? null;
    let ancestor = parentId;
    while (ancestor) {
        if (ancestor === sourceId)
            return library;
        ancestor = library.groups.find(group => group.id === ancestor)?.parentId ?? null;
    }
    const groups = library.groups.filter(group => group.id !== sourceId), position = target ? groups.findIndex(group => group.id === targetId) + (mode === 'before' ? 0 : 1) : groups.length;
    groups.splice(position, 0, { ...source, parentId });
    return { ...library, groups };
}

/** Editable content only: audio playback anchoring and cursor metadata are not edits. */
export function tagHistoryAnchor(transcript:Transcript|null):string {
 return JSON.stringify(transcript?{speakers:transcript.speakers,segments:transcript.segments.map(segment=>[segment.id,segment.text,segment.speaker_id,segment.tagIds,segment.annotations,segment.highlights])}:null);
}

export class TagTreeError extends Error {
    constructor(public code: 'invalid_path'|'path_conflict'|'cycle'|'invalid_tree', public value='') { super(code); this.name='TagTreeError'; }
}
export const tagParentId = (tag: ProjectTag): string|null => tag.parentId ?? null;
export function hierarchyLibrary(library: TagLibrary): TagLibrary {
    if(library.schemaVersion!==1) {if(!isTagLibrary(library))throw new TagTreeError('invalid_tree');return library;}
    // Only returned to an explicit tag transaction; never write on project open.
    // Legacy path labels become relations, retaining each terminal tag's ID.
    const tags:ProjectTag[]=library.tags.filter(tag=>!tag.name.includes('/')).map(tag=>({...tag,name:normalizeTagName(tag.name),parentId:null}));
    const paths=library.tags.filter(tag=>tag.name.includes('/')).sort((a,b)=>a.name.split('/').length-b.name.split('/').length);
    for(const source of paths) {
        const parts=splitTagPath(source.name);let parentId:string|null=null;
        for(let index=0;index<parts.length;index++) {
            const name=parts[index],leaf=index===parts.length-1,existing=tags.find(tag=>tag.name.toLowerCase()===name.toLowerCase());
            if(existing) {
                if(tagParentId(existing)!==parentId || leaf&&existing.id!==source.id)throw new TagTreeError('path_conflict',name);
                parentId=existing.id;
            } else {const tag:ProjectTag={...(leaf?source:{id:crypto.randomUUID(),groupIds:[]}),name,parentId};tags.push(tag);parentId=tag.id;}
        }
    }
    const result:TagLibrary={...library,schemaVersion:2,tags};if(!isTagLibrary(result))throw new TagTreeError('invalid_tree');return result;
}

/** Nearest ancestor first. Defensive traversal also permits inspecting legacy data. */
export function tagAncestors(library:TagLibrary,id:string):ProjectTag[] {
    const tags=new Map(library.tags.map(tag=>[tag.id,tag])),result:ProjectTag[]=[],seen=new Set([id]);let next=tags.get(id);
    while(next && tagParentId(next)) { const parent=tags.get(tagParentId(next)!);if(!parent || seen.has(parent.id))break;seen.add(parent.id);result.push(parent);next=parent; }
    return result;
}
export function tagPath(library:TagLibrary,id:string):string {
    const tag=library.tags.find(tag=>tag.id===id);return tag?[...tagAncestors(library,id).reverse().map(tag=>tag.name),tag.name].join('/'):'';
}
export function descendantTagIds(library:TagLibrary,id:string):string[] {
    const result=new Set([id]);for(let changed=true;changed;){changed=false;for(const tag of library.tags)if(tagParentId(tag)&&result.has(tagParentId(tag)!)&&!result.has(tag.id)){result.add(tag.id);changed=true;}}
    return [...result];
}
export function hierarchyTagFilter(library:TagLibrary,ids:readonly string[],mode:'and'|'or'):TagFilter {
    return {ids:[...new Set(ids)],mode,scopeIds:Object.fromEntries(ids.map(id=>[id,descendantTagIds(library,id)]))};
}
export function splitTagPath(raw:string):string[] {
    const parts=raw.split('/').map(normalizeTagName);
    if(!parts.length || parts.some(part=>!validName(part) || part.includes('/')))throw new TagTreeError('invalid_path',raw);
    return parts;
}
/** Preflight the complete path in memory, then return one transaction. No caller-visible partial ancestors. */
export function setTagPath(source:TagLibrary,raw:string,targetId?:string):{library:TagLibrary;tag:ProjectTag} {
    const library=hierarchyLibrary(source),parts=splitTagPath(raw),tags=[...library.tags],target=targetId?tags.find(tag=>tag.id===targetId):undefined;
    if(targetId&&!target)throw new TagTreeError('invalid_tree');
    let parentId:string|null=null,last:ProjectTag|undefined;
    for(let index=0;index<parts.length;index++) {
        const name=parts[index],leaf=index===parts.length-1,existing=tags.find(tag=>normalizeTagName(tag.name).toLowerCase()===name.toLowerCase()&&(library.schemaVersion!==3||tagParentId(tag)===parentId));
        if(leaf&&target) {
            if(existing&&existing.id!==target.id)throw new TagTreeError('path_conflict',name);
            if(parentId===target.id || (parentId&&descendantTagIds(library,target.id).includes(parentId)))throw new TagTreeError('cycle');
            last={...target,name,parentId};tags[tags.findIndex(tag=>tag.id===target.id)]=last;
        } else if(existing) {
            if(existing.id===targetId || tagParentId(existing)!==parentId)throw new TagTreeError(existing.id===targetId?'cycle':'path_conflict',name);
            last=existing;
        } else {last={id:crypto.randomUUID(),name,parentId,groupIds:[]};tags.push(last);}
        parentId=last.id;
    }
    const result={...library,tags};if(!isTagLibrary(result))throw new TagTreeError('invalid_tree');
    return {library:result,tag:last!};
}
export function renameTagLeaf(source:TagLibrary,id:string,raw:string):TagLibrary {
    if(raw.includes('/'))throw new TagTreeError('invalid_path',raw);
    const library=hierarchyLibrary(source),tag=library.tags.find(tag=>tag.id===id),name=normalizeTagName(raw);
    if(!tag||!validName(name))throw new TagTreeError('invalid_path',raw);
    if(library.tags.some(other=>other.id!==id&&normalizeTagName(other.name).toLowerCase()===name.toLowerCase()&&(library.schemaVersion!==3||tagParentId(other)===tagParentId(tag))))throw new TagTreeError('path_conflict',name);
    return {...library,tags:library.tags.map(tag=>tag.id===id?{...tag,name}:tag)};
}
export function reparentTag(source:TagLibrary,id:string,parentId:string|null):TagLibrary {
    const tag=source.tags.find(tag=>tag.id===id);
    if(!tag || tagParentId(tag)===parentId || parentId===id || parentId&&!source.tags.some(tag=>tag.id===parentId) || parentId&&descendantTagIds(source,id).includes(parentId))return source;
    const library=hierarchyLibrary(source);return {...library,tags:library.tags.map(tag=>tag.id===id?{...tag,parentId}:tag)};
}
/** Both views keep absolute tag depth; absent group ancestors never become virtual rows. */
export function tagTreeRows(library:TagLibrary,memberIds?:ReadonlySet<string>,key:'name'|'count'|'manual'='name',direction:1|-1=1,count:(id:string)=>number=()=>0,manualOrder:readonly string[]=[]):{tag:ProjectTag;depth:number;parentPath:string;includedParentId:string|null}[] {
    const result:{tag:ProjectTag;depth:number;parentPath:string;includedParentId:string|null}[]=[];
    const rank=new Map(manualOrder.map((id,index)=>[id,index]));
    const visit=(parentId:string|null,depth:number,rootDepth:number|null,includedParentId:string|null)=>{
        const siblings=library.tags.filter(tag=>tagParentId(tag)===parentId);
        const ordered=key==='manual'?siblings.sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity)||compareTagNames(a.name,b.name)||a.id.localeCompare(b.id)):sortTags(siblings,key,direction,count);
        for(const tag of ordered) {
            const included=!memberIds||memberIds.has(tag.id),base=included?(rootDepth??depth):rootDepth;
            if(included)result.push({tag,depth,parentPath:tagAncestors(library,tag.id).reverse().map(tag=>tag.name).join('/'),includedParentId});
            visit(tag.id,depth+1,base,included?tag.id:includedParentId);
        }
    };visit(null,0,null,null);return result;
}
/** Delete the entity only, lifting children; descendants and their associations survive. */
export function removeTagNode(source:TagLibrary,id:string):TagLibrary {
    const library=hierarchyLibrary(source),tag=library.tags.find(tag=>tag.id===id);if(!tag)return source;
    const next={...library,tags:library.tags.filter(tag=>tag.id!==id).map(child=>tagParentId(child)===id?{...child,parentId:tagParentId(tag)}:child)};
    if(next.schemaVersion===3) {
        const paths=new Set<string>();
        for(const tag of next.tags){const path=tagPath(next,tag.id),key=path.split('/').map(part=>normalizeTagName(part).toLowerCase()).join('/');if(paths.has(key))throw new TagTreeError('path_conflict',path);paths.add(key)}
    }
    return next;
}
/** Removing a definition invalidates all of its project-scoped associations. */
export function removeTagBranch(source:TagLibrary,id:string):TagLibrary {
    if(!source.tags.some(tag=>tag.id===id))return source;
    const library=hierarchyLibrary(source),removed=new Set(descendantTagIds(library,id));
    return {...library,tags:library.tags.filter(tag=>!removed.has(tag.id))};
}
