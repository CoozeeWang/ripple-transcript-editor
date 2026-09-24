// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectWorkspace } from './ProjectWorkspace';
import * as store from '../lib/projectStore';
const state = vi.hoisted(() => ({ release: vi.fn(), picker: vi.fn() }));
vi.mock('../App', () => ({ default: (props: { onReturnToProjects: () => void; onExportProjectFiles?: () => void; interviewTitle?: string }) => <div><span>编辑 {props.interviewTitle}</span><button onClick={props.onExportProjectFiles}>导出本项目其他文件</button><button onClick={props.onReturnToProjects}>返回访谈</button></div> }));
vi.mock('../lib/projectStore', async original => ({ ...await original<typeof store>(), recentProjects: vi.fn(async () => []), rememberProject: vi.fn(async () => {}), forgetRecentProject: vi.fn(async () => {}), permit: vi.fn(async () => {}), openProject: vi.fn(), createProject: vi.fn(), saveProject: vi.fn(), importProjectMaterials: vi.fn(), resolveMedia: vi.fn(async () => ({})), recordingDirectory: vi.fn(async () => ({})), acquireProjectEditor: vi.fn(async () => state.release), addInterview: vi.fn(), findExistingManuscripts: vi.fn(), importExistingManuscript: vi.fn() }));
vi.mock('../localStore', async original => ({ ...await original<typeof import('../localStore')>(), readManifest: vi.fn(async () => null) }));
const project = { directory: { name: '测试.ripple' }, data: { id: 'p', title: '测试项目', description: '', revision: 0, interviews: [{ id: 'i', title: '第一次访谈', recordings: [{ id: 'r', name: '录音.wav', storage: 'copy' }] }] } } as store.OpenProject;
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  state.picker.mockResolvedValue(project.directory);
  Object.assign(window, { showDirectoryPicker: state.picker });
  vi.mocked(store.openProject).mockResolvedValue(project);
});
afterEach(cleanup);
it('opens a project, selects an interview, and releases the editor lock when returning', async () => {
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  fireEvent.click(screen.getByRole('button', { name: /第一次访谈.*音频：1 个/ }));
  expect(screen.getByRole('img', { name: '音频保存在项目内' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '开始转录' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: '打开 音频 录音.wav' }));
  await screen.findByText('编辑 第一次访谈');
  expect(store.acquireProjectEditor).toHaveBeenCalledWith('p');
  fireEvent.click(screen.getByRole('button', { name: '返回访谈' }));
  expect(state.release).toHaveBeenCalledOnce();
  expect(await screen.findByRole('button', { name: '打开 音频 录音.wav' })).toBeTruthy();
});
it('keeps an unsaved project description when returning from settings', async () => {
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  fireEvent.doubleClick(screen.getByRole('button', { name: '项目说明' }));
  fireEvent.change(screen.getByRole('textbox', { name: '项目说明' }), { target: { value: '尚未保存的研究说明' } });
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: '返回访谈' }));
  expect((screen.getByRole('textbox', { name: '项目说明' }) as HTMLTextAreaElement).value).toBe('尚未保存的研究说明');
});

it('returns keyboard focus to settings after the project page remounts', async () => {
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  const opener = screen.getByRole('button', { name: '设置' });
  opener.focus();
  fireEvent.click(opener);
  expect(opener.isConnected).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '返回访谈' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '设置' }));
});

it('removes a recent entry without attempting to open its missing directory', async () => {
  vi.mocked(store.recentProjects).mockResolvedValueOnce([{ id: 'gone', title: '河东河西', directory: project.directory }]).mockResolvedValue([]);
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '最近项目' }));
  const remove = await screen.findByRole('button', { name: '从最近项目移除“河东河西”' });
  fireEvent.click(remove);
  await waitFor(() => expect(screen.queryByText('河东河西')).toBeNull());
  expect(store.forgetRecentProject).toHaveBeenCalledWith('gone');
  expect(store.openProject).not.toHaveBeenCalled();
});

it('opens the organizer before choosing a save location or writing a project', async () => {
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
  expect(screen.queryByText('最近项目')).toBeNull();
  expect(screen.getByRole('heading', { name: '点击填写场次名称' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '完成整理' }).hasAttribute('disabled')).toBe(true);
  expect(store.createProject).not.toHaveBeenCalled();
  expect(state.picker).not.toHaveBeenCalled();
});

it('imports documents from the independent drop zone into the selected interview without audio association', async () => {
  vi.mocked(store.importProjectMaterials).mockResolvedValue(project);
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const zone = await screen.findByRole('button', { name: "选择或拖入独立转录稿，不关联音频" });
  const file = { name: '访谈.txt', text: async () => '一段访谈记录' } as File;
  fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file], items: [] } });
  await waitFor(() => expect(store.importProjectMaterials).toHaveBeenCalledWith(project,
    [expect.objectContaining({ kind: 'manuscript', audioId: '', group: 'i' })], 'copy', 'i'));
});

