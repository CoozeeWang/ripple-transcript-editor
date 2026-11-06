import {msg} from './i18n';
import {flushSync} from 'react-dom';
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
  fireEvent.click(document.querySelector('[data-tip="显示替换选项"]')!);
  fireEvent.change(screen.getByPlaceholderText("替换为"), { target: { value: "旧文稿的替换" } });
  load("B.wav");
  expect(screen.queryByPlaceholderText("查找")).toBeNull();
  fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
  expect((screen.getByPlaceholderText("查找") as HTMLInputElement).value).toBe("");
  fireEvent.click(document.querySelector('[data-tip="显示替换选项"]')!);
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

function tagManifest(name:string):import('./types').TranscriptManifest{return {schemaVersion:2,audio:name,activeModelId:'m1',models:[{id:'m1',engine:'imported',sourceKind:'import',activeEditId:'e1',edits:[{id:'e1',file:'synthetic-e1.json',updated_at:'2026-01-01'}]}]}}
function loadTagDocument(transcript:import('./types').Transcript,library:import('./lib/tags').TagLibrary){
 const ids=new Set(library.tags.map(tag=>tag.id));
 const collection={schemaVersion:1 as const,tagIds:[...ids],groups:library.groups.map(group=>({id:group.id,name:group.name,tagIds:library.tags.filter(tag=>tag.groupIds.includes(group.id)).map(tag=>tag.id)}))};
 act(()=>{fixture.folder!.onLoaded({url:'',manifest:tagManifest(transcript.audio.filename),edited:{kind:'te-edited',audio:transcript.audio.filename,transcript:{...transcript,tagCollection:collection},metadata:local.defaultMetadata('Synthetic tags')}},transcript.audio.filename)});
}
function memoryTagStorage(library:import('./lib/tags').TagLibrary,setLibrary:(library:import('./lib/tags').TagLibrary)=>void,beforeWrite=async()=>{}):import('./hooks/useProjectTags').TagStorage{
 return {transact:async(current,operation)=>{
  const {projectTagCatalog}=await import('./lib/tagCollections');
  const result=operation(projectTagCatalog(library),[{id:'current',label:'Synthetic version',transcript:current.transcript}],'current');
  await beforeWrite();return {project:{data:{tagLibrary:result.library}} as import('./lib/projectStore').OpenProject,transcript:result.consumers[0].transcript,receipt:{beforeLibrary:library,afterLibrary:result.library,versions:[]}};
 },restore:async(receipt,redo)=>({data:{tagLibrary:redo?receipt.afterLibrary:receipt.beforeLibrary}} as import('./lib/projectStore').OpenProject),
 publish:(project,publishVersion)=>flushSync(()=>{setLibrary(project.data.tagLibrary!);publishVersion()})};
}
const syntheticTagLibrary=():import('./lib/tags').TagLibrary=>({schemaVersion:3,tags:[{id:'synthetic-tag',name:'Synthetic topic',parentId:null,groupIds:[]}],groups:[]});
function setupTagUi(){vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false};HTMLElement.prototype.scrollTo=vi.fn()}
it('connects project tag transactions to one undo and redo step',async()=>{
 const {useState}=await import('react');setupTagUi();
 function Harness(){const[library,setLibrary]=useState(syntheticTagLibrary);return <App projectRecordingId="synthetic-r" tagLibrary={library} tagStorage={memoryTagStorage(library,setLibrary)}/>}
 render(<Harness/>);loadTagDocument({audio:{filename:'Synthetic.wav',duration:1},speakers:[],segments:[{id:'s',speaker_id:'v',text:'Synthetic text',start:0,end:1}]},syntheticTagLibrary());
 fireEvent.click(screen.getByRole('button',{name:'标签 1'}));fireEvent.click(screen.getByRole('button',{name:'项目'}));if(screen.getByRole('button',{name:'标签筛选'}).getAttribute('aria-pressed')==='true')fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));fireEvent.doubleClick(screen.getByRole('button',{name:'标签: Synthetic topic'}));
 fireEvent.change(screen.getByRole('textbox',{name:'项目标签完整路径'}),{target:{value:'Synthetic renamed'}});await act(async()=>fireEvent.keyDown(screen.getByRole('textbox',{name:'项目标签完整路径'}),{key:'Enter'}));
 expect(screen.getByRole('button',{name:'标签: Synthetic renamed'})).toBeTruthy();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'撤销'})));expect(screen.getByRole('button',{name:'标签: Synthetic topic'})).toBeTruthy();expect(fixture.persistence!.persistedContent?.transcript).toBe(fixture.persistence!.transcript);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'重做'})));expect(screen.getByRole('button',{name:'标签: Synthetic renamed'})).toBeTruthy();expect(fixture.persistence!.persistedContent?.transcript).toBe(fixture.persistence!.transcript);
});
it('tag filtering preserves speaker hiding, switches views and clears only its own conditions',async()=>{
 const {useState}=await import('react');setupTagUi();
 const seed:import('./lib/tags').TagLibrary={schemaVersion:3,tags:[{id:'A',name:'Synthetic A',parentId:null,groupIds:[]},{id:'B',name:'Synthetic B',parentId:null,groupIds:[]}],groups:[]};
 function Harness(){const[library,setLibrary]=useState(seed);return <App projectRecordingId="synthetic-r" tagLibrary={library} tagStorage={memoryTagStorage(library,setLibrary)}/>}
 render(<Harness/>);loadTagDocument({audio:{filename:'Synthetic.wav',duration:4},speakers:[{id:'h',name:'Hidden'},{id:'v',name:'Visible'}],segments:[{id:'hidden',speaker_id:'h',start:0,end:1,text:'Synthetic hidden',tagIds:['A','B']},{id:'a',speaker_id:'v',start:1,end:2,text:'Synthetic A',tagIds:['A']},{id:'both',speaker_id:'v',start:2,end:3,text:'Synthetic both',tagIds:['A','B']},{id:'none',speaker_id:'v',start:3,end:4,text:'Synthetic none'}]},seed);
 fireEvent.click(screen.getByRole('button',{name:'隐藏 Hidden'}));fireEvent.click(screen.getByRole('button',{name:'标签 2'}));expect(screen.getByRole('button',{name:'标签筛选'}).getAttribute('aria-pressed')).toBe('false');fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));fireEvent.click(screen.getByRole('button',{name:'标签: Synthetic A'}));fireEvent.click(screen.getByRole('button',{name:'标签: Synthetic B'}));expect(document.querySelectorAll('.segment')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'或'}));expect(document.querySelectorAll('.segment')).toHaveLength(2);expect(document.querySelector('[data-tag-id="A"] .tag-count')?.textContent).toBe('3');
 fireEvent.click(screen.getByRole('button',{name:'项目'}));expect(document.querySelectorAll('.segment')).toHaveLength(2);fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));expect(document.querySelectorAll('.segment')).toHaveLength(3);expect(screen.queryByText('Synthetic hidden')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'标签: Synthetic A'}));expect(document.querySelectorAll('.segment')).toHaveLength(3);fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));expect(document.querySelectorAll('.segment')).toHaveLength(3);
});
it('blocks project navigation while a shared inline rename is saving',async()=>{
 const {useState}=await import('react');setupTagUi();let finish!:()=>void;const leave=vi.fn(),open=vi.fn();
 function Harness(){const[library,setLibrary]=useState(syntheticTagLibrary);return <App projectRecordingId="synthetic-r" onReturnToProjects={leave} onOpenProject={open} tagLibrary={library} tagStorage={memoryTagStorage(library,setLibrary,()=>new Promise<void>(resolve=>{finish=resolve}))}/>}
 render(<Harness/>);loadTagDocument({audio:{filename:'Synthetic.wav',duration:1},speakers:[],segments:[{id:'s',speaker_id:'v',text:'Synthetic text',start:0,end:1}]},syntheticTagLibrary());
 fireEvent.click(screen.getByRole('button',{name:'标签 1'}));fireEvent.click(screen.getByRole('button',{name:'项目'}));if(screen.getByRole('button',{name:'标签筛选'}).getAttribute('aria-pressed')==='true')fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));fireEvent.doubleClick(screen.getByRole('button',{name:'标签: Synthetic topic'}));fireEvent.change(screen.getByRole('textbox',{name:'项目标签完整路径'}),{target:{value:'Renamed'}});
 await act(async()=>{fireEvent.keyDown(screen.getByRole('textbox',{name:'项目标签完整路径'}),{key:'Enter'});await Promise.resolve()});
 expect((screen.getByRole('button',{name:'返回项目'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('button',{name:'返回项目'}).getAttribute('data-write-pending')).toBe('true');expect(screen.queryByText('当前转录稿为只读。请先新建修改版本，再编辑批注或高亮。')).toBeNull();expect(document.querySelector('.tag-library')?.hasAttribute('inert')).toBe(true);expect((screen.getByRole('button',{name:'新建标签'}) as HTMLButtonElement).disabled).toBe(false);fireEvent(window,new Event('ripple-open-project'));expect(open).not.toHaveBeenCalled();expect(leave).not.toHaveBeenCalled();await act(async()=>finish());expect(screen.getByRole('button',{name:'标签: Renamed'})).toBeTruthy();
});

it('guards the inline export confirmation against an AI lease acquired after the menu opened',async()=>{
 setupTagUi();const api=await import('./lib/export');const exported=vi.spyOn(api,'exportTranscript').mockResolvedValue(undefined);let locked=false;
 const state:ConnectorState={enabled:true,setEnabled:vi.fn(),reconnect:vi.fn(),status:'ready',activities:[],tasks:[],taskError:'',taskActionError:'',recoveryWarning:'',recoveryProjectIds:[],dismissTaskError:vi.fn(),taskAction:vi.fn(async()=>({})),targetLocked:()=>locked};
 const view=()=> <ConnectorContext.Provider value={{state,register:vi.fn(),unregister:vi.fn()}}><App/></ConnectorContext.Provider>;
 const {rerender}=renderBase(view());load('Synthetic.wav');
 const open=()=>{fireEvent.click(screen.getByRole('button',{name:'导出'}));fireEvent.click(screen.getByRole('menuitem',{name:msg('tags.exportFull')}));fireEvent.click(screen.getByRole('menuitemradio',{name:'JSON'}));};
 open();expect(screen.queryByRole('dialog')).toBeNull();locked=true;fireEvent.click(screen.getByRole('menuitem',{name:'导出'}));expect(exported).not.toHaveBeenCalled();expect(fixture.persistence!.manualSaveBlocked!()).toContain('停止 AI 编辑');
 rerender(view());expect(screen.getByRole('button',{name:'保存当前转录稿'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'导出'})).toHaveProperty('disabled',true);
 locked=false;rerender(view());open();await act(async()=>{fireEvent.click(screen.getByRole('menuitem',{name:'导出'}))});expect(exported).toHaveBeenCalledWith('json',expect.any(Object),expect.any(Object),undefined,expect.any(String),expect.objectContaining({options:{tags:true,highlights:true,annotations:true}}));
});

it('keeps the full AI notice on the exact target editor while navigation preserves background progress',async()=>{
 setupTagUi();
 const activity:import('./lib/aiEditOwnership').AIEditActivity={task_id:'synthetic-task',client:'chatgpt',key:'synthetic-key',version:'Synthetic version',version_id:'m1:e1',target:{project_id:'p',project:'Synthetic project',interview_id:'i',interview:'Synthetic session',recording_id:'a',recording:'Synthetic A',version_id:'m1:e1',version:'Synthetic version'},kind:'incremental',state:'processing',requestId:'synthetic-request',requestStatus:'editing',requestComplete:false,processed:240,saved:240,total:2312,inFlight:0,touched:0};
 const state:ConnectorState={enabled:true,setEnabled:vi.fn(),reconnect:vi.fn(),status:'ready',activities:[activity],tasks:[],taskError:'',taskActionError:'',recoveryWarning:'',recoveryProjectIds:[],dismissTaskError:vi.fn(),taskAction:vi.fn(async()=>({})),targetLocked:()=>false};
 const project={data:{id:'p',interviews:[]}} as unknown as import('./lib/projectStore').OpenProject;
 const view=(recording:string)=> <ConnectorContext.Provider value={{state,register:vi.fn(),unregister:vi.fn()}}><App projectRecordingId={recording} projectInterviewId="i" connectorProject={()=>project}/></ConnectorContext.Provider>;
 const ui=renderBase(view('a'));
 const transcript={audio:{filename:'Synthetic.wav',duration:1},speakers:[],segments:[{id:'s',speaker_id:'v',text:'Synthetic text',start:0,end:1}]};
 loadTagDocument(transcript,syntheticTagLibrary());
 expect(document.querySelector('.ai-editing-region')?.textContent).toContain('240');
 ui.rerender(view('b'));expect(document.querySelector('.ai-editing-region')).toBeNull();
 activity.saved=480;activity.processed=480;state.activities=[{...activity}];ui.rerender(view('b'));
 expect(document.querySelector('.ai-editing-region')).toBeNull();expect(state.taskAction).not.toHaveBeenCalled();
 ui.rerender(view('a'));expect(document.querySelector('.ai-editing-region')?.textContent).toContain('480');
 activity.version_id='m1:e2';state.activities=[{...activity}];ui.rerender(view('a'));expect(document.querySelector('.ai-editing-region')).toBeNull();
 const manifest=tagManifest('Synthetic.wav');manifest.models[0].activeEditId='e2';manifest.models[0].edits.push({id:'e2',file:'synthetic-e2.json',updated_at:'2026-01-02'});
 await act(async()=>{await fixture.folder!.onLoaded({url:'',manifest,edited:{kind:'te-edited',audio:'Synthetic.wav',transcript,metadata:local.defaultMetadata('Synthetic')}},'Synthetic.wav')});
 expect(document.querySelector('.ai-editing-region')?.textContent).toContain('480');expect(state.taskAction).not.toHaveBeenCalled();
});

it('opens and reopens manuscripts with tag filtering off after an explicit filter session',async()=>{
 const {useState}=await import('react');setupTagUi();
 const seed=syntheticTagLibrary();
 function Harness(){const[library,setLibrary]=useState(seed);return <App projectRecordingId="synthetic-r" tagLibrary={library} tagStorage={memoryTagStorage(library,setLibrary)}/>}
 render(<Harness/>);
 const transcript={audio:{filename:'Synthetic.wav',duration:2},speakers:[],segments:[{id:'a',speaker_id:'s',text:'Synthetic one',start:0,end:1,tagIds:[seed.tags[0].id]},{id:'b',speaker_id:'s',text:'Synthetic two',start:1,end:2}]};
 for(const filename of ['Synthetic.wav','Other.wav','Other.wav']){
  loadTagDocument({...transcript,audio:{...transcript.audio,filename}},seed);
  fireEvent.click(screen.getByRole('button',{name:'标签 1'}));
  const toggle=screen.getByRole('button',{name:'标签筛选'});
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelectorAll('.segment')).toHaveLength(2);
  fireEvent.click(toggle);fireEvent.click(screen.getByRole('button',{name:'标签: Synthetic topic'}));
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelectorAll('.segment')).toHaveLength(1);
 }
});

it('saves before opening a Finder project and keeps the editor when saving fails', async () => {
  let receiver: import('./lib/segmentLinkDelivery').SegmentLinkReceiver | null = null;
  const open = vi.fn(async () => {});
  render(<App onOpenProject={open} registerSegmentLinkReceiver={value => { receiver = value; }} />);
  load('Synthetic.wav');
  const directory = { name: 'Synthetic.ripple' } as FileSystemDirectoryHandle;
  fixture.flush.mockRejectedValueOnce(new Error('Synthetic save failed'));
  await act(async () => { await receiver!.openProject!(directory); });
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByText('Synthetic.wav的内容')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Synthetic save failed');
  const order: string[] = [];
  fixture.flush.mockImplementationOnce(async () => { order.push('save'); });
  open.mockImplementationOnce(async () => { order.push('open'); });
  await act(async () => { await receiver!.openProject!(directory); });
  expect(order).toEqual(['save', 'open']);
  expect(open).toHaveBeenCalledExactlyOnceWith(undefined, directory);
});
