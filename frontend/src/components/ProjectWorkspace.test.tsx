// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConnectorContext } from '../hooks/connectorContext';
import { ProjectWorkspace } from './ProjectWorkspace';
import * as store from '../lib/projectStore';
import { msg, setInterfaceLanguage } from '../i18n';
const state = vi.hoisted(() => ({ release: vi.fn(), picker: vi.fn() }));
vi.mock('../App', () => ({ default: (props: { onReturnToProjects: () => void; onOpenProject?: (id?:string) => Promise<void>; onExportProjectFiles?: () => void; onAudioDuration?: (seconds:number) => Promise<void>; interviewTitle?: string }) => <div><span>编辑 {props.interviewTitle}</span><button onClick={()=>void props.onAudioDuration?.(3924).catch(()=>{})}>Synthetic accepted duration</button><button onClick={props.onExportProjectFiles}>导出本项目其他文件</button><button onClick={() => void props.onOpenProject?.().catch(() => {})}>从菜单打开项目</button><button onClick={() => void props.onOpenProject?.('synthetic-other').catch(() => {})}>从菜单打开最近项目</button><button onClick={props.onReturnToProjects}>返回访谈</button></div> }));
vi.mock('../lib/projectStore', async original => ({ ...await original<typeof store>(), recentProjects: vi.fn(async () => []), rememberProject: vi.fn(async () => {}), forgetRecentProject: vi.fn(async () => {}), permit: vi.fn(async () => {}), openProject: vi.fn(), createProject: vi.fn(), saveProject: vi.fn(), saveRecordingDuration: vi.fn(), moveProjectRecordings: vi.fn(), importProjectMaterials: vi.fn(), resolveMedia: vi.fn(async () => ({})), recordingDirectory: vi.fn(async () => ({})), acquireProjectEditor: vi.fn(async () => state.release), trashProjectInterview: vi.fn(), restoreProjectTrashItem: vi.fn(), addInterview: vi.fn(), findExistingManuscripts: vi.fn(), importExistingManuscript: vi.fn() }));
vi.mock('../localStore', async original => ({ ...await original<typeof import('../localStore')>(), readManifest: vi.fn(async () => null) }));
const project = { directory: { name: '测试.ripple' }, data: { id: 'p', title: '测试项目', description: '', revision: 0, interviews: [{ id: 'i', title: '第一次访谈', recordings: [{ id: 'r', name: '录音.wav', storage: 'copy' }] }] } } as store.OpenProject;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.trashProjectInterview).mockReset();
  vi.mocked(store.restoreProjectTrashItem).mockReset();
  vi.mocked(store.recentProjects).mockReset().mockResolvedValue([]);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  state.picker.mockReset().mockResolvedValue(project.directory);
  Object.assign(window, { showDirectoryPicker: state.picker });
  vi.mocked(store.openProject).mockReset().mockResolvedValue(project);
});
afterEach(() => { cleanup(); delete (window as Window & { __TAURI__?: unknown }).__TAURI__; });
afterEach(async () => { await setInterfaceLanguage('zh-CN'); });
it('opens a project, selects an interview, and releases the editor lock when returning', async () => {
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  expect(screen.getByRole('complementary', { name: '场次' }).querySelector('.panel-heading__count')?.textContent).toBe('1');
  expect(screen.queryByText('1 个场次')).toBeNull();
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
it('uses the native menu event from welcome and retains welcome when the picker is cancelled', async () => {
  state.picker.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
  render(<ProjectWorkspace />);
  fireEvent(window, new Event('ripple-open-project'));
  await waitFor(() => expect(state.picker).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: '打开项目' })).toBeTruthy();
  expect(store.openProject).not.toHaveBeenCalled();
  fireEvent(window, new Event('ripple-open-project'));
  expect(await screen.findByText('测试项目')).toBeTruthy();
});
it('opens an authorized recent project from the native menu without a picker', async () => {
  vi.mocked(store.recentProjects).mockResolvedValue([{id:'p',title:'测试项目',directory:project.directory}]);
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', {name:'最近项目'}));
  await screen.findByRole('button', {name:'测试项目'});
  await act(async () => { window.dispatchEvent(new CustomEvent('ripple-open-recent-project', {detail:'p'})); });
  expect(await screen.findByText('测试项目')).toBeTruthy();
  expect(state.picker).not.toHaveBeenCalled();
  expect(store.openProject).toHaveBeenCalledWith(project.directory);
});
it('keeps a project description draft when the native menu requests another project', async () => {
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  fireEvent.doubleClick(screen.getByRole('button', { name: '项目说明' }));
  fireEvent.change(screen.getByRole('textbox', { name: '项目说明' }), { target: { value: 'Synthetic unsaved note' } });
  fireEvent(window, new Event('ripple-open-project'));
  expect(screen.getByRole('alert').textContent).toContain('请先保存或取消编辑');
  expect(state.picker).toHaveBeenCalledOnce();
  expect((screen.getByRole('textbox', { name: '项目说明' }) as HTMLTextAreaElement).value).toBe('Synthetic unsaved note');
});
it('keeps an AI task running instead of switching projects from the native menu', async () => {
  const activity = { state: 'processing', inFlight: 1, target: { project_id: 'p' } };
  const connector = { activities: [] as typeof activity[] };
  render(<ConnectorContext.Provider value={{ state: connector } as never}><ProjectWorkspace /></ConnectorContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  connector.activities.push(activity);
  fireEvent(window, new Event('ripple-open-project'));
  expect(screen.getByRole('alert').textContent).toContain('AI 编辑任务');
  expect(state.picker).toHaveBeenCalledOnce();
  expect(store.openProject).toHaveBeenCalledOnce();
});
it('does not leave the editor until the selected project opens successfully', async () => {
  const next = { ...project, directory: { name: 'Other.ripple' }, data: { ...project.data, id: 'other', title: 'Other synthetic project' } } as store.OpenProject;
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText('测试项目');
  fireEvent.click(await screen.findByRole('button', { name: '打开 音频 录音.wav' }));
  await screen.findByText('编辑 第一次访谈');
  state.picker.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
  fireEvent.click(screen.getByRole('button', { name: '从菜单打开项目' }));
  await waitFor(() => expect(state.picker).toHaveBeenCalledTimes(2));
  expect(screen.getByText('编辑 第一次访谈')).toBeTruthy();
  expect(state.release).not.toHaveBeenCalled();
  vi.mocked(store.openProject).mockRejectedValueOnce(new Error('Invalid synthetic project'));
  fireEvent.click(screen.getByRole('button', { name: '从菜单打开项目' }));
  await waitFor(() => expect(store.openProject).toHaveBeenCalledTimes(2));
  expect(screen.getByText('编辑 第一次访谈')).toBeTruthy();
  expect(state.release).not.toHaveBeenCalled();
  vi.mocked(store.openProject).mockResolvedValueOnce(next);
  fireEvent.click(screen.getByRole('button', { name: '从菜单打开项目' }));
  expect(await screen.findByText('Other synthetic project')).toBeTruthy();
  expect(state.release).toHaveBeenCalledOnce();
});
it('switches from the editor to an authorized recent project without a picker', async () => {
  const other = { ...project, directory: {name:'Other.ripple'}, data:{...project.data,id:'synthetic-other',title:'Other synthetic project'} } as store.OpenProject;
  vi.mocked(store.recentProjects).mockResolvedValue([{id:'synthetic-other',title:other.data.title,directory:other.directory}]);
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', {name:'打开项目'}));
  await screen.findByText('测试项目');
  fireEvent.click(await screen.findByRole('button', {name:'打开 音频 录音.wav'}));
  await screen.findByText('编辑 第一次访谈');
  vi.mocked(store.openProject).mockResolvedValueOnce(other);
  fireEvent.click(screen.getByRole('button', {name:'从菜单打开最近项目'}));
  expect(await screen.findByText('Other synthetic project')).toBeTruthy();
  expect(state.picker).toHaveBeenCalledOnce();
  expect(state.release).toHaveBeenCalledOnce();
});
it('shows recovery instead of opening a stale recent project from the editor', async () => {
  const stale = {name:'Missing.ripple',queryPermission:vi.fn(async()=> 'prompt')} as unknown as FileSystemDirectoryHandle;
  vi.mocked(store.recentProjects).mockResolvedValue([{id:'synthetic-other',title:'Missing synthetic project',directory:stale}]);
  Object.assign(window, {__TAURI__:{core:{}}});
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', {name:'打开项目'}));
  await screen.findByText('测试项目');
  fireEvent.click(await screen.findByRole('button', {name:'打开 音频 录音.wav'}));
  await screen.findByText('编辑 第一次访谈');
  fireEvent.click(screen.getByRole('button', {name:'从菜单打开最近项目'}));
  expect(await screen.findByRole('button', {name:'重新选择原项目'})).toBeTruthy();
  expect(state.picker).toHaveBeenCalledOnce();
  expect(store.openProject).toHaveBeenCalledOnce();
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
  vi.mocked(store.recentProjects).mockResolvedValueOnce([{ id: 'gone', title: '示例项目', directory: project.directory }]).mockResolvedValue([]);
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '最近项目' }));
  const remove = await screen.findByRole('button', { name: '从最近项目移除“示例项目”' });
  fireEvent.click(remove);
  await waitFor(() => expect(screen.queryByText('示例项目')).toBeNull());
  expect(store.forgetRecentProject).toHaveBeenCalledWith('gone');
  expect(store.openProject).not.toHaveBeenCalled();
});

