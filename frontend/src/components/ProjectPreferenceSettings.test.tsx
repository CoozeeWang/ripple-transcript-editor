// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectPreferenceSettings } from './ProjectPreferenceSettings';
import { defaultProjectLocation, FIXED_PROJECT_LOCATION } from '../lib/projectPreferences';
import { loadBooleanPreference } from '../lib/preferences';
const handles = vi.hoisted(() => new Map());
vi.mock('../lib/projectStore', () => ({ handleValue: vi.fn(async (key, value) => {
  if (value !== undefined) handles.set(key, value);
  return handles.get(key);
}) }));
afterEach(() => { cleanup(); localStorage.clear(); handles.clear(); vi.restoreAllMocks(); });
it('keeps the fixed default separate from the most recently used parent across reopen', async () => {
  const last = { name: '最近位置' };
  const fixed = { name: '默认位置' };
  handles.set('last-project-parent', last);
  Object.assign(window, { showDirectoryPicker: vi.fn(async () => fixed) });
  const ui = render(<ProjectPreferenceSettings />);
  expect(screen.queryByText('最近位置')).toBeNull();
  fireEvent.click(screen.getByLabelText('指定文件夹'));
  fireEvent.click(await screen.findByRole('button', { name: '选择…' }));
  await screen.findByText('默认位置');
  expect(loadBooleanPreference(FIXED_PROJECT_LOCATION, false)).toBe(true);
  expect(await defaultProjectLocation()).toBe(fixed);
  ui.unmount();
  render(<ProjectPreferenceSettings />);
  await screen.findByText('默认位置');
  fireEvent.click(screen.getByLabelText('上次使用的位置'));
  expect(screen.queryByText('最近位置')).toBeNull();
  expect(await defaultProjectLocation()).toBe(last);
});
it('keeps the current default when the folder picker is cancelled', async () => {
  localStorage.setItem(FIXED_PROJECT_LOCATION, '1');
  handles.set('preferred-project-parent', { name: '原位置' });
  Object.assign(window, { showDirectoryPicker: vi.fn(async () => { throw new DOMException('cancel', 'AbortError'); }) });
  render(<ProjectPreferenceSettings />);
  await screen.findByText('原位置');
  fireEvent.click(screen.getByRole('button', { name: '选择…' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '选择…' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText('原位置')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
