import { msg } from '../i18n';
import { AUDIO_EXT } from '../localStore';
import { pickerLocation } from './projectPreferences';
import { mediaFingerprint } from './projectStore';

/** File selection provides persistent handles; verify them before replacing temporary dropped Files. */
export async function selectAudioReferences(dropped: FileSystemFileHandle[]): Promise<FileSystemFileHandle[] | null> {
  const picker = window as unknown as { showOpenFilePicker: (options: unknown) => Promise<FileSystemFileHandle[]> };
  let selected: FileSystemFileHandle[];
  try {
    selected = await picker.showOpenFilePicker({ ...await pickerLocation('open-audio', 'read'), multiple: true,
      types: [{ description: msg('ProjectSetup.m0786'), accept: { 'audio/*': AUDIO_EXT.map(ext => `.${ext}`) } }] });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError' || String(error).includes('已取消选择')) return null;
    throw error;
  }
  if (!selected.length) return null;
  if (selected.length !== dropped.length) throw new Error(msg('audioReferenceSelection.mismatch'));
  const available = [];
  for (const handle of selected) available.push({ handle, fingerprint: await mediaFingerprint(await handle.getFile()) });
  const matched: FileSystemFileHandle[] = [];
  for (const handle of dropped) {
    const fingerprint = await mediaFingerprint(await handle.getFile());
    const index = available.findIndex(item => item.fingerprint === fingerprint);
    if (index < 0) throw new Error(msg('audioReferenceSelection.mismatch'));
    matched.push(available.splice(index, 1)[0].handle);
  }
  return matched;
}
