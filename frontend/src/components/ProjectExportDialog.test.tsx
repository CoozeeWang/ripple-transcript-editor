// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectExportDialog } from './ProjectExportDialog';
import { setInterfaceLanguage } from '../i18n';
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
  vi.mocked(local.readManifest).mockResolvedValue({ models: [{ id: 'm', sourceKind: 'import', label: '访谈', original: 'original.json', activeEditId: 'e1', edits: [{ id: 'e1', label: '定稿' }] }] } as Awaited<ReturnType<typeof local.readManifest>>);
  vi.mocked(local.readModelOriginal).mockResolvedValue({ transcript });
  vi.mocked(local.readModelEdit).mockResolvedValue({ kind: 'te-edited', audio: 'a.m4a', transcript, metadata: local.defaultMetadata('访谈') } as Awaited<ReturnType<typeof local.readModelEdit>>);
});
afterEach(cleanup);
it.each(['zh-CN','en'] as const)('restores the explicit export entry even when a mouse click did not focus it in %s',async language=>{
  await setInterfaceLanguage(language);
  const opener=document.createElement('button');document.body.append(opener);
  const unrelated=document.createElement('button');document.body.append(unrelated);unrelated.focus();
  try {
    const ui=render(<ProjectExportDialog project={project} onClose={vi.fn()} returnFocusRef={{current:opener}}/>);
    await screen.findByLabelText('定稿.docx');
    ui.unmount();
    expect(document.activeElement).toBe(opener);
  } finally {opener.remove();unrelated.remove();await setInterfaceLanguage('zh-CN');}
});
it('exports selected current versions and original-format audio into session folders', async () => {
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  await screen.findByLabelText('定稿.docx');
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  fireEvent.click(screen.getByRole('button', { name: /材料压缩包（ZIP）/ }));
  await waitFor(() => expect(exporter.downloadBlob).toHaveBeenCalled());
  expect(captured.files).toEqual(['研究/第一次/录音/录音.m4a', '研究/第一次/录音/定稿.docx']);
  expect(captured.contents[0]).toEqual([1, 2, 3]);
  expect(exporter.transcriptBlob).toHaveBeenCalledWith('docx', transcript, expect.anything(), undefined);
});
it('exports only the current state and does not load or offer internal import copies', async () => {
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  await screen.findByLabelText('定稿.docx');
  expect(local.readModelOriginal).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('访谈的导出版本')).toBeNull();
  expect(screen.queryByText('其他版本')).toBeNull();
  expect(screen.queryByText('完整项目副本')).toBeNull();
});
it('selects audio independently, cascades sessions, and preserves selection when collapsed', async () => {
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  const document = await screen.findByLabelText('定稿.docx');
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
  expect(screen.queryByLabelText('定稿.docx')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开 录音.m4a' }));
  expect((screen.getByLabelText('定稿.docx') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  await waitFor(() => expect(captured.files).toEqual(['研究/第一次/录音/定稿.docx']));
});
it('exports a portable project without modifying or reopening the source project', async () => {
  const destination = { name: '备份' };
  Object.assign(window, { showDirectoryPicker: vi.fn(async () => destination) });
  vi.mocked(store.savePortableProject).mockResolvedValue({ directory: { name: '研究 项目副本.ripple' } } as store.OpenProject);
  const onClose = vi.fn();
  render(<ProjectExportDialog project={project} onClose={onClose}/>);
  await screen.findByLabelText('定稿.docx');
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  fireEvent.click(screen.getByRole('button', { name: /Ripple 项目/ }));
  fireEvent.click(screen.getByRole('button', { name: '选择位置并导出' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(store.savePortableProject).toHaveBeenCalledWith(project, destination, '研究 副本');
});
it('does not offer PDF in material archives', async () => {
 render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
 await screen.findByLabelText('定稿.docx');
 expect(screen.queryByRole('option',{name:'PDF'})).toBeNull();
 expect(screen.queryAllByRole('option').every(option=>option.getAttribute('value')!=='pdf')).toBe(true);
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
  await waitFor(() => expect(captured.files).toEqual(['研究/第一次/录音/录音.m4a', '研究/第一次/录音/访谈.srt', '研究/第一次/独立文稿/补充材料.md']));
});

it('includes accessible linked audio without changing its external reference',async()=>{
 const reference={...project,data:{...project.data,interviews:[{...project.data.interviews[0],recordings:[{...project.data.interviews[0].recordings[0],storage:'reference' as const}]}]}};
 render(<ProjectExportDialog project={reference} onClose={()=>{}}/>);
 await screen.findByLabelText('定稿.docx');
 fireEvent.click(screen.getByRole('button',{name:'导出所选材料'}));
 fireEvent.click(screen.getByRole('button',{name:/材料压缩包（ZIP）/}));
 await waitFor(()=>expect(exporter.downloadBlob).toHaveBeenCalled());
 expect(store.checkedMediaFile).toHaveBeenCalledWith(reference,'s',reference.data.interviews[0].recordings[0]);
 expect(captured.files).toEqual(['研究/第一次/录音/录音.m4a','研究/第一次/录音/定稿.docx']);
 expect(reference.data.interviews[0].recordings[0].storage).toBe('reference');
});
it('fails a missing selected audio export without saving an incomplete archive',async()=>{
 vi.mocked(store.checkedMediaFile).mockRejectedValueOnce(new Error('Synthetic audio missing'));
 render(<ProjectExportDialog project={project} onClose={()=>{}}/>);
 await screen.findByLabelText('定稿.docx');
 fireEvent.click(screen.getByRole('button',{name:'导出所选材料'}));
 fireEvent.click(screen.getByRole('button',{name:/材料压缩包（ZIP）/}));
 await screen.findByText('Synthetic audio missing');
 expect(exporter.downloadBlob).not.toHaveBeenCalled();
});
it('includes all visible versions and keeps matching names apart across recordings',async()=>{
 const multiple={...project,data:{...project.data,interviews:[{...project.data.interviews[0],recordings:[...project.data.interviews[0].recordings,{...project.data.interviews[0].recordings[0],id:'r2',name:'另一个录音.m4a'}]}]}};
 vi.mocked(local.readManifest).mockResolvedValue({models:[{id:'m',sourceKind:'transcription',label:'原始转录稿',original:'original.json',edits:[{id:'e1',label:'定稿'},{id:'e2',label:'修改稿'}]}]} as never);
 render(<ProjectExportDialog project={multiple} onClose={()=>{}}/>);
 await waitFor(()=>expect(screen.getAllByLabelText('修改稿.docx')).toHaveLength(2));
 fireEvent.click(screen.getByRole('button',{name:'导出所选材料'}));
 fireEvent.click(screen.getByRole('button',{name:/材料压缩包（ZIP）/}));
 await waitFor(()=>expect(exporter.downloadBlob).toHaveBeenCalled());
 expect(captured.files).toContain('研究/第一次/录音/原始转录稿.docx');
 expect(captured.files).toContain('研究/第一次/另一个录音/原始转录稿.docx');
 expect(captured.files.filter(name=>name.endsWith('定稿.docx'))).toHaveLength(2);
 expect(captured.files.some(name=>name.includes('(2)'))).toBe(false);
});
it('blocks export after a read failure and lets the user retry loading', async () => {
  vi.mocked(local.readModelEdit).mockRejectedValueOnce(new Error('无法读取转录稿：访谈'));
  render(<ProjectExportDialog project={project} onClose={vi.fn()}/>);
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: '导出所选材料' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  expect(screen.queryByRole('button', { name: /Ripple 项目/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新读取材料' }));
  await screen.findByLabelText('定稿.docx');
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
    await screen.findByLabelText('定稿.docx');
    screen.getByRole('button', { name: "关闭导出窗口" }).focus();
    ui.unmount();
    expect(document.activeElement).toBe(opener);
  } finally { opener.remove(); }
});


it('closes material export only after saving finishes', async () => {
  let finish!: () => void;
  vi.mocked(exporter.downloadBlob).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const onClose = vi.fn();
  render(<ProjectExportDialog project={project} onClose={onClose}/>);
  await screen.findByLabelText('定稿.docx');
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  fireEvent.click(screen.getByRole('button', { name: /材料压缩包（ZIP）/ }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(onClose).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '关闭导出窗口' }) as HTMLButtonElement).disabled).toBe(true);
  finish();
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it.each(['AbortError', 'NotReadableError'])('keeps the export dialog open after %s and allows retry', async name => {
  vi.mocked(exporter.downloadBlob).mockRejectedValueOnce(Object.assign(new Error('Synthetic save failure'), { name }));
  const onClose = vi.fn();
  render(<ProjectExportDialog project={project} onClose={onClose}/>);
  await screen.findByLabelText('定稿.docx');
  fireEvent.click(screen.getByRole('button', { name: '导出所选材料' }));
  fireEvent.click(screen.getByRole('button', { name: /材料压缩包（ZIP）/ }));
  await waitFor(() => expect((screen.getByRole('button', { name: /材料压缩包（ZIP）/ }) as HTMLButtonElement).disabled).toBe(false));
  expect(onClose).not.toHaveBeenCalled();
  if (name === 'AbortError') expect(screen.queryByRole('alert')).toBeNull();
  else expect(screen.getByRole('alert').textContent).toBe('Synthetic save failure');
  fireEvent.click(screen.getByRole('button', { name: /材料压缩包（ZIP）/ }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
