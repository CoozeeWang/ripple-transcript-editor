// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectExportDialog } from './ProjectExportDialog';
import * as store from '../lib/projectStore';
import * as local from '../localStore';
import * as exporter from '../lib/export';
const captured = vi.hoisted(() => ({ files: [] as string[], contents: [] as number[][] }));
vi.mock('jszip', () => ({ default: class {
  file(name: string, data: ArrayBuffer) { captured.files.push(name); captured.contents.push(Array.from(new Uint8Array(data))); }
  async generateAsync() { return new Blob(['zip']); }
} }));
vi.mock('../lib/export', async original => ({ ...await original<typeof exporter>(), downloadBlob: vi.fn(), transcriptBlob: vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([4, 5]).buffer })) }));
vi.mock('../lib/projectStore', async original => ({ ...await original<typeof store>(), checkedMediaFile: vi.fn(async () => ({ name:'source.m4a',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer })), recordingDirectory: vi.fn(async () => ({})), resolveMedia: vi.fn(async () => ({ getFile: async () => ({ name: 'source.m4a', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) })), savePortableProject: vi.fn() }));
vi.mock('../localStore', async original => ({ ...await original<typeof local>(), readManifest: vi.fn(), readModelOriginal: vi.fn(), readModelEdit: vi.fn() }));
const project = { directory: { name: '研究.ripple' }, data: { id: 'p', title: '研究', interviews: [{ id: 's', title: '第一次', recordings: [{ id: 'r', name: '录音.m4a', file: 'a.m4a', storage: 'copy' }] }] } } as store.OpenProject;
const transcript = { audio: { filename: 'a.m4a', duration: 10 }, speakers: [], segments: [{ id: 'a', speaker_id: '', start: 0, end: 10, text: '正文' }] };
beforeEach(() => {
  vi.clearAllMocks(); captured.files.length = 0; captured.contents.length = 0;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(local.readManifest).mockResolvedValue({ models: [{ id: 'm', label: '访谈', original: 'original.json', activeEditId: 'e1', edits: [{ id: 'e1', label: '定稿' }] }] } as Awaited<ReturnType<typeof local.readManifest>>);
  vi.mocked(local.readModelOriginal).mockResolvedValue({ transcript });
  vi.mocked(local.readModelEdit).mockResolvedValue({ kind: 'te-edited', audio: 'a.m4a', transcript, metadata: local.defaultMetadata('访谈') } as Awaited<ReturnType<typeof local.readModelEdit>>);
});
afterEach(cleanup);
it('exports selected current versions and original-format audio into session folders', async () => {
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  await screen.findByLabelText('访谈.docx');
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  fireEvent.click(screen.getByRole('button', { name: /材料压缩包（ZIP）/ }));
  await waitFor(() => expect(exporter.downloadBlob).toHaveBeenCalled());
  expect(captured.files).toEqual(['第一次/录音.m4a', '第一次/访谈.docx']);
  expect(captured.contents[0]).toEqual([1, 2, 3]);
  expect(exporter.transcriptBlob).toHaveBeenCalledWith('docx', transcript, expect.anything(), undefined);
});
it('exports only the current state and does not load or offer internal import copies', async () => {
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  await screen.findByLabelText('访谈.docx');
  expect(local.readModelOriginal).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('访谈的导出版本')).toBeNull();
  expect(screen.queryByText('其他版本')).toBeNull();
  expect(screen.queryByText('完整项目副本')).toBeNull();
});
it('selects audio independently, cascades sessions, and preserves selection when collapsed', async () => {
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  const document = await screen.findByLabelText('访谈.docx');
  const audio = screen.getByLabelText('录音.m4a');
  expect(audio.closest('li')?.contains(document)).toBe(true);
  fireEvent.click(audio);
  expect((document as HTMLInputElement).checked).toBe(true);
  expect((audio as HTMLInputElement).checked).toBe(false);
  const session = screen.getByLabelText('第一次') as HTMLInputElement;
  expect(session.indeterminate).toBe(true);
  fireEvent.click(session);
  expect((audio as HTMLInputElement).checked).toBe(true);
  expect((document as HTMLInputElement).checked).toBe(true);
  fireEvent.click(session);
  expect((audio as HTMLInputElement).checked).toBe(false);
  expect((document as HTMLInputElement).checked).toBe(false);
  fireEvent.click(document);
  fireEvent.click(screen.getByRole('button', { name: '收起 录音.m4a' }));
  expect(screen.queryByLabelText('访谈.docx')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开 录音.m4a' }));
  expect((screen.getByLabelText('访谈.docx') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  await waitFor(() => expect(captured.files).toEqual(['第一次/访谈.docx']));
});
it('exports a portable project without modifying or reopening the source project', async () => {
  const destination = { name: '备份' };
  Object.assign(window, { showDirectoryPicker: vi.fn(async () => destination) });
  vi.mocked(store.savePortableProject).mockResolvedValue({ directory: { name: '研究 项目副本.ripple' } } as store.OpenProject);
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  await screen.findByLabelText('访谈.docx');
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  fireEvent.click(screen.getByRole('button', { name: /Ripple 项目/ }));
  fireEvent.click(screen.getByRole('button', { name: '选择位置并导出' }));
  await screen.findByText('已导出：研究 项目副本.ripple');
  expect(store.savePortableProject).toHaveBeenCalledWith(project, destination, '研究 副本');
});
it('prints selected transcripts as PDF pages without labeling HTML as a PDF file', async () => {
  const write = vi.fn();
  const print = vi.fn();
  const popup = { document: { body: document.createElement("body"), open: vi.fn(), write, close: vi.fn() }, focus: vi.fn(), print, close: vi.fn(), closed: false };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  vi.mocked(local.readModelEdit).mockResolvedValue({ kind: 'te-edited', audio: 'a.m4a', transcript: { ...transcript, segments: [{ ...transcript.segments[0], text: '原文 $& <内容>' }] }, metadata: local.defaultMetadata('访谈') });
  try {
    render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
    await screen.findByLabelText('访谈.docx');
    fireEvent.click(screen.getByLabelText('录音.m4a'));
    fireEvent.change(screen.getByLabelText('访谈 的导出格式'), { target: { value: 'pdf' } });
    fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(write.mock.calls.at(-1)?.[0]).toContain('原文 $&amp; &lt;内容&gt;');
    expect(exporter.downloadBlob).not.toHaveBeenCalled();
  } finally { open.mockRestore(); }
});
it('keeps independent manuscripts at session level and exports mixed timed and untimed formats', async () => {
  const independent = { ...project, data: { ...project.data, interviews: [{ ...project.data.interviews[0], recordings: [...project.data.interviews[0].recordings, { id: 'd', name: '独立文稿', file: 'd.txt', storage: 'none' as const, fingerprint: '' }] }] } };
  vi.mocked(store.recordingDirectory).mockImplementation(async (_p, _s, r) => ({ name: r.id }) as FileSystemDirectoryHandle);
  vi.mocked(local.readManifest).mockImplementation(async dir => ({ models: [{ id: 'm', label: dir.name === 'd' ? '补充材料' : '访谈', original: 'original.json', edits: [] }] } as unknown as Awaited<ReturnType<typeof local.readManifest>>));
  vi.mocked(local.readModelOriginal).mockImplementation(async dir => ({ transcript: { ...transcript, timeAligned: dir.name !== 'd' } }));
  render(<ProjectExportDialog project={independent} onClose={vi.fn()}/>);
  const doc = await screen.findByLabelText('补充材料.docx');
  const audio = screen.getByLabelText('录音.m4a');
  expect(audio.closest('li')?.contains(doc)).toBe(false);
  fireEvent.change(screen.getByLabelText('访谈 的导出格式'), { target: { value: 'srt' } });
  fireEvent.change(screen.getByLabelText('补充材料 的导出格式'), { target: { value: 'md' } });
  expect((within(screen.getByLabelText('补充材料 的导出格式')).getByRole('option', { name: '字幕（.srt）' }) as HTMLOptionElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  fireEvent.click(screen.getByRole('button', { name: /材料压缩包（ZIP）/ }));
  await waitFor(() => expect(captured.files).toEqual(['第一次/录音.m4a', '第一次/访谈.srt', '第一次/补充材料.md']));
});

it('exports only a note for external audio and never reads its file',async()=>{
 const reference={...project,data:{...project.data,interviews:[{...project.data.interviews[0],recordings:[{...project.data.interviews[0].recordings[0],storage:'reference' as const}]}]}};
 render(<ProjectExportDialog project={reference} onClose={()=>{}}/>);
 await screen.findByLabelText('访谈.docx');
 fireEvent.click(screen.getByRole('button',{name:'导出所选材料'}));
 fireEvent.click(screen.getByRole('button',{name:/材料压缩包（ZIP）/}));
 await waitFor(()=>expect(exporter.downloadBlob).toHaveBeenCalled());
 expect(store.checkedMediaFile).not.toHaveBeenCalled();
 expect(store.resolveMedia).not.toHaveBeenCalled();
 expect(captured.files).toEqual(['第一次/录音.m4a-引用说明.txt','第一次/访谈.docx']);
 expect(new TextDecoder().decode(new Uint8Array(captured.contents[0]))).toContain('音频文件本身未包含');
});

it('blocks export after a read failure and lets the user retry loading', async () => {
  vi.mocked(local.readModelEdit).mockRejectedValueOnce(new Error('无法读取转录稿：访谈'));
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: '导出所选材料' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  expect(screen.queryByRole('button', { name: /Ripple 项目/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新读取材料' }));
  await screen.findByLabelText('访谈.docx');
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', { name: '导出所选材料' }) as HTMLButtonElement).disabled).toBe(false);
});

it('offers a project copy for an empty project without offering an empty ZIP', async () => {
  const empty = { ...project, data: { ...project.data, interviews: [] } };
  render(<ProjectExportDialog project={empty} onClose={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button', { name: '导出项目副本' }));
  expect(screen.getByRole('textbox', { name: '副本名称' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /材料文件夹/ })).toBeNull();
  expect(exporter.downloadBlob).not.toHaveBeenCalled();
});

it('returns focus to the export entry after closing', async () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  try {
    const ui = render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
    await screen.findByLabelText('访谈.docx');
    screen.getByRole('button', { name: "关闭导出窗口" }).focus();
    ui.unmount();
    expect(document.activeElement).toBe(opener);
  } finally { opener.remove(); }
});