it('offers explicit recovery only when a recent desktop project loses access', async () => {
  const queryPermission = vi.fn(async () => 'prompt');
  const stale = { name: '测试.ripple', queryPermission } as unknown as FileSystemDirectoryHandle;
  const selected = { name: '测试.ripple' } as FileSystemDirectoryHandle;
  const reopened = { ...project, directory: selected };
  Object.assign(window, { __TAURI__: { core: {} } });
  vi.mocked(store.recentProjects).mockResolvedValueOnce([{ id: 'p', title: '测试项目', directory: stale }]).mockResolvedValue([]);
  state.picker.mockResolvedValue(selected);
  vi.mocked(store.openProject).mockResolvedValue(reopened);
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '最近项目' }));
  fireEvent.click(await screen.findByRole('button', { name: '测试项目' }));
  expect(state.picker).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', {name:'重新选择原项目'}));
  await screen.findByRole('heading', { name: '测试项目' });
  expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  expect(state.picker).toHaveBeenCalledOnce();
  expect(store.permit).toHaveBeenCalledWith(selected, 'readwrite');
  expect(store.permit).not.toHaveBeenCalledWith(stale, 'readwrite');
  expect(store.rememberProject).toHaveBeenCalledWith(reopened);
});

it('does not replace a recent entry with a different project', async () => {
  const stale = { name: '测试.ripple', queryPermission: vi.fn(async () => 'prompt') } as unknown as FileSystemDirectoryHandle;
  Object.assign(window, { __TAURI__: { core: {} } });
  vi.mocked(store.recentProjects).mockResolvedValueOnce([{ id: 'p', title: '测试项目', directory: stale }]);
  vi.mocked(store.openProject).mockResolvedValue({ ...project, data: { ...project.data, id: 'other' } });
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '最近项目' }));
  fireEvent.click(await screen.findByRole('button', { name: '测试项目' }));
  fireEvent.click(await screen.findByRole('button', {name:'重新选择原项目'}));
  await screen.findByText('所选文件夹与这个最近项目不匹配。请重新选择原项目文件夹。');
  expect(store.rememberProject).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: '测试项目' })).toBeNull();
});