it('adds a session in the existing board while preserving earlier sessions and a single project heading', async () => {
  vi.mocked(store.saveProject).mockImplementation(async (existing, data) => ({ ...existing, data: { ...data, revision: data.revision + 1 } }));
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  fireEvent.click(screen.getByRole('button', { name: '新增场次' }));
  expect(screen.getAllByRole('heading', { name: '测试项目' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: /第一次访谈.*音频：1 个/ })).toBeTruthy();
  fireEvent.click(screen.getByText('点击填写场次名称'));
  fireEvent.change(screen.getByRole('textbox', { name: '场次名称' }), { target: { value: '第二次访谈' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '场次名称' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await screen.findByRole('heading', { name: '第二次访谈' });
  expect(screen.getByRole('button', { name: /第一次访谈.*音频：1 个/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: "选择或拖入音频，加入这个场次" })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '完成整理' })).toBeNull();
});

it('adds transcripts to a reopened audio card through both dropping and file selection', async () => {
  vi.mocked(store.importProjectMaterials).mockResolvedValue(project);
  const handle = { name: '补充.txt', getFile: async () => ({ name: '补充.txt', text: async () => '补充记录' }) } as FileSystemFileHandle;
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [handle]) });
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const zone = await screen.findByRole('button', { name: '向 录音.wav 添加转录稿' });
  fireEvent.drop(zone, { dataTransfer: { types: ['Files'], items: [], files: [{ name: '补充.txt', text: async () => '补充记录' }] } });
  await waitFor(() => expect(store.importProjectMaterials).toHaveBeenCalledWith(project, [
    expect.objectContaining({ id: 'r', existingRecordingId: 'r', kind: 'audio' }),
    expect.objectContaining({ kind: 'manuscript', audioId: 'r', group: 'i' }),
  ], 'copy', 'i'));
  await waitFor(() => expect(screen.getByRole('button', { name: '向 录音.wav 添加转录稿' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '向 录音.wav 添加转录稿' }));
  await waitFor(() => expect(store.importProjectMaterials).toHaveBeenCalledTimes(2));
  expect(vi.mocked(store.importProjectMaterials).mock.calls[1][1][1].audioId).toBe('r');
});

it('clears the active session highlight while adding and restores it on cancel', async () => {
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const previous = await screen.findByRole('button', { name: /第一次访谈.*音频：1 个/ });
  expect(previous.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '新增场次' }));
  expect(previous.getAttribute('aria-pressed')).toBe('false');
  expect(previous.closest('.setup-session')?.classList.contains('is-selected')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(previous.getAttribute('aria-pressed')).toBe('true');
  expect(previous.closest('.setup-session')?.classList.contains('is-selected')).toBe(true);
});

it('returns home through the brand and confirms discarding an unconfirmed session', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  fireEvent.click(screen.getByRole('button', { name: '新增场次' }));
  fireEvent.click(screen.getByRole('button', { name: '返回欢迎页' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByRole('heading', { name: '点击填写场次名称' })).toBeTruthy();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '返回欢迎页' }));
  expect(screen.queryByRole('button', { name: '打开音频' })).toBeNull();
  expect(screen.queryByRole('button', { name: '设置' })).toBeNull();
  expect(screen.getByRole('combobox', { name: '界面语言' })).toBeTruthy();
  confirm.mockRestore();
});

it('returns from the editor to the same project with the materials export dialog open', async () => {
  render(<ProjectWorkspace/>);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开 音频 录音.wav' }));
  await screen.findByText('编辑 第一次访谈');
  fireEvent.click(screen.getByRole('button', { name: "导出本项目其他文件" }));
  await screen.findByRole('dialog', { name: '导出项目材料' });
  expect(screen.getByRole('button', { name: '导出所选材料' })).toBeTruthy();
  expect(state.release).toHaveBeenCalledOnce();
  expect(screen.getByRole('heading', { name: '测试项目' })).toBeTruthy();
});

