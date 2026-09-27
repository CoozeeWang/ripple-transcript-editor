import { afterEach, expect, it, vi } from 'vitest';
import { selectAudioReferences } from './audioReferenceSelection';
vi.mock('./projectPreferences', () => ({ pickerLocation: async () => ({}) }));
afterEach(() => vi.unstubAllGlobals());
function handle(name: string, content: string) {
  return { name, kind: 'file', getFile: async () => new File([content], name) } as FileSystemFileHandle;
}
it('matches selected originals by full content and preserves the dropped order', async () => {
  const a = handle('A.wav', 'first'), b = handle('B.wav', 'second');
  vi.stubGlobal('window', { showOpenFilePicker: vi.fn(async () => [b, a]) });
  expect(await selectAudioReferences([handle('A.wav', 'first'), handle('B.wav', 'second')])).toEqual([a, b]);
});
it('rejects a same-name file with different contents before replacing handles', async () => {
  vi.stubGlobal('window', { showOpenFilePicker: async () => [handle('A.wav', 'other')] });
  await expect(selectAudioReferences([handle('A.wav', 'first')])).rejects.toThrow('内容不一致');
});
it('rejects extra or missing files rather than silently changing the import batch', async () => {
  vi.stubGlobal('window', { showOpenFilePicker: async () => [handle('A.wav', 'first'), handle('B.wav', 'second')] });
  await expect(selectAudioReferences([handle('A.wav', 'first')])).rejects.toThrow('数量或内容不一致');
});
it.each([new DOMException('cancel', 'AbortError'), '已取消选择'])('leaves the import pending when selection is cancelled', async error => {
  vi.stubGlobal('window', { showOpenFilePicker: async () => { throw error; } });
  expect(await selectAudioReferences([handle('A.wav', 'first')])).toBeNull();
});