it('opens the organizer before choosing a save location or writing a project', async () => {
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
  expect(screen.queryByText('最近项目')).toBeNull();
  expect(screen.getByRole('heading', { name: '点击填写场次名称' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '保存项目' }).hasAttribute('disabled')).toBe(true);
  expect(store.createProject).not.toHaveBeenCalled();
  expect(state.picker).not.toHaveBeenCalled();
});

it('clears a failed open-project error when starting a new project', async () => {
  const openError = '这个文件夹不是 Ripple 项目';
  state.picker.mockRejectedValueOnce(new Error(openError));
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  await screen.findByText(openError);
  fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
  await screen.findByRole('heading', { name: '点击填写场次名称' });
  expect(screen.queryByText(openError)).toBeNull();
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
  await screen.findByText(`访谈.txt：${msg('materialImport.m1379')}`);
  await act(() => setInterfaceLanguage('en'));
  expect(screen.getByText(`访谈.txt: ${msg('materialImport.m1379')}`)).toBeTruthy();
  expect(store.importProjectMaterials).toHaveBeenCalledOnce();
});

it('keeps copy and verification visible, blocks another import, and reports success', async () => {
  let finishCopy!: () => void;
  let finishVerification!: () => void;
  let finishSave!: () => void;
  vi.mocked(store.importProjectMaterials).mockImplementation(async (_project, _materials, _storage, _id, _sessions, onStage) => {
    onStage?.('copying');
    await new Promise<void>(resolve => { finishCopy = resolve; });
    onStage?.('verifying');
    await new Promise<void>(resolve => { finishVerification = resolve; });
    onStage?.('saving');
    await new Promise<void>(resolve => { finishSave = resolve; });
    return project;
  });
  const file = new File(['synthetic audio'], 'sample.wav');
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [{ name: file.name, kind: 'file', getFile: async () => file }]) });
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const add = await screen.findByRole('button', { name: '选择或拖入音频，加入这个场次' });
  fireEvent.click(add);
  fireEvent.click(await screen.findByRole('button', { name: '加入音频' }));
  await screen.findByText('正在复制音频到项目…');
  expect((add as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(add);
  expect(store.importProjectMaterials).toHaveBeenCalledOnce();
  await act(async () => finishCopy());
  expect(screen.getByText('正在校验音频副本…')).toBeTruthy();
  await act(async () => finishVerification());
  expect(screen.getByText('正在保存项目…')).toBeTruthy();
  await act(async () => finishSave());
  expect(await screen.findByText('音频已加入项目。')).toBeTruthy();
  expect(screen.getByText('音频已加入项目。').closest('.processing-notice--dismissible')).toBeTruthy();
  expect(screen.queryByText('正在保存项目…')).toBeNull();
  await act(() => setInterfaceLanguage('en'));
  expect(screen.getByText('Audio added to the project.')).toBeTruthy();
  expect(screen.queryByText('音频已加入项目。')).toBeNull();
});

