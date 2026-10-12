import { msg } from '../i18n';
import type { TranscriptModel } from '../types';

/** Keep source names as user data; only the read-only suffix is translated. */
export function importedManuscriptName(model: Pick<TranscriptModel, 'label' | 'sourceName'>, fallback = msg('VersionPicker.m1095')): string {
  return model.label?.trim() || model.sourceName?.replace(/\.[^.]+$/, '') || fallback;
}

export function originalVersionLabel(model: TranscriptModel): string {
  const name = model.label?.trim() || (model.sourceKind==='import' ? model.sourceName?.replace(/\.[^.]+$/, '') : undefined);
  return name
    ? msg('VersionPicker.m1085', { name })
    : msg('VersionPicker.m1086');
}
