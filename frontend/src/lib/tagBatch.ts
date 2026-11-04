import type { Transcript } from '../types';
import {cleanTagOrders} from './tagOrdering';
import {reorderProjectTree} from './projectTreeOrder';
import type { ProjectTagChange, TagTransactionScope } from './projectTagRepository';
import { admitTags, changeSharedTag, projectTagCatalog, removeVersionTagBranch, validateTagCollection, versionTagCollection, type TagConsumer } from './tagCollections';
import { removeTagBranch, setTagPath, tagAncestors, tagPath, type TagLibrary } from './tags';

export const TAG_ACTIONS = ['create_tag','rename_tag','set_tag_path','move_tag','merge_tag','delete_branch','admit_tags','remove_current_branch',
    'reorder_tags','assign_tags','unassign_tags'] as const;
export type TagAction = typeof TAG_ACTIONS[number];
export type TagChange = { action: TagAction; [key: string]: unknown };
const SHARED = new Set<TagAction>(['rename_tag','set_tag_path','move_tag','merge_tag','delete_branch','reorder_tags']);
const FIELDS: Record<TagAction, string[]> = {
    create_tag:['path','ref'], rename_tag:['tag_id','name'], set_tag_path:['tag_id','path'], move_tag:['tag_id','parent_id'], merge_tag:['tag_id','target_tag_id'],
    delete_branch:['tag_id'], admit_tags:['tag_ids'], remove_current_branch:['tag_id'], assign_tags:['segment_ids','tag_ids'], unassign_tags:['segment_ids','tag_ids'],
    reorder_tags:['view','parent_id','tag_ids'],
};
function error(code: string): never { throw Error(code); }
const text = (value: unknown, max = 1024): string => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : error('invalid_tag_change');
const list = (value: unknown): string[] => Array.isArray(value) && value.length <= 2000 && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 120)
    && new Set(value).size === value.length ? value as string[] : error('invalid_tag_change');