it('cancels a copy without a success notice and allows the same audio to be retried', async () => {
  let signal!: AbortSignal;
  vi.mocked(store.importProjectMaterials).mockImplementationOnce(async (_project, _materials, _storage, _id, _sessions, onStage, cancelSignal) => {
    signal = cancelSignal!;
    onStage?.('copying');
    return new Promise<store.OpenProject>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))));
  });
  const file = new File(['synthetic audio'], 'sample.wav');
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [{ name: file.name, kind: 'file', getFile: async () => file }]) });
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const add = await screen.findByRole('button', { name: '选择或拖入音频，加入这个场次' });
  fireEvent.click(add);
  fireEvent.click(await screen.findByRole('button', { name: '加入音频' }));
  await screen.findByText('正在复制音频到项目…');
  fireEvent.click(screen.getByRole('button', { name: '取消导入' }));
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('音频已加入项目。')).toBeNull();
  vi.mocked(store.importProjectMaterials).mockResolvedValueOnce(project);
  fireEvent.click(add);
  fireEvent.click(await screen.findByRole('button', { name: '加入音频' }));
  expect(await screen.findByText('音频已加入项目。')).toBeTruthy();
});

it('removes the short success notice after four seconds', async () => {
  vi.mocked(store.importProjectMaterials).mockResolvedValue(project);
  const file = new File(['synthetic audio'], 'sample.wav');
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [{ name: file.name, kind: 'file', getFile: async () => file }]) });
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  fireEvent.click(await screen.findByRole('button', { name: '选择或拖入音频，加入这个场次' }));
  const timer = vi.spyOn(window, 'setTimeout');
  fireEvent.click(await screen.findByRole('button', { name: '加入音频' }));
  await screen.findByText('音频已加入项目。');
  await waitFor(() => expect(timer.mock.calls.some(([, delay]) => delay === 4000)).toBe(true));
  const dismiss = timer.mock.calls.find(([, delay]) => delay === 4000)?.[0];
  expect(typeof dismiss).toBe('function');
  await act(async () => { if (typeof dismiss === 'function') dismiss(); });
  expect(screen.queryByText('音频已加入项目。')).toBeNull();
  timer.mockRestore();
});

it('keeps a failed copy visible as an error and allows another attempt', async () => {
  vi.mocked(store.importProjectMaterials).mockImplementationOnce(async (_project, _materials, _storage, _id, _sessions, onStage) => {
    onStage?.('copying');
    onStage?.('verifying');
    throw new Error('音频副本校验失败');
  });
  const file = new File(['synthetic audio'], 'sample.wav');
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [{ name: file.name, kind: 'file', getFile: async () => file }]) });
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const add = await screen.findByRole('button', { name: '选择或拖入音频，加入这个场次' });
  fireEvent.click(add);
  fireEvent.click(await screen.findByRole('button', { name: '加入音频' }));
  expect((await screen.findByRole('alert')).textContent).toContain('音频副本校验失败');
  expect(screen.queryByText('音频已加入项目。')).toBeNull();
  expect((add as HTMLButtonElement).disabled).toBe(false);
  vi.mocked(store.importProjectMaterials).mockResolvedValue(project);
  fireEvent.click(add);
  fireEvent.click(await screen.findByRole('button', { name: '加入音频' }));
  expect(await screen.findByText('音频已加入项目。')).toBeTruthy();
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
  expect(screen.queryByRole('button', { name: '保存项目' })).toBeNull();
});

