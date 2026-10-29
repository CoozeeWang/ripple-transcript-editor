import type { TranscriptModel } from '../types';
import { defaultEditLabel } from '../localStore';
import { originalVersionLabel } from './transcriptLabels';

/** Display snapshot only: names never participate in the stable link identity. */
export function segmentSourceTitle(title: string, model?: TranscriptModel, version?: string): string {
  if (!model || !version) return title;
  const index = model.edits.findIndex(edit => edit.id === version);
  const label = version === 'original' || model.designatedOriginal
    ? originalVersionLabel(model)
    : index >= 0 ? model.edits[index].label?.trim() || defaultEditLabel(index) : '';
  // Unknown version metadata must not fabricate a name from an internal ID.
  if (!label || title === label || title.endsWith(` · ${label}`)) return title;
  return title ? `${title} · ${label}` : label;
}
