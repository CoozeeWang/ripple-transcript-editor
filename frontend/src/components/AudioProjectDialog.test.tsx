// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioProjectDialog } from './AudioProjectDialog';
import * as store from '../lib/projectStore';
vi.mock('../lib/projectStore', async original => ({ ...await original<typeof store>(), createProject: vi.fn(), openProject: vi.fn(), permit: vi.fn(), handleValue: vi.fn(async () => undefined), importProjectMaterials: vi.fn() }));
const file = { name: '访谈.m4a' } as FileSystemFileHandle;
const directory = { name: '工作' } as FileSystemDirectoryHandle;
const project = { directory, data: { kind: 'ripple-project', schemaVersion: 1, id: 'p', title: '项目', description: '', revision: 0, interviews: [{ id: 'i', title: '第一场', recordings: [] }] } } as store.OpenProject;
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  Object.assign(window, { showDirectoryPicker: vi.fn(async () => directory) });
  vi.mocked(store.openProject).mockResolvedValue(project);
  vi.mocked(store.createProject).mockResolvedValue(project);
  vi.mocked(store.importProjectMaterials).mockImplementation(async (p, _materials, _storage, _id, sessions) => ({ ...p, data: { ...p.data, interviews: sessions!.map(s => ({ ...s, recordings: [{ id: 'r', name: file.name, file: 'r.m4a', storage: 'copy', fingerprint: '' }] })) } }));
});
afterEach(cleanup);
it('joins an existing session and opens the imported audio', async () => {
  const done = vi.fn(async () => {});
  render(<AudioProjectDialog file={file} onCancel={vi.fn()} onDone={done}/>);
  fireEvent.click(screen.getByLabelText('加入已有项目'));
  fireEvent.click(screen.getByRole('button', { name: '选择项目' }));
  await screen.findByRole('option', { name: '第一场' });
  fireEvent.change(screen.getByLabelText('访谈场次'), { target: { value: 'i' } });
  fireEvent.click(screen.getByRole('button', { name: '加入并打开' }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(expect.anything(), 'i', expect.objectContaining({ id: 'r' })));
  expect(store.createProject).not.toHaveBeenCalled();
});
it('creates a named project and session and does not reimport if opening fails', async () => {
  const done = vi.fn().mockRejectedValueOnce(new Error('暂时无法打开')).mockResolvedValue(undefined);
  render(<AudioProjectDialog file={file} onCancel={vi.fn()} onDone={done}/>);
  fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '新项目' } });
  fireEvent.change(screen.getByLabelText('场次名称'), { target: { value: '新场次' } });
  fireEvent.click(screen.getByRole('button', { name: '选择保存位置' }));
  await screen.findByText('工作');
  fireEvent.click(screen.getByRole('button', { name: '加入并打开' }));
  await screen.findByText('暂时无法打开');
  fireEvent.click(screen.getByRole('button', { name: '进入编辑页面' }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
  expect(store.createProject).toHaveBeenCalledWith(directory, '新项目');
  expect(store.importProjectMaterials).toHaveBeenCalledOnce();
});

it('requires an explicit folder selection even when a previous save location exists', async () => {
  vi.mocked(store.handleValue).mockResolvedValue(directory);
  const done = vi.fn(async () => {});
  render(<AudioProjectDialog file={file} onCancel={vi.fn()} onDone={done}/>);
  expect(screen.queryByText('工作')).toBeNull();
  fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '新项目' } });
  fireEvent.change(screen.getByLabelText('场次名称'), { target: { value: '新访谈' } });
  expect((screen.getByRole('button', { name: '加入并打开' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '选择保存位置' }));
  await screen.findByText('工作');
  fireEvent.click(screen.getByRole('button', { name: '加入并打开' }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(store.permit).toHaveBeenCalledWith(directory, 'readwrite');
  expect(store.createProject).toHaveBeenCalledWith(directory, '新项目');
  expect(store.handleValue).toHaveBeenCalledWith('last-project-parent', directory);
  expect((window as unknown as { showDirectoryPicker: ReturnType<typeof vi.fn> }).showDirectoryPicker).toHaveBeenCalledOnce();
});