it('saves reordered sessions from the existing project board', async () => {
 const opened = { ...project, data: { ...project.data, interviews: [
  { id: 'first', title: 'Reference', recordings: [] },
  { id: 'second', title: '2026-09-11', recordings: [] },
  { id: 'third', title: '2026-09-15', recordings: [] },
 ] } } as store.OpenProject;
 vi.mocked(store.openProject).mockResolvedValue(opened);
 vi.mocked(store.saveProject).mockImplementation(async (existing, data) => ({ ...existing, data: { ...data, revision: existing.data.revision + 1 } }));
 render(<ProjectWorkspace />);
 fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
 await screen.findByRole('button', { name: '调整Reference顺序' });
 fireEvent.keyDown(screen.getByRole('button', { name: '调整Reference顺序' }), { key: 'ArrowDown', altKey: true });
 await waitFor(() => expect(store.saveProject).toHaveBeenCalledWith(opened, expect.objectContaining({ interviews: [opened.data.interviews[1], opened.data.interviews[0], opened.data.interviews[2]] })));
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
  expect(screen.getByRole('button', { name: '界面语言' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', {name:'界面语言'}));fireEvent.click(screen.getByRole('menuitemradio', {name:'English'}));
    expect(await screen.findByRole('button',{name:'New project'})).toBeTruthy();
    expect(store.openProject).not.toHaveBeenCalled();
    expect(store.createProject).not.toHaveBeenCalled();
  } finally { cleanup(); await setInterfaceLanguage('zh-CN'); }
});

it('directly opens a restored recent desktop project without invoking a picker', async () => {
 const saved={name:'synthetic.ripple',queryPermission:vi.fn(async()=> 'granted')} as unknown as FileSystemDirectoryHandle;
 Object.assign(window,{__TAURI__:{core:{}}});
 vi.mocked(store.recentProjects).mockResolvedValueOnce([{id:'p',title:'测试项目',directory:saved}]).mockResolvedValue([]);
 vi.mocked(store.openProject).mockResolvedValue({...project,directory:saved});
 render(<ProjectWorkspace/>); fireEvent.click(screen.getByRole('button',{name:'最近项目'}));
 fireEvent.click(await screen.findByRole('button',{name:'测试项目'}));
 await screen.findByRole('heading',{name:'测试项目'}); expect(state.picker).not.toHaveBeenCalled();
});
it('keeps the welcome page and recent entry when recovery is cancelled', async () => {
 const saved={name:'synthetic.ripple',queryPermission:vi.fn(async()=> 'prompt')} as unknown as FileSystemDirectoryHandle;
 Object.assign(window,{__TAURI__:{core:{}}});
 vi.mocked(store.recentProjects).mockResolvedValueOnce([{id:'p',title:'测试项目',directory:saved}]);
 state.picker.mockRejectedValueOnce(new DOMException('cancelled','AbortError'));
 render(<ProjectWorkspace/>); fireEvent.click(screen.getByRole('button',{name:'最近项目'}));
 fireEvent.click(await screen.findByRole('button',{name:'测试项目'}));
 fireEvent.click(await screen.findByRole('button',{name:'重新选择原项目'}));
 await waitFor(()=>expect(state.picker).toHaveBeenCalledOnce());
 expect(store.openProject).not.toHaveBeenCalled(); expect(store.rememberProject).not.toHaveBeenCalled();
 expect(screen.queryByRole('heading',{name:'测试项目'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'取消'})); expect(screen.queryByText(/访问权限需要恢复/)).toBeNull();
});

it('refreshes recovered audio only after a successful selection, keeping cancellation harmless',async()=>{
 const recording={...project.data.interviews[0].recordings[0],file:'synthetic.wav',fingerprint:'synthetic',storage:'reference' as const};
 const linked={...project,data:{...project.data,interviews:[{...project.data.interviews[0],recordings:[recording]}]}};
 vi.mocked(store.openProject).mockResolvedValue(linked);
 const check=vi.spyOn(store,'checkProjectMedia').mockRejectedValueOnce(new DOMException('Synthetic permission loss','NotAllowedError')).mockResolvedValue(undefined);
 const relink=vi.spyOn(store,'relinkMedia').mockResolvedValue({...linked,data:{...linked.data,revision:1}});
 const selected={name:'synthetic.wav'} as FileSystemFileHandle;
 Object.assign(window,{showOpenFilePicker:vi.fn().mockRejectedValueOnce(new DOMException('Synthetic cancel','AbortError')).mockResolvedValueOnce([selected])});
 render(<ProjectWorkspace/>);fireEvent.click(screen.getByRole('button',{name:'打开项目'}));
 await screen.findByText(/音频访问权限需要恢复/);
 fireEvent.click(screen.getByRole('button',{name:'找到 录音.wav 的原音频'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'找到 录音.wav 的原音频'}) as HTMLButtonElement).disabled).toBe(false));
 expect(relink).not.toHaveBeenCalled();expect(check).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'找到 录音.wav 的原音频'}));
 await waitFor(()=>expect(relink).toHaveBeenCalledWith(linked,'i',recording,selected));
 await waitFor(()=>expect(screen.queryByText(/音频访问权限需要恢复/)).toBeNull());
 expect(check).toHaveBeenCalledTimes(2);
});


