import type { TagGuide } from '../lib/tagTreeGuides';
/** One rounded elbow per edge; dots denote only absent ancestor levels. */
export function TagTreeGuides({ guide, step = 16, origin = 4 }: { guide?: TagGuide; step?: number; origin?: number }) {
    if (!guide?.depth) return null;
    const left = (guide.parentDepth ?? 0) * step + origin, end = guide.depth * step - 4;
    const horizontalStart = Math.min(left + 4, end);
    return <span className="tag-tree-guides" aria-hidden="true">
        {guide.continuingDepths.map(depth => <span key={depth} className="tag-tree-continuation" style={{ left: depth * step + origin }}/>) }
        <span className={'tag-tree-elbow' + (guide.parentDepth === null ? ' is-independent' : '')} style={{ left, width: Math.max(0, end - left) }}/>
        {Array.from({ length: guide.missing }, (_, index) => <span key={index} className="tag-tree-missing" style={{ left: horizontalStart + (end - horizontalStart) * (index + .5) / guide.missing }}/>) }
    </span>;
}
