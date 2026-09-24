// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MaterialImport } from './MaterialImport';
import { prepareMaterials } from '../lib/materialImport';
import { importProjectMaterials, type OpenProject } from '../lib/projectStore';
vi.mock('../lib/materialImport', () => ({ prepareMaterials: vi.fn(), collectMaterialFiles: vi.fn() }));
vi.mock('../lib/projectStore', () => ({ importProjectMaterials: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const project = { data: { id: 'p', interviews: [] } } as unknown as OpenProject;
it('lets users group and associate selected materials before writing anything, preserving selections after failure', async () => {
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => []) });
  vi.mocked(prepareMaterials).mockResolvedValue([
    { id: 'a', kind: 'audio', name: '音频.m4a', group: '访谈甲', audioId: '', handle: { getFile: async () => { throw new Error('unavailable'); } } as unknown as FileSystemFileHandle },
    { id: 'd', kind: 'manuscript', name: '稿件.txt', group: '稿件', audioId: '', handle: { getFile: async () => { throw new Error('unavailable'); } } as unknown as FileSystemFileHandle, transcript: { timeAligned: false, audio: { filename: '', duration: 0 }, speakers: [], segments: [] } },
  ]);
  // Picker must supply at least one file, even though parser is mocked here.
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [{}]) });
  vi.mocked(importProjectMaterials).mockRejectedValue(new Error('保存失败'));
  const done = vi.fn();
  render(<MaterialImport project={project} onDone={done} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
  await screen.findByText('确认材料与访谈');
  expect(importProjectMaterials).not.toHaveBeenCalled();
  expect((screen.getByRole('combobox', { name: '音频.m4a 访谈场次' }) as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByRole('combobox', { name: '音频.m4a 访谈场次' }), { target: { value: '访谈甲' } });
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [(await vi.mocked(prepareMaterials).mock.results[0].value)[1].handle]) });
  fireEvent.click(screen.getByRole('button', { name: '关联转录稿' }));
  await waitFor(() => expect(screen.queryByRole('combobox', { name: '稿件.txt 访谈场次' })).toBeNull());
  expect(screen.queryByRole('combobox', { name: '稿件.txt 访谈场次' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '解除关联' }));
  expect(screen.getByRole('combobox', { name: '稿件.txt 访谈场次' })).toBeTruthy();
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [(await vi.mocked(prepareMaterials).mock.results[0].value)[1].handle]) });
  fireEvent.click(screen.getByRole('button', { name: '关联转录稿' }));
  await waitFor(() => expect(screen.queryByRole('combobox', { name: '稿件.txt 访谈场次' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '导入 1 次访谈' }));
  await screen.findByRole('alert');
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '解除关联' })).toBeTruthy();
  vi.mocked(importProjectMaterials).mockResolvedValue(project);
  fireEvent.click(screen.getByRole('button', { name: '导入 1 次访谈' }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(project));
});

it('shows transcript preview in a separate read-only dialog and restores the list when closed', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [{}]) });
  vi.mocked(prepareMaterials).mockResolvedValue([{ id: 'd', kind: 'manuscript', name: '访谈.txt', group: '文件夹名', audioId: '', handle: {} as FileSystemFileHandle, transcript: { timeAligned: false, audio: { filename: '', duration: 0 }, speakers: [], segments: [{ id: 's1', speaker_id: 's', start: 0, end: 0, text: '仅在预览中展示正文' }] } }]);
  render(<MaterialImport project={project} onDone={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
  await screen.findByRole('button', { name: '预览转录稿' });
  expect(screen.queryByText('仅在预览中展示正文')).toBeNull();
  expect((screen.getByRole('combobox', { name: '访谈.txt 访谈场次' }) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '预览转录稿' }));
  expect(screen.getByRole('dialog').textContent).toContain('仅在预览中展示正文');
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: '忽略材料 访谈.txt' }).getAttribute('title')).toContain('原文件不受影响');
});

it('selects multiple transcripts directly from disk for one audio and ignores only the audio when requested', async () => {
  const handle = (name: string) => ({ name, getFile: async () => { throw new Error('preview unavailable'); } }) as unknown as FileSystemFileHandle;
  const audio = { id: 'a', kind: 'audio' as const, name: '录音.wav', group: '', audioId: '', handle: handle('录音.wav') };
  const docs = ['人工.txt','机器.txt'].map((name, i) => ({ id: `d${i}`, kind: 'manuscript' as const, name, group: '', audioId: '', handle: handle(name) }));
  Object.assign(window, { showOpenFilePicker: vi.fn().mockResolvedValueOnce([audio.handle]).mockResolvedValueOnce(docs.map(d => d.handle)) });
  vi.mocked(prepareMaterials).mockResolvedValueOnce([audio]).mockResolvedValueOnce([docs[0]]).mockResolvedValueOnce([docs[1]]);
  render(<MaterialImport project={project} onDone={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
  await screen.findByRole('button', { name: '关联转录稿' });
  fireEvent.change(screen.getByRole('combobox', { name: '录音.wav 访谈场次' }), { target: { value: '第一场' } });
  fireEvent.click(screen.getByRole('button', { name: '关联转录稿' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '解除关联' })).toHaveLength(2));
  expect(screen.queryByRole('combobox', { name: /关联转录稿/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '忽略材料 录音.wav' }));
  expect(screen.getByRole('combobox', { name: '人工.txt 访谈场次' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: '机器.txt 访谈场次' })).toBeTruthy();
});