it('publishes a completed move and focuses its destination session',async()=>{
 localStorage.clear();
 const two={...project,data:{...project.data,interviews:[...project.data.interviews,{id:'destination',title:'Synthetic destination',recordings:[]}]}};
 const moved={...two,data:{...two.data,revision:1,interviews:[{...two.data.interviews[0],recordings:[]},{...two.data.interviews[1],recordings:two.data.interviews[0].recordings}]}};
 vi.mocked(store.openProject).mockResolvedValueOnce(two);
 vi.mocked(store.moveProjectRecordings).mockResolvedValueOnce(moved);
 render(<ProjectWorkspace/>);
 fireEvent.click(screen.getByRole('button',{name:'打开项目'}));
 fireEvent.click(await screen.findByRole('checkbox',{name:'选择 录音.wav'}));
 fireEvent.click(screen.getByRole('button',{name:'将 录音.wav 移动到其他场次'}));
 fireEvent.click(screen.getByRole('radio',{name:'Synthetic destination'}));
 fireEvent.click(screen.getByRole('button',{name:'确认移动'}));
 await waitFor(()=>expect(store.moveProjectRecordings).toHaveBeenCalledWith(two,'i','destination',['r']));
 expect(await screen.findByText('录音及关联稿件已移到“Synthetic destination”。')).toBeTruthy();
 await waitFor(()=>expect(document.activeElement).toBe(document.querySelector('[data-session-id="destination"]')));
});

it('refuses to move a recording while an AI task owns its manuscript',async()=>{
 localStorage.clear();
 const two={...project,data:{...project.data,interviews:[...project.data.interviews,{id:'destination',title:'Synthetic destination',recordings:[]}]}};
 vi.mocked(store.openProject).mockResolvedValueOnce(two);
 const targetLocked=vi.fn(()=>true);
 render(<ConnectorContext.Provider value={{state:{targetLocked}} as never}><ProjectWorkspace/></ConnectorContext.Provider>);
 fireEvent.click(screen.getByRole('button',{name:'打开项目'}));
 fireEvent.click(await screen.findByRole('checkbox',{name:'选择 录音.wav'}));
 fireEvent.click(screen.getByRole('button',{name:'将 录音.wav 移动到其他场次'}));
 fireEvent.click(screen.getByRole('radio',{name:'Synthetic destination'}));
 fireEvent.click(screen.getByRole('button',{name:'确认移动'}));
 expect(await screen.findByRole('alert')).toBeTruthy();
 expect(store.moveProjectRecordings).not.toHaveBeenCalled();
 expect(targetLocked).toHaveBeenCalledWith('','r','i','p');
 expect(screen.getByRole('dialog')).toBeTruthy();
});