export function validateTagChanges(value: unknown, allowed: unknown): TagChange[] {
    if(Array.isArray(allowed)&&allowed.some(action=>['create_group','rename_group','dissolve_group','set_group_tags','transfer_group_tag','reorder_groups','place_group_tag'].includes(String(action))))error('unsupported_tag_operation');
    if (!Array.isArray(allowed) || !allowed.length || allowed.some(action => !TAG_ACTIONS.includes(action as TagAction))) error('tag_actions_required');
    if (!Array.isArray(value) || !value.length || value.length > 64) error('invalid_tag_batch');
    return value.map((value: unknown) => {
        if (!value || typeof value !== 'object') error('invalid_tag_change');
        const change = value as Record<string, unknown>;
        if(['create_group','rename_group','dissolve_group','set_group_tags','transfer_group_tag','reorder_groups','place_group_tag'].includes(String(change.action))||['group','ungrouped'].includes(String(change.view))||Object.keys(change).some(key=>['group_id','group_ids','source_group_id'].includes(key)))error('unsupported_tag_operation');
        if (!TAG_ACTIONS.includes(change.action as TagAction) || !allowed.includes(change.action)) error('tag_action_outside_allowed_scope');
        if (Object.keys(change).some(key => key !== 'action' && !FIELDS[change.action as TagAction].includes(key))) error('invalid_tag_change');
        return structuredClone(change) as TagChange;
    });
}
export function tagBatchScope(changes: readonly TagChange[]): TagTransactionScope {
    return changes.every(change=>change.action==='reorder_tags')?'order':changes.some(change => SHARED.has(change.action)) ? 'project' : changes.some(change => change.action === 'create_tag') ? 'additions' : 'current';
}
export interface TagBatchResult extends ProjectTagChange { references: { tags: Record<string,string> } }
/** UI and MCP share the same stable-ID/tree/collection operations and repository transaction. No IO here. */
export function applyTagBatch(source: TagLibrary, consumers: readonly TagConsumer[], currentId: string, changes: readonly TagChange[]): TagBatchResult {
    validateTagChanges(changes,changes.map(change=>change.action));
    let library = projectTagCatalog(source);
    let rows: TagConsumer[] = consumers.map(consumer => ({ ...consumer, transcript: { ...consumer.transcript, tagCollection: versionTagCollection(consumer.transcript, source) } }));
    if (!rows.some(row => row.id === currentId)) error('tag_target_unavailable');
    const tagRefs = new Map<string,string>();
    const resolve = (raw: unknown): string => {
        const input = text(raw, 120), id = input.startsWith('ref:') ? tagRefs.get(input.slice(4)) : input;
        if (!id || !library.tags.some(tag=>tag.id===id)) error('tag_entity_not_found');
        return id;
    };
    const current = () => rows.find(row => row.id === currentId)!.transcript;
    const update = (fn: (t: Transcript) => Transcript) => { rows = rows.map(row => row.id === currentId ? { ...row, transcript: fn(row.transcript) } : row); };
    const remember = (raw: unknown, id: string, refs: Map<string,string>) => {
        if (raw === undefined) return;
        const ref = text(raw, 80); if (!/^[a-zA-Z0-9-]+$/.test(ref) || refs.has(ref)) error('invalid_tag_reference'); refs.set(ref, id);
    };
    const ids = (value: unknown) => list(value).map(id => resolve(id));
    let associations = 0;
    for (const c of changes) {
        switch (c.action) {
            case 'create_tag': {
                const made = setTagPath(library, text(c.path)); library = made.library;
                update(t => ({ ...t, tagCollection: admitTags(library, t.tagCollection!, [made.tag.id]) })); remember(c.ref, made.tag.id, tagRefs); break;
            }
            case 'rename_tag': case 'set_tag_path': case 'move_tag': case 'merge_tag': {
                const id = resolve(c.tag_id), tag = library.tags.find(tag => tag.id === id)!;
                let path: string;
                if (c.action === 'rename_tag') { const name = text(c.name, 120); if (name.includes('/')) error('tag_name_must_not_include_path'); path = [...tagAncestors(library,id).reverse().map(tag=>tag.name),name].join('/'); }
                else if (c.action === 'set_tag_path') path = text(c.path);
                else if (c.action === 'merge_tag') { const target = resolve(c.target_tag_id); if (id === target) break; path = tagPath(library,target); }
                else { if (!Object.hasOwn(c,'parent_id')) error('tag_parent_required'); const parent = c.parent_id === null ? '' : tagPath(library,resolve(c.parent_id)); path = [parent,tag.name].filter(Boolean).join('/'); }
                const changed = changeSharedTag(library,id,path,rows,c.action === 'merge_tag'); library = changed.library; rows = changed.consumers;
                break;
            }
            case 'delete_branch': {
                library = removeTagBranch(library,resolve(c.tag_id)); const valid = new Set(library.tags.map(tag=>tag.id));
                rows = rows.map(row => ({...row,transcript:{...row.transcript,tagCollection:{...row.transcript.tagCollection!,
                    tagIds:row.transcript.tagCollection!.tagIds.filter(id=>valid.has(id)),groups:row.transcript.tagCollection!.groups.map(group=>({...group,tagIds:group.tagIds.filter(id=>valid.has(id))}))},
                    segments:row.transcript.segments.map(segment=>segment.tagIds?.some(id=>!valid.has(id))?{...segment,tagIds:segment.tagIds.filter(id=>valid.has(id))}:segment)}})); break;
            }
            case 'admit_tags': { const selected = ids(c.tag_ids); update(t=>({...t,tagCollection:admitTags(library,t.tagCollection!,selected)})); break; }
            case 'remove_current_branch': { const id = resolve(c.tag_id); update(t=>removeVersionTagBranch(library,t,id)); break; }
            case 'reorder_tags': {
                if(c.view!==undefined&&c.view!=='level')error('unsupported_tag_operation');
                if(!Object.hasOwn(c,'parent_id'))error('invalid_tag_order');
                const parent=c.parent_id===null?null:resolve(c.parent_id);
                library=reorderProjectTree(library,parent,ids(c.tag_ids));break;
            }
            case 'assign_tags': case 'unassign_tags': {
                const selected = ids(c.tag_ids), targets = list(c.segment_ids);
                if (!selected.length || !targets.length || targets.some(id=>!current().segments.some(s=>s.id===id))) error('tag_segment_not_found');
                associations += selected.length * targets.length; if (associations > 10000) error('tag_batch_too_large');
                update(t=>{
                    const next = c.action === 'assign_tags' ? {...t,tagCollection:admitTags(library,t.tagCollection!,selected)} : t;
                    const targetIds=new Set(targets),tagIds=new Set(selected);
                    return{...next,segments:next.segments.map(segment=>{
                        if(!targetIds.has(segment.id))return segment;
                        const before=segment.tagIds??[],after=c.action==='assign_tags'?[...new Set([...before,...selected])]:before.filter(id=>!tagIds.has(id));
                        return before.length===after.length&&before.every((id,i)=>id===after[i])?segment:{...segment,tagIds:after};
                    })};
                }); break;
            }
        }
    }
    rows=rows.map(row=>({...row,transcript:{...row.transcript,tagCollection:cleanTagOrders(library,row.transcript.tagCollection!)}}));
    for (const row of rows) validateTagCollection(library,row.transcript.tagCollection!,row.label);
    return {library,consumers:rows,references:{tags:Object.fromEntries(tagRefs)}};
}
