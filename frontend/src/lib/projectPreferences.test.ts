// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { canRestoreProject, rememberInterview, restoredInterview, RESTORE_PROJECT_INTERVIEW } from './projectPreferences';
import { saveBooleanPreference } from './preferences';
import type { OpenProject } from './projectStore';
const project = (id: string) => ({ data: { id, interviews: [{ id: 'first' }, { id: 'second' }] } }) as OpenProject;
afterEach(() => localStorage.clear());
it('remembers each project separately and falls back when its interview was deleted', () => {
  rememberInterview('a', 'second');
  expect(restoredInterview(project('a'))).toBe('second');
  expect(restoredInterview(project('b'))).toBe('first');
  rememberInterview('a', 'deleted');
  expect(restoredInterview(project('a'))).toBe('first');
  expect(restoredInterview({ data: { id: 'empty', interviews: [] } } as unknown as OpenProject)).toBeNull();
});
it('uses the first interview when restoration is disabled', () => {
  rememberInterview('a', 'second');
  saveBooleanPreference(RESTORE_PROJECT_INTERVIEW, false);
  expect(restoredInterview(project('a'))).toBe('first');
});
it('checks existing startup access without requesting permission', async () => {
  const requestPermission = vi.fn();
  for (const permission of ['prompt', 'denied', 'granted']) {
    const directory = { queryPermission: vi.fn(async () => permission), requestPermission } as unknown as FileSystemDirectoryHandle;
    expect(await canRestoreProject(directory)).toBe(permission === 'granted');
  }
  expect(await canRestoreProject({} as FileSystemDirectoryHandle)).toBe(false);
  expect(requestPermission).not.toHaveBeenCalled();
});
