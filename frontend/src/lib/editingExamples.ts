import type { ConnectorVersion } from './aiConnector';
import type { Segment, Transcript } from '../types';

/** Match recorded lineage, not text similarity or coincidental cross-model IDs. */
export function editingExamples(before: Transcript, after: Transcript, baseline: ConnectorVersion,
  current: ConnectorVersion, requested: string[]): Record<string, unknown>[] {
  const sameModel = baseline.model_id === current.model_id;
  const lineageModel = baseline.model_id;
  const anchors = (segment: Segment, original: boolean): string[] => {
    const recorded = (segment.words ?? []).flatMap(word => (word.origins ?? [])
      .filter(origin => origin.model === lineageModel).map(origin => origin.segment));
    return [...new Set([...recorded, ...(sameModel ? segment.mergedFrom ?? [] : []),
      ...(sameModel && segment.splitFrom ? [segment.splitFrom] : []), ...(original ? [segment.id] : [])])];
  };
  const beforeAnchors = before.segments.map(segment => anchors(segment, baseline.kind === 'original'));
  const afterAnchors = after.segments.map(segment => anchors(segment, sameModel && current.kind === 'original'));
  // Legacy same-model unchanged boundaries can identify a pair without origin metadata.
  if (sameModel) after.segments.forEach((segment, index) => {
    const b = before.segments.findIndex(s => s.id === segment.id && s.start === segment.start && s.end === segment.end);
    if (b < 0) return;
    if (!beforeAnchors[b].length && !afterAnchors[index].length) beforeAnchors[b] = [segment.id];
    if (!beforeAnchors[b].length) beforeAnchors[b] = [...afterAnchors[index]];
    if (!afterAnchors[index].length) afterAnchors[index] = [...beforeAnchors[b]];
  });
  return requested.map(id => {
    const index = after.segments.findIndex(s => s.id === id);
    if (index < 0) return { id, ambiguous: true, reason: 'current_segment_missing' };
    const segment = after.segments[index];
    const ids = new Set(afterAnchors[index]);
    if (!ids.size) return { id, ambiguous: true, reason: 'source_mapping_unavailable' };
    const sourceIndexes = new Set<number>(), currentIndexes = new Set<number>([index]);
    // Transitive groups retain complete context for merges/splits in either version.
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const [rows, selected] of [[beforeAnchors, sourceIndexes], [afterAnchors, currentIndexes]] as const) {
        rows.forEach((sources, i) => {
          if (selected.has(i) || !sources.some(source => ids.has(source))) return;
          selected.add(i); sources.forEach(source => ids.add(source)); expanded = true;
        });
      }
    }
    if (!sourceIndexes.size) return { id, ambiguous: true, reason: 'source_mapping_unavailable' };
    const covered = new Set([...sourceIndexes].flatMap(i => beforeAnchors[i]));
    if ([...ids].some(source => !covered.has(source))) return { id, ambiguous: true, reason: 'source_context_incomplete' };
    const sources = before.segments.filter((_, i) => sourceIndexes.has(i));
    const group = after.segments.filter((_, i) => currentIndexes.has(i));
    const beforeText = sources.map(s => s.text).join('\n\n');
    const afterText = group.map(s => s.text).join('\n\n');
    if (beforeText.length + afterText.length > 12000) return { id, too_large: true, reason: 'comparison_group_too_large' };
    return { id, start: segment.start, end: segment.end, before: beforeText, after: afterText,
      source_segment_ids: sources.map(s => s.id), current_segment_ids: group.map(s => s.id),
      changed: beforeText !== afterText, provenance: 'recorded_source_group_not_proof_of_human_authorship' };
  });
}
