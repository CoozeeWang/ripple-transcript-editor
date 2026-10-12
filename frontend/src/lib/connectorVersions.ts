import { defaultEditLabel, readModelEdit, readModelOriginal } from '../localStore';
import type { TranscriptModel } from '../types';
import type { ConnectorReference, ConnectorVersion } from './aiConnector';
import { originalVersionLabel } from './transcriptLabels';

export function connectorVersions(models: TranscriptModel[]): ConnectorVersion[] {
  return models.flatMap(model => [
    ...(model.designatedOriginal || (model.original && model.sourceKind !== 'import') ? [{ id: `${model.id}:original`, model_id: model.id,
      edit_id: 'original', name: originalVersionLabel(model), kind: 'original' as const }] : []),
    ...(model.designatedOriginal ? [] : model.edits.map((edit, i) => ({ id: `${model.id}:${edit.id}`,
      model_id: model.id, edit_id: edit.id, name: edit.label ?? defaultEditLabel(i), kind: 'edit' as const }))),
  ]);
}

export function connectorReferences(dir: FileSystemDirectoryHandle, audio: string, models: TranscriptModel[]): ConnectorReference[] {
  return connectorVersions(models).map(version => ({ version, load: async () => {
    const data = version.kind === 'original'
      ? await readModelOriginal(dir, audio, version.model_id)
      : await readModelEdit(dir, audio, version.model_id, version.edit_id);
    return data?.transcript ?? null;
  } }));
}