it('shows saved project description below the title and closes its editor', async () => {
  vi.mocked(store.saveProject).mockImplementation(async (existing, data) => ({ ...existing, data: { ...data, revision: data.revision + 1 } }));
  render(<ProjectWorkspace/>);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const description = await screen.findByRole('button', { name: '项目说明' });
  expect(description.closest('.project-saved-title')).toBeTruthy();
  fireEvent.doubleClick(description);
  fireEvent.change(screen.getByRole('textbox', { name: '项目说明' }), { target: { value: '关于河流的访谈' } });
  fireEvent.click(screen.getByRole('button', { name: '保存说明' }));
  await screen.findByText('关于河流的访谈');
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '项目说明' })).toBeNull());
  expect(store.saveProject).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ description: '关于河流的访谈' }));
});
it('shows a new person immediately without inserting progress or remounting the field', async () => {
  let finish!: (p: store.OpenProject) => void;
  vi.mocked(store.saveProject).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<ProjectWorkspace/>);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const input = await screen.findByRole('textbox', { name: "参与者（选填）" });
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  input.focus();
  fireEvent.change(input, { target: { value: '张三' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('button', { name: '参与者 张三' })).toBeTruthy();
  expect(input.closest('main')?.classList.contains('project-home--quiet-saving')).toBe(true);
  expect(screen.queryByText('正在处理，请稍候…')).toBeNull();
  const savedData = vi.mocked(store.saveProject).mock.calls.at(-1)![1];
  finish({ ...project, data: { ...savedData, revision: 1 } });
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  expect(screen.getByRole('textbox', { name: "参与者（选填）" })).toBe(input);
  expect(document.activeElement).toBe(input);
});
it('rolls back optimistic metadata when saving fails', async () => {
  vi.mocked(store.saveProject).mockRejectedValue(new Error('无法保存项目'));
  render(<ProjectWorkspace/>);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const input = await screen.findByRole('textbox', { name: "参与者（选填）" });
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(input, { target: { value: '张三' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText('无法保存项目');
  expect(screen.queryByRole('button', { name: '参与者 张三' })).toBeNull();
});

it('saves a description quietly and retains its editor while writing', async () => {
  let finish!: (p: store.OpenProject) => void;
  vi.mocked(store.saveProject).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<ProjectWorkspace/>);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const description = await screen.findByRole('button', { name: '项目说明' });
  await waitFor(() => expect((description as HTMLButtonElement).disabled).toBe(false));
  fireEvent.doubleClick(description);
  const input = screen.getByRole('textbox', { name: '项目说明' });
  fireEvent.change(input, { target: { value: '场次说明' } });
  fireEvent.click(screen.getByRole('button', { name: '保存说明' }));
  expect(screen.queryByText('正在处理，请稍候…')).toBeNull();
  expect(screen.getByRole('textbox', { name: '项目说明' })).toBe(input);
  const data = vi.mocked(store.saveProject).mock.calls.at(-1)![1];
  finish({ ...project, data: { ...data, revision: 1 } });
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '项目说明' })).toBeNull());
  expect(screen.getByRole('button', { name: '项目说明' }).textContent).toBe('场次说明');
});

it('restores the last project on startup only when existing access is granted', async () => {
  localStorage.setItem('ripple-open-last-project', '1');
  const queryPermission = vi.fn(async () => 'granted');
  const directory = { name: '测试.ripple', queryPermission } as unknown as FileSystemDirectoryHandle;
  vi.mocked(store.recentProjects).mockResolvedValueOnce([{ id: 'p', title: '测试项目', directory }]);
  render(<ProjectWorkspace />);
  await screen.findByText('测试项目');
  expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  expect(state.picker).not.toHaveBeenCalled();
  localStorage.clear();
});
it('keeps the welcome page when startup access needs permission', async () => {
  localStorage.setItem('ripple-open-last-project', '1');
  const directory = { name: '测试.ripple', queryPermission: vi.fn(async () => 'prompt') } as unknown as FileSystemDirectoryHandle;
  vi.mocked(store.recentProjects).mockResolvedValueOnce([{ id: 'p', title: '测试项目', directory }]);
  render(<ProjectWorkspace />);
  const message = await screen.findByText('请从最近项目中打开上次项目，以重新授权访问。');
  const notice = message.closest('[role="alert"]')!;
  const actions = screen.getByRole('button', { name: '打开项目' }).closest('.project-welcome__actions')!;
  expect(actions.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(notice.classList.contains('project-error-notice')).toBe(true);
  expect(notice.querySelector('strong')).toBeNull();
  expect(store.openProject).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '打开项目' })).toBeTruthy();
  localStorage.clear();
});

it('lets first-time users select English from welcome without opening or writing a project', async () => {
  const { setInterfaceLanguage } = await import('../i18n');
  render(<ProjectWorkspace />);
  try {
    fireEvent.change(screen.getByRole('combobox', {name:'界面语言'}), {target:{value:'en'}});
    expect(await screen.findByRole('button',{name:'New project'})).toBeTruthy();
    expect(store.openProject).not.toHaveBeenCalled();
    expect(store.createProject).not.toHaveBeenCalled();
  } finally { cleanup(); await setInterfaceLanguage('zh-CN'); }
});
