import type { Transcript } from '../types';
import type { TagCollection } from './tagCollections';
import type { TagLibrary } from './tags';
import { cleanTagOrders } from './tagOrdering';
import { tagFields, type TagFields, type TagTransactionReceipt } from './projectTagRepository';

type View = 'level' | 'groups';
const key = (value: unknown) => JSON.stringify(value);
const priority = (base: readonly string[] = [], old: readonly string[] = []) => [...new Set([...base, ...old])];

/** Preserve memberships and definitions: only current display priorities are carried across history. */
export function carryTagOrder(library: TagLibrary, collection: TagCollection, base: TagCollection, view: View): TagCollection {
    const rank = new Map(base.groups.map((group, index) => [group.id, index]));
    const next = view === 'level' ? { ...collection, levelOrder: priority(base.levelOrder, collection.levelOrder) }
        : { ...collection, groups: [...collection.groups].sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity)).map(group => {
            const sorted = base.groups.find(item => item.id === group.id);
            return sorted ? { ...group, order: priority(sorted.order, group.order) } : group;
        }), ungroupedOrder: priority(base.ungroupedOrder, collection.ungroupedOrder) };
    return cleanTagOrders(library, next);
}

/** Rebase both editor snapshots and exact durable receipts, never the manuscript text. */
export function tagOrderHistoryRebase(base: TagCollection, view: View, versionId: string,
    receipts: readonly TagTransactionReceipt[], sorted: TagTransactionReceipt, current: Transcript) {
    const catalogs = new Map<string, TagLibrary>();
    const snapshots = new Map<string, { fields: TagFields; revision?: string }>();
    // A no-op sort has no file patch, but this exact current revision must survive later redo.
    snapshots.set(key(tagFields(current)), { fields: tagFields(current), revision: current.tagStorageRevision });
    const fields = (previous: TagFields, library: TagLibrary): TagFields => previous.collection
        ? { ...previous, collection: carryTagOrder(library, previous.collection, base, view) } : previous;
    // A tag operation creates a collection snapshot; intervening body edits share its catalog epoch.
    for (const receipt of [...receipts, sorted]) for (const patch of receipt.versions) if (patch.id === versionId) {
        catalogs.set(key(patch.before.collection), receipt.beforeLibrary);
        catalogs.set(key(patch.after.collection), receipt.afterLibrary);
    }
    for (const patch of sorted.versions) if (patch.id === versionId) {
        snapshots.set(key(patch.after), { fields: patch.after, revision: patch.afterRevision });
        snapshots.set(key(patch.before), { fields: patch.after, revision: patch.afterRevision });
    }
    const state = (previous: TagFields, library: TagLibrary, revision?: string) => {
        const next = fields(previous, library), signature = key(next);
        let saved = snapshots.get(signature);
        if (!saved) { saved = { fields: next, revision: key(previous) === signature ? revision : revision ? crypto.randomUUID() : undefined }; snapshots.set(signature, saved); }
        snapshots.set(key(previous), saved);
        return saved;
    };
    const rebased = new Map<TagTransactionReceipt, TagTransactionReceipt>();
    for (const receipt of receipts) rebased.set(receipt, { ...receipt, versions: receipt.versions.map(patch => {
        if (patch.id !== versionId) return patch;
        const before = state(patch.before, receipt.beforeLibrary, patch.beforeRevision), after = state(patch.after, receipt.afterLibrary, patch.afterRevision);
        return { ...patch, before: before.fields, after: after.fields, beforeRevision: before.revision, afterRevision: after.revision };
    }) });
    return {
        receipt: (receipt: TagTransactionReceipt) => rebased.get(receipt) ?? receipt,
        snapshot: (transcript: Transcript): Transcript => {
            const saved = snapshots.get(key(tagFields(transcript)));
            const collection = transcript.tagCollection && carryTagOrder(catalogs.get(key(transcript.tagCollection)) ?? sorted.afterLibrary, transcript.tagCollection, base, view);
            return { ...transcript, ...(collection ? { tagCollection: saved?.fields.collection ?? collection } : {}),
                ...(saved?.revision ? { tagStorageRevision: saved.revision } : {}) };
        },
    };
}
