// @vitest-environment jsdom
import { ConnectorContext, type ConnectorState } from './hooks/connectorContext';
import { act, cleanup, fireEvent, render as renderBase, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import type { ReactNode } from 'react';
import { AIConnectorProvider } from './components/AIConnectorProvider';
function render(ui: ReactNode) {
  const result = renderBase(<AIConnectorProvider>{ui}</AIConnectorProvider>);
  return { ...result, rerender: (next: ReactNode) => result.rerender(<AIConnectorProvider>{next}</AIConnectorProvider>) };
}
import * as local from "./localStore";
import type { UsePersistenceDeps } from "./hooks/usePersistence";
import type { UseFolderDeps } from "./hooks/useFolder";

const fixture = vi.hoisted(() => ({ persistence: null as UsePersistenceDeps | null, folder: null as UseFolderDeps | null, directory: null as FileSystemDirectoryHandle | null, flush: vi.fn(async () => {}) }));
vi.mock("./hooks/useFolder", () => ({ useFolder: (deps: UseFolderDeps) => {
  fixture.folder = deps;
  return { dirHandle: null, dirHandleRef: { current: fixture.directory }, startPref: { type: "last" },
    preferredStartName: "", recentFolders: [], audioFiles: [], legacyEntries: [],
    migratingLegacy: false, selectedAudio: null, setSelectedAudio: vi.fn(),
    refreshAudioList: vi.fn(), loadAudio: vi.fn(), applyStartPref: vi.fn(),
    pickPreferredFolder: vi.fn(), handleOpenFolder: vi.fn(), handleOpenRecentFolder: vi.fn(),
    handleMigrateLegacy: vi.fn() };
} }));
vi.mock("./hooks/useProviders", () => ({ useProviders: () => ({ providers: [],
  selectedProviderId: "", setSelectedProviderId: vi.fn(), defaultProviderId: null,
  activeProviderName: "", setActiveProviderName: vi.fn() }) }));
vi.mock("./hooks/usePersistence", () => ({ usePersistence: (deps: UsePersistenceDeps) => { fixture.persistence = deps; return { flushPendingSave: fixture.flush }; } }));
vi.mock("./hooks/useOpeningPosition", () => ({ useOpeningPosition: () => {} }));

function load(name: string, title = name) {
  const transcript = { audio: { filename: name, duration: 2 },
    speakers: [{ id: "speaker_0", name: "说话人 1" }],
    segments: [{ id: "seg_1", speaker_id: "speaker_0", start: 0, end: 2, text: `${name}的内容` }] };
  const metadata = { id: name, title, participants: [], topics: [], notes: "", location: "",
    recorded_at: null, created_at: "", updated_at: "" };
  act(() => { fixture.folder!.onLoaded({ url: "", manifest: { schemaVersion: 2, audio: name, models: [], activeModelId: "" },
    edited: { kind: "te-edited", audio: name, transcript, metadata } }, name); });
}

function loadFresh(name: string) {
  act(() => { fixture.folder!.onLoaded({ url: "", manifest: null, edited: null }, name); });
}

vi.mock("./localStore", async original=>({...await original<typeof local>(),readModelOriginal:vi.fn()}));
afterEach(() => { fixture.directory=null;fixture.flush.mockReset().mockResolvedValue(undefined);cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('expires loaded segment-count success, restarts on reopening and preserves load errors and text', () => {
  vi.useFakeTimers();
  render(<App />);
  load('Synthetic.wav');
  expect(document.querySelector('.process-notice')?.textContent).toContain('1');
  act(() => vi.advanceTimersByTime(3000));
  load('Synthetic.wav');
  act(() => vi.advanceTimersByTime(3999));
  expect(document.querySelector('.process-notice')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(document.querySelector('.process-notice')).toBeNull();
  expect(screen.getByText('Synthetic.wav的内容')).toBeTruthy();
  load('Synthetic.wav');
  const close = document.querySelector('.process-notice button')!;
  fireEvent.click(close);
  expect(document.querySelector('.process-notice')).toBeNull();
  act(() => fixture.folder!.onLoadError('Synthetic read failure; retry', true));
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByRole('alert').textContent).toContain('Synthetic read failure');
});

it("uses the complete recording filename for a new project's manuscript without changing the session", () => {
  const session = { id: "session", title: "第一场", participants: [], topics: [], notes: "", location: "",
    recorded_at: null, created_at: "", updated_at: "" };
  const { rerender } = render(<App recordingLabel="录音_A.m4a" interviewTitle={session.title} interviewMetadata={session} />);
  loadFresh("stored-a.m4a");
  expect(screen.getByRole("heading", { name: "录音_A.m4a" })).toBeTruthy();
  rerender(<App recordingLabel="录音_B.m4a" interviewTitle={session.title} interviewMetadata={session} />);
  loadFresh("stored-b.m4a");
  expect(screen.getByRole("heading", { name: "录音_B.m4a" })).toBeTruthy();
  expect(session.title).toBe("第一场");
});

it("uses the recording combination name when opening both draft and manuscript versions", () => {
  const session = { id: "session", title: "第一场", participants: [], topics: [], notes: "", location: "",
    recorded_at: null, created_at: "", updated_at: "" };
  const draft = { metadata: { ...session, title: "我改过的标题" }, speakers: [] };
  render(<App recordingLabel="录音_A.m4a" interviewMetadata={session} recordingDraft={draft} />);
  loadFresh("stored-a.m4a");
  expect(screen.getByRole("heading", { name: "录音_A.m4a" })).toBeTruthy();
  load("stored-a.m4a", "导入稿标题");
  expect(screen.getByRole("heading", { name: "录音_A.m4a" })).toBeTruthy();
});

it("does not inherit hidden speaker IDs from old global storage or a previous document", () => {
  localStorage.setItem("te-hidden-speakers", JSON.stringify(["speaker_0"]));
  render(<App />);
  load("A.wav");
  expect(screen.getByRole("button", { name: "隐藏 说话人 1" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "隐藏 说话人 1" }));
  expect(screen.getByRole("button", { name: "显示 说话人 1" })).toBeTruthy();
  // A failed navigation must leave A's view alone.
  act(() => { fixture.folder!.onLoadError("无法打开", true); });
  expect(screen.getByRole("button", { name: "显示 说话人 1" })).toBeTruthy();
  load("B.wav");
  expect(screen.getByRole("button", { name: "隐藏 说话人 1" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "显示 说话人 1" })).toBeNull();
  load("A.wav");
  expect(screen.getByRole("button", { name: "隐藏 说话人 1" })).toBeTruthy();
});

it("clears find and replace text when loading another document", () => {
  render(<App />);
  load("A.wav");
  fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
  fireEvent.change(screen.getByPlaceholderText("查找"), { target: { value: "A.wav" } });
  fireEvent.click(screen.getByTitle("显示替换选项"));
  fireEvent.change(screen.getByPlaceholderText("替换为"), { target: { value: "旧文稿的替换" } });
  load("B.wav");
  expect(screen.queryByPlaceholderText("查找")).toBeNull();
  fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
  expect((screen.getByPlaceholderText("查找") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByTitle("显示替换选项"));
  expect((screen.getByPlaceholderText("替换为") as HTMLInputElement).value).toBe("");
});

it('waits for successful persistence before leaving the editor for projects', async () => {
  const leave = vi.fn();
  render(<App onReturnToProjects={leave} />);
  load('A.wav');
  fixture.flush.mockRejectedValueOnce(new Error('保存失败，请重试'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Ripple，返回项目" })); });
  expect(leave).not.toHaveBeenCalled();
  expect(screen.getByText(/保存失败，请重试/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '返回项目' })); });
  expect(leave).toHaveBeenCalledOnce();
});

it('keeps the editor open when native project opening is cancelled or saving fails', async () => {
  const open = vi.fn(async () => { throw new DOMException('Cancelled', 'AbortError'); });
  render(<App onOpenProject={open} onReturnToProjects={vi.fn()} />);
  load('A.wav');
  fixture.flush.mockRejectedValueOnce(new Error('Synthetic save failure'));
  await act(async () => { window.dispatchEvent(new Event('ripple-open-project')); });
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByText('A.wav的内容')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Synthetic save failure');
  await act(async () => { window.dispatchEvent(new Event('ripple-open-project')); });
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getByText('A.wav的内容')).toBeTruthy();
});

it('finishes saving before opening the native project picker', async () => {
  const order: string[] = [];
  fixture.flush.mockImplementationOnce(async () => { order.push('save'); });
  const open = vi.fn(async () => { order.push('picker'); });
  render(<App onOpenProject={open} onReturnToProjects={vi.fn()} />);
  load('A.wav');
  await act(async () => { window.dispatchEvent(new Event('ripple-open-project')); });
  expect(order).toEqual(['save','picker']);
});

it('saves before opening a recent project selected from the native menu', async () => {
  const order: string[] = [];
  fixture.flush.mockImplementationOnce(async () => { order.push('save'); });
  const open = vi.fn(async (id?: string) => { order.push(id ?? 'none'); });
  render(<App onOpenProject={open} onReturnToProjects={vi.fn()} />);
  load('Synthetic.wav');
  await act(async () => { window.dispatchEvent(new CustomEvent('ripple-open-recent-project', {detail:'synthetic-one'})); });
  expect(order).toEqual(['save','synthetic-one']);
});

it('opens an original with readable markers and disables their modification', async () => {
  Object.assign(HTMLElement.prototype, { scrollIntoView: vi.fn() });
  render(<App />);
  const name='Synthetic.wav';
  const segment={id:'synthetic-segment',speaker_id:'synthetic-speaker',start:0,end:2,text:'Synthetic original text',annotations:[{id:'synthetic-note',text:'Synthetic original annotation',createdAt:'2026-01-01'}],highlights:[{id:'synthetic-highlight',start:0,end:9}]};
  const transcript={audio:{filename:name,duration:2},speakers:[{id:'synthetic-speaker',name:'Synthetic speaker'}],segments:[segment]};
  const metadata={id:'synthetic',title:'Synthetic original',participants:[],topics:[],notes:'',location:'',recorded_at:null,created_at:'',updated_at:''};
  await act(async()=>{await fixture.folder!.onLoaded({url:'',manifest:{schemaVersion:2,audio:name,activeModelId:'m1',models:[{id:'m1',engine:'synthetic',createdAt:'2026-01-01',original:'original.json',activeEditId:'',edits:[]}]},edited:{kind:'te-edited',audio:name,metadata,transcript}},name);});
  expect(screen.getByText(/当前转录稿为只读/)).toBeTruthy();
  const card=screen.getByText('Synthetic original annotation').closest('.annotation-card')!;
  expect((card.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.doubleClick(screen.getByText('Synthetic original annotation'));
  expect(card.querySelector('textarea')).toBeNull();
  expect((screen.getByRole('textbox',{name:'给当前片段添加批注'}) as HTMLTextAreaElement).disabled).toBe(true);
  expect(segment.annotations[0].text).toBe('Synthetic original annotation');
});

it('opens the explicitly selected engine original instead of the last editing revision',async()=>{
 fixture.directory={} as FileSystemDirectoryHandle;
 const metadata={id:'synthetic',title:'Synthetic',participants:[],topics:[],notes:'',location:'',recorded_at:null,created_at:'',updated_at:''};
 const transcript={audio:{filename:'synthetic.wav',duration:2},speakers:[{id:'speaker',name:'Synthetic'}],segments:[{id:'s1',speaker_id:'speaker',start:0,end:2,text:'Original synthetic words'}]};
 vi.mocked(local.readModelOriginal).mockResolvedValue({transcript} as never);
 Object.assign(HTMLElement.prototype,{scrollIntoView:vi.fn()});
 render(<App initialOriginalModelId="engine"/>);
 await act(async()=>{await fixture.folder!.onLoaded({url:'',manifest:{schemaVersion:2,audio:'synthetic.wav',activeModelId:'engine',models:[{id:'engine',engine:'synthetic',createdAt:'2026-01-01',original:'original.json',activeEditId:'e2',edits:[{id:'e2',file:'e2.json',updated_at:''}]}]},edited:{kind:'te-edited',audio:'synthetic.wav',metadata,transcript:{...transcript,segments:[{...transcript.segments[0],text:'AI synthetic words'}]}}},'synthetic.wav');});
 expect(local.readModelOriginal).toHaveBeenCalledWith(fixture.directory,'synthetic.wav','engine');
 expect(screen.getByText('Original synthetic words')).toBeTruthy();expect(screen.queryByText('AI synthetic words')).toBeNull();
 expect(screen.getByText(/当前转录稿为只读/)).toBeTruthy();
});

// Recording labels can differ from the title inside an imported file. The
// normalized display metadata and persistence baseline must be the same object.
it("publishes the exact loaded metadata and transcript references after applying the recording label", () => {
  render(<App recordingLabel="Synthetic recording" />);
  load("synthetic.wav", "Synthetic imported title");
  const current = fixture.persistence!;
  expect(current.metadata?.title).toBe("Synthetic recording");
  expect(current.persistedContent?.metadata).toBe(current.metadata);
  expect(current.persistedContent?.transcript).toBe(current.transcript);
  loadFresh("synthetic.wav");
  expect(fixture.persistence!.persistedContent?.metadata).toBe(fixture.persistence!.metadata);
  expect(fixture.persistence!.persistedContent?.transcript).toBe(fixture.persistence!.transcript);
});

it('shows damaged-journal recovery when no AI activity or healthy task could be recovered', async () => {
  const state: ConnectorState = { enabled: false, setEnabled: vi.fn(), reconnect: vi.fn(), status: 'off', activities: [], tasks: [],
    taskError: 'continuation_journal_unreadable', taskActionError: '', recoveryWarning: 'continuation_journal_unreadable', recoveryProjectIds: [''], dismissTaskError: vi.fn(), taskAction: vi.fn(async () => ({})), targetLocked: () => false };
  renderBase(<ConnectorContext.Provider value={{ state, register: vi.fn(), unregister: vi.fn() }}><App /></ConnectorContext.Provider>);
  load('Synthetic.wav');
  expect(screen.getByRole('alert').textContent).toContain('其他任务仍可使用');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '刷新进度' })); });
  expect(state.taskAction).toHaveBeenCalledWith('tasks', undefined);
  expect(screen.getByText('Synthetic.wav的内容')).toBeTruthy();
});

it('sends accepted media duration to the project without using transcript duration', async () => {
  vi.useFakeTimers();
  const onAudioDuration=vi.fn(async()=>{});
  const ui=render(<App onAudioDuration={onAudioDuration}/>);
  act(()=>{fixture.folder!.onLoaded({url:'synthetic.wav',manifest:null,edited:null},'synthetic.wav');});
  const audio=ui.container.querySelector('audio')!;
  Object.defineProperty(audio,'duration',{configurable:true,value:3924});
  act(()=>fireEvent.loadedMetadata(audio));
  expect(ui.getByText('--:--:--')).toBeTruthy();
  expect(onAudioDuration).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTime(4000));
  expect(ui.getByText('01:05:24')).toBeTruthy();
  expect(onAudioDuration).toHaveBeenCalledExactlyOnceWith(3924);
});
