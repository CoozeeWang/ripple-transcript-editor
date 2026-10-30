import { tagAncestors, type TagLibrary } from '../lib/tags';
/** Each track belongs to this node's real ancestry; unrelated preceding rows cannot connect it. */
export function TagTreeGuides({ library, id, members }: { library: TagLibrary; id: string; members?: ReadonlySet<string> }) {
    const ancestors = tagAncestors(library, id).reverse();
    const connected = members ? ancestors.findIndex(tag => members.has(tag.id)) : 0;
    return <span className="tag-tree-guides" aria-hidden="true">{ancestors.map((tag, index) =>
        <span key={tag.id} className={connected >= 0 && index >= connected ? 'tag-tree-track' : 'tag-tree-dot'} style={{ left: index * 16 }}/>)}</span>;
}