it('publishes duration only after a successful recording-level save and reports failure on return',async()=>{
 const audio={id:'r',name:'Synthetic.m4a',file:'synthetic.m4a',storage:'copy' as const,fingerprint:'16:'+ 'a'.repeat(64)};
 const opened={...project,data:{...project.data,interviews:[{...project.data.interviews[0],recordings:[audio]}]}};
 vi.mocked(store.openProject).mockResolvedValue(opened);
 const saved={...opened,data:{...opened.data,revision:1,interviews:[{...opened.data.interviews[0],recordings:[{...audio,duration:{seconds:3924,fingerprint:audio.fingerprint}}]}]}};
 vi.mocked(store.saveRecordingDuration).mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('synthetic write failure'));
 render(<ProjectWorkspace/>);
 fireEvent.click(screen.getByRole('button',{name:'打开项目'}));
 fireEvent.click(await screen.findByRole('button',{name:'打开 音频 Synthetic.m4a'}));
 fireEvent.click(await screen.findByText('Synthetic accepted duration'));
 await waitFor(()=>expect(store.saveRecordingDuration).toHaveBeenCalledWith(opened,'r',audio.fingerprint,3924));
 fireEvent.click(screen.getByRole('button',{name:'返回访谈'}));
 expect(await screen.findByText('01:05:24')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'打开 音频 Synthetic.m4a'}));
 fireEvent.click(await screen.findByText('Synthetic accepted duration'));
 await waitFor(()=>expect(store.saveRecordingDuration).toHaveBeenCalledTimes(2));
 fireEvent.click(screen.getByRole('button',{name:'返回访谈'}));
 expect(await screen.findByText('音频时长未能保存到项目，重开音频后可重试。')).toBeTruthy();
 expect(screen.getByText('01:05:24')).toBeTruthy();
});

