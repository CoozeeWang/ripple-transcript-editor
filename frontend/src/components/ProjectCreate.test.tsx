// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectCreate } from './ProjectCreate';
import { msg, setInterfaceLanguage } from '../i18n';
import { chooseDirectory } from '../lib/projectPreferences';
import { createProject, permit, type OpenProject } from '../lib/projectStore';
vi.mock('../lib/projectPreferences', () => ({ chooseDirectory: vi.fn() }));
vi.mock('../lib/projectStore', () => ({ createProject: vi.fn(), permit: vi.fn() }));
const parent = { name: 'Synthetic parent' } as FileSystemDirectoryHandle;
const saved = { directory: { name: 'Synthetic.ripple' }, data: { title: 'Synthetic', interviews: [] } } as unknown as OpenProject;
beforeEach(() => {
  vi.mocked(chooseDirectory).mockReset().mockResolvedValue(parent);
  vi.mocked(permit).mockReset().mockResolvedValue(undefined);
  vi.mocked(createProject).mockReset().mockResolvedValue(saved);
});
afterEach(async () => { cleanup(); await setInterfaceLanguage('zh-CN'); });
function setup() {
  const done = vi.fn(), cancel = vi.fn(), busy = vi.fn();
  const view = render(<ProjectCreate onDone={done} onCancel={cancel} onBusyChange={busy} />);
  const name = screen.getByRole('textbox', { name: msg('ProjectCreate.name') }) as HTMLInputElement;
  const submit = () => fireEvent.submit(view.container.querySelector('form')!);
  return { done, cancel, busy, name, submit };
}
it('focuses the name, blocks blank submission and permits cancellation without writing', () => {
  const { name, submit, cancel } = setup();
  expect(document.activeElement).toBe(name);
  expect(screen.getByRole('button', { name: msg('ProjectCreate.save') }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(name, { target: { value: '   ' } }); submit();
  fireEvent.click(screen.getByRole('button', { name: msg('ProjectCreate.cancel') }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(chooseDirectory).not.toHaveBeenCalled(); expect(createProject).not.toHaveBeenCalled();
});
it.each(['../Synthetic', 'Synthetic\\child', '.', '..'])('rejects a path-like name %s before choosing a location', async value => {
  const { name, submit, done } = setup();
  fireEvent.change(name, { target: { value } }); submit();
  expect(screen.getByRole('alert').textContent).toContain(msg('projectStore.m1397'));
  expect(chooseDirectory).not.toHaveBeenCalled(); expect(createProject).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: 'Synthetic' } }); submit();
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
});
it('does not publish a project until permission and the verified create write have completed', async () => {
  let resolve!: (project: OpenProject) => void;
  vi.mocked(createProject).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const { name, submit, done, busy } = setup();
  fireEvent.change(name, { target: { value: ' Synthetic ' } }); submit(); submit();
  await waitFor(() => expect(createProject).toHaveBeenCalledOnce());
  expect(chooseDirectory).toHaveBeenCalledWith('save-project');
  expect(permit).toHaveBeenCalledWith(parent, 'readwrite');
  expect(createProject).toHaveBeenCalledWith(parent, 'Synthetic');
  expect(vi.mocked(permit).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createProject).mock.invocationCallOrder[0]);
  expect(done).not.toHaveBeenCalled(); expect(name.disabled).toBe(true);
  expect(screen.getByRole('button', { name: msg('ProjectCreate.cancel') }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: msg('ProjectCreate.saving') }).hasAttribute('disabled')).toBe(true);
  await act(async () => { resolve(saved); });
  expect(done).toHaveBeenCalledExactlyOnceWith(saved); expect(busy.mock.calls).toEqual([[true], [false]]);
});
it('keeps the typed name when the directory chooser is cancelled and can retry', async () => {
  vi.mocked(chooseDirectory).mockRejectedValueOnce(new DOMException('Synthetic cancel', 'AbortError'));
  const { name, submit, done } = setup();
  fireEvent.change(name, { target: { value: 'Synthetic' } }); submit();
  await waitFor(() => expect(name.disabled).toBe(false));
  expect(name.value).toBe('Synthetic'); expect(screen.queryByRole('alert')).toBeNull();
  expect(createProject).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
  submit(); await waitFor(() => expect(done).toHaveBeenCalledOnce());
});
it.each(['permission', 'write', 'collision', 'name'])('retains the name and stays in creation after %s failure', async failure => {
  if (failure === 'permission') vi.mocked(permit).mockRejectedValueOnce(new DOMException('Synthetic denied', 'NotAllowedError'));
  else vi.mocked(createProject).mockRejectedValueOnce(new Error(failure === 'collision' ? msg('projectStore.m1398') : failure === 'name' ? msg('projectStore.m1397') : 'Synthetic I/O failure'));
  const { name, submit, done } = setup();
  fireEvent.change(name, { target: { value: 'Synthetic' } }); submit();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(msg(failure === 'collision' ? 'projectStore.m1398' : failure === 'name' ? 'projectStore.m1397' : 'ProjectCreate.saveFailed'));
  expect(name.value).toBe('Synthetic'); expect(name.disabled).toBe(false); expect(done).not.toHaveBeenCalled();
  if (failure === 'permission') expect(createProject).not.toHaveBeenCalled();
  await act(() => setInterfaceLanguage('en'));
  expect(alert.textContent).toContain(msg(failure === 'collision' ? 'projectStore.m1398' : failure === 'name' ? 'projectStore.m1397' : 'ProjectCreate.saveFailed'));
  fireEvent.click(screen.getByRole('button', { name: msg('notice.dismiss') }));
  expect(screen.queryByRole('alert')).toBeNull(); submit();
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
});
it('does not submit during IME composition, then accepts the completed name', async () => {
  const { name, submit, done } = setup();
  fireEvent.compositionStart(name); fireEvent.change(name, { target: { value: 'Synthetic' } }); submit();
  expect(chooseDirectory).not.toHaveBeenCalled();
  fireEvent.compositionEnd(name); submit(); await waitFor(() => expect(done).toHaveBeenCalledOnce());
});
it('protects the name on window close and removes the guard on unmount', () => {
  const { name } = setup();
  fireEvent.change(name, { target: { value: 'Synthetic' } });
  const before = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true); cleanup();
  const after = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
