// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { chooseDirectory, pickerLocation, FIXED_PROJECT_LOCATION } from './projectPreferences';
const handles = vi.hoisted(() => new Map());
vi.mock('./projectStore', () => ({ handleValue: vi.fn(async (key, value) => {
  if (value !== undefined) handles.set(key, value);
  return handles.get(key);
}) }));
const folder = (name: string, permission = 'granted') => ({ name, queryPermission: vi.fn(async () => permission) });
afterEach(() => { handles.clear(); localStorage.clear(); vi.restoreAllMocks(); });
it('uses a fixed folder only as the starting point and accepts a different destination', async () => {
  localStorage.setItem(FIXED_PROJECT_LOCATION, '1');
  const fixed = folder('默认'); const selected = folder('任意其他位置');
  handles.set('preferred-project-parent', fixed);
  const picker = vi.fn(async () => selected);
  Object.assign(window, { showDirectoryPicker: picker });
  expect(await chooseDirectory('save-project')).toBe(selected);
  expect(picker).toHaveBeenCalledWith({ mode: 'readwrite', id: 'ripple-save-project', startIn: fixed });
  expect(handles.get('preferred-project-parent')).toBe(fixed);
  expect(handles.get('last-project-parent')).toBe(selected);
  expect((await pickerLocation('open-audio', 'read')).startIn).toBeUndefined();
});
it('keeps the audio folder and project save histories separate', async () => {
  const audio = folder('录音'); const project = folder('项目');
  handles.set('picker:open-audio-folder', audio);
  handles.set('last-project-parent', project);
  expect((await pickerLocation('save-project')).startIn).toBe(project);
  expect((await pickerLocation('open-audio-folder')).startIn).toBe(audio);
  expect(await pickerLocation('open-audio', 'read')).toEqual({ id: 'ripple-open-audio' });
});
it('falls back for inaccessible defaults and never retries a cancelled picker', async () => {
  localStorage.setItem(FIXED_PROJECT_LOCATION, '1');
  handles.set('preferred-project-parent', folder('已失效', 'denied'));
  const picker = vi.fn(async () => { throw new DOMException('取消', 'AbortError'); });
  Object.assign(window, { showDirectoryPicker: picker });
  await expect(chooseDirectory('save-project')).rejects.toThrow('取消');
  expect(picker).toHaveBeenCalledExactlyOnceWith({ mode: 'readwrite', id: 'ripple-save-project' });
  expect(handles.has('last-project-parent')).toBe(false);
});