it('dismisses or expires completed import limitations without changing the imported project', async () => {
  vi.mocked(store.importProjectMaterials).mockResolvedValue(project);
  const file = { name: 'Synthetic.txt', text: async () => 'Synthetic untimed manuscript' };
  Object.assign(window, { showOpenFilePicker: vi.fn(async () => [{ name: file.name, getFile: async () => file }]) });
  render(<ProjectWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
  const zone = await screen.findByRole('button', { name: '向 录音.wav 添加转录稿' });
  const timer = vi.spyOn(window, 'setTimeout');
  const warning = msg('materialImport.m1379');
  fireEvent.click(zone);
  const text = await screen.findByText(new RegExp(warning));
  const notice = text.closest('[role="status"]')!;
  const first = timer.mock.calls.find(([, delay]) => delay === 4000)![0] as () => void;
  expect(notice.lastElementChild?.tagName).toBe('BUTTON');
  fireEvent.click(notice.querySelector('button')!);
  expect(screen.queryByText(new RegExp(warning))).toBeNull();
  fireEvent.click(zone);
  await screen.findByText(new RegExp(warning));
  await act(async () => first());
  expect(screen.getByText(new RegExp(warning))).toBeTruthy();
  const latest = timer.mock.calls.filter(([, delay]) => delay === 4000).at(-1)![0] as () => void;
  await act(async () => latest());
  expect(screen.queryByText(new RegExp(warning))).toBeNull();
  expect(store.importProjectMaterials).toHaveBeenCalledTimes(2);
  expect(store.saveProject).not.toHaveBeenCalled();
  expect(screen.getByText('测试项目')).toBeTruthy();
  timer.mockRestore();
});

it.each(['settings','editor','session'] as const)('does not resurrect import feedback after visiting another %s view', async target => {
  const next={...project,data:{...project.data,interviews:[...project.data.interviews,{id:'second',title:'Synthetic second session',recordings:[]}]}} as store.OpenProject;
  vi.mocked(store.openProject).mockResolvedValue(next);
  vi.mocked(store.importProjectMaterials).mockResolvedValue(next);
  render(<ProjectWorkspace/>);
  fireEvent.click(screen.getByRole('button',{name:'打开项目'}));
  const zone=await screen.findByRole('button',{name:'选择或拖入独立转录稿，不关联音频'});
  const file={name:'Synthetic notice.txt',text:async()=>'Synthetic text'} as File;
  fireEvent.drop(zone,{dataTransfer:{types:['Files'],files:[file],items:[]}});
  await screen.findByText(`Synthetic notice.txt：${msg('materialImport.m1379')}`);
  if(target==='settings') fireEvent.click(screen.getByRole('button',{name:'设置'}));
  else if(target==='editor') fireEvent.click(screen.getByRole('button',{name:'打开 音频 录音.wav'}));
  else fireEvent.click(screen.getByRole('button',{name:/Synthetic second session.*音频：0 个/}));
  if(target!=='session') fireEvent.click(await screen.findByRole('button',{name:'返回访谈'}));
  else fireEvent.click(screen.getByRole('button',{name:/第一次访谈.*音频：1 个/}));
  expect(screen.queryByText(`Synthetic notice.txt：${msg('materialImport.m1379')}`)).toBeNull();
  expect(store.importProjectMaterials).toHaveBeenCalledOnce();
});

it('puts project Trash before settings and confirms, deletes and restores the last session as one unit', async () => {
  const entry={id:'synthetic-trash',deletedAt:'2026-01-01T00:00:00Z',position:0,interview:project.data.interviews[0],materialTrash:[]};
  const deleted={...project,data:{...project.data,revision:1,interviews:[],trash:[],sessionTrash:[entry]}} as store.OpenProject;
  vi.mocked(store.trashProjectInterview).mockResolvedValueOnce(deleted);
  vi.mocked(store.restoreProjectTrashItem).mockResolvedValueOnce({...project,data:{...project.data,revision:2,sessionTrash:[]}});
  render(<ProjectWorkspace/>);
  fireEvent.click(screen.getByRole('button',{name:'打开项目'}));
  const remove=await screen.findByRole('button',{name:'删除场次 第一次访谈'});
  const trash=screen.getByRole('button',{name:msg('ProjectWorkspace.m0925')});
  expect(trash.closest('nav')).toBe(screen.getByRole('button',{name:'设置'}).closest('nav'));
  expect(trash.nextElementSibling).toBe(screen.getByRole('button',{name:'设置'}));
  expect(remove.closest('.project-session-heading')).toBeTruthy();
  fireEvent.click(remove);
  expect(store.trashProjectInterview).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'取消'}));
  fireEvent.click(screen.getByRole('button',{name:'移入回收站'}));
  await waitFor(()=>expect(store.trashProjectInterview).toHaveBeenCalledWith(project,'i'));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'打开 音频 录音.wav'})).toBeNull());
  expect(await screen.findByRole('button',{name:msg('ProjectWorkspace.m0925')})).toBeTruthy();
  await waitFor(()=>expect(document.activeElement).toBe(document.querySelector('.setup-new')));
  fireEvent.click(screen.getByRole('button',{name:msg('ProjectWorkspace.m0925')}));
  fireEvent.click(await screen.findByRole('button',{name:'恢复场次 第一次访谈'}));
  await waitFor(()=>expect(store.restoreProjectTrashItem).toHaveBeenCalledWith(deleted,'synthetic-trash'));
  expect(await screen.findByRole('button',{name:'打开 音频 录音.wav'})).toBeTruthy();
});
it('keeps the session confirmation and content when deletion fails, then permits a safe retry', async () => {
  vi.mocked(store.trashProjectInterview).mockRejectedValueOnce(Error('Synthetic session write failure')).mockResolvedValueOnce({...project,data:{...project.data,revision:1,interviews:[],sessionTrash:[{id:'retry-trash',deletedAt:'2026-01-01',position:0,interview:project.data.interviews[0]}]}});
  render(<ProjectWorkspace/>);fireEvent.click(screen.getByRole('button',{name:'打开项目'}));
  fireEvent.click(await screen.findByRole('button',{name:'删除场次 第一次访谈'}));
  fireEvent.click(screen.getByRole('button',{name:'移入回收站'}));
  await screen.findAllByText('Synthetic session write failure');
  expect(screen.getByRole('button',{name:'打开 音频 录音.wav',hidden:true})).toBeTruthy();
  expect(screen.getByRole('dialog',{name:'删除场次？'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'移入回收站'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'删除场次？'})).toBeNull());
});
it('disables deletion of a session whose recording is owned by an active AI task', async () => {
  const targetLocked=vi.fn(()=>true);
  render(<ConnectorContext.Provider value={{state:{activities:[],targetLocked}} as never}><ProjectWorkspace/></ConnectorContext.Provider>);
  fireEvent.click(screen.getByRole('button',{name:'打开项目'}));
  const remove=await screen.findByRole('button',{name:'删除场次 第一次访谈'});
  expect((remove as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(remove);
  expect(screen.queryByRole('dialog',{name:'删除场次？'})).toBeNull();
  expect(store.trashProjectInterview).not.toHaveBeenCalled();
});
