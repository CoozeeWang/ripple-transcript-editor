/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory filesystem test doubles implement only the APIs exercised below. */
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useFolder } from '../src/hooks/useFolder';
import { useTranscription } from '../src/hooks/useTranscription';
import { inspectTranscript } from '../src/lib/import';

const fake=vi.hoisted(()=>({reads:new Map<string,Promise<string>>(),transcription:null as any,created:[] as any[]}));
vi.mock('../src/localStore',()=>({
  AUDIO_EXT_LABEL:'wav',
  loadStartPref:async()=>({type:'last'}),loadRecentFolders:async()=>[],loadPreferredStartHandle:async()=>null,
  readAudioUrl:async(_d:any,name:string)=>fake.reads.get(name)??'blob:test',
  readManifest:async()=>null,readEdited:async()=>null,
  listAudioFiles:async()=>[],findLegacyEntries:async()=>[],
  addRecentFolder:async()=>{},migrateAllLegacy:async()=>({migrated:[],skipped:[]}),openFolder:async()=>null,savePreferredStartHandle:async()=>{},saveStartPref:async()=>{},
  TranscriptionError:class extends Error {code:string;constructor(message:string,code:string){super(message);this.code=code;}},
  transcribeAudio:async()=>fake.transcription,
  createModel:async(_d:any,name:string,p:any)=>{fake.created.push(name);return {model:{id:'m1'},manifest:{models:[]},edited:{metadata:{},transcript:p.transcript}};},
}));
const noop=()=>{};
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
afterEach(()=>{cleanup();fake.reads.clear();fake.created=[];vi.restoreAllMocks();});
test('R14 older audio load must not replace the most recently selected file',async()=>{
  const a=deferred<string>(),b=deferred<string>();fake.reads.set('a.wav',a.promise);fake.reads.set('b.wav',b.promise);
  Object.defineProperty(URL, 'revokeObjectURL', {value:vi.fn(), configurable:true});
  const loaded=vi.fn();const ui=renderHook(()=>useFolder({onLoadStart:noop,onLoaded:loaded,onLoadEnd:noop,onLoadError:noop,onClearError:noop,onEmptyFolder:noop,onMigrated:noop}));
  ui.result.current.dirHandleRef.current={} as any;
  let pa!:Promise<void>,pb!:Promise<void>;act(()=>{pa=ui.result.current.loadAudio('a.wav');pb=ui.result.current.loadAudio('b.wav');});
  await act(async()=>{b.resolve('blob:B');await pb;});expect(ui.result.current.selectedAudio).toBe('b.wav');
  await act(async()=>{a.resolve('blob:A');await pa;});expect(ui.result.current.selectedAudio).toBe('b.wav');
});
test('R15 background transcription of A must not replace editor after selection changes to B',async()=>{
  const job=deferred<any>();fake.transcription=job.promise;const reset=vi.fn();const dir={current:{} as any};
  const deps={dirHandleRef:dir,selectedAudio:'a.wav',providers:[{id:'test',name:'test'}],processStatus:'idle',setActiveProviderName:noop,setProcessStatus:noop,setProcessMessage:noop,setMetadata:noop,reset,setSelectedSegmentId:noop,setHasLoadedTranscript:noop,setSaveStatus:noop,applyManifest:noop,setNamingTarget:noop,setNamingOpen:noop,setNamingValue:noop,refreshAudioList:async()=>{}};
  const ui=renderHook((p)=>useTranscription(p as any),{initialProps:deps});let pending!:Promise<void>;
  act(()=>{pending=ui.result.current.startTranscription({} as any,'test');});
  ui.rerender({...deps,selectedAudio:'b.wav'});
  await act(async()=>{job.resolve({audio:{filename:'a.wav',duration:2},speakers:[],segments:[{id:'s1',text:'A的结果',start:0,end:2,speaker_id:'sp'}]});await pending;});
  expect(fake.created).toEqual(['a.wav']); // Saving A's result remains valid.
  expect(reset).not.toHaveBeenCalled(); // The visible B editor must be preserved.
});
test('R16 import must reject or repair duplicate segment IDs',()=>{
  const result=inspectTranscript({audio:{filename:'a.wav',duration:2},speakers:[{id:'sp',name:'A'}],segments:[{id:'same',speaker_id:'sp',start:0,end:1,text:'第一段'},{id:'same',speaker_id:'sp',start:1,end:2,text:'第二段'}]});
  if(result.ok)expect(new Set(result.transcript.segments.map(s=>s.id)).size).toBe(2);
});

test('navigation guard keeps the current audio and folder intact until transcription finishes',async()=>{
  let running=false;const blocked=vi.fn();const loaded=vi.fn(),save=vi.fn(),start=vi.fn(),error=vi.fn();
  const ui=renderHook(()=>useFolder({canChangeDocument:()=>{if(running){blocked();return false;}return true;},beforeChange:save,onLoadStart:start,onLoaded:loaded,onLoadEnd:noop,onLoadError:error,onClearError:noop,onEmptyFolder:noop,onMigrated:noop}));
  const dir={} as any;ui.result.current.dirHandleRef.current=dir;
  await act(async()=>{await ui.result.current.loadAudio('a.wav');});
  loaded.mockClear();save.mockClear();start.mockClear();running=true;
  const permission=vi.fn();
  await act(async()=>{
    await ui.result.current.loadAudio('b.wav');
    await ui.result.current.handleOpenFolder();
    await ui.result.current.handleOpenRecentFolder({requestPermission:permission} as any);
  });
  expect(blocked).toHaveBeenCalledTimes(3);expect(ui.result.current.selectedAudio).toBe('a.wav');
  expect(ui.result.current.dirHandleRef.current).toBe(dir);
  for(const callback of [loaded,save,start,error,permission])expect(callback).not.toHaveBeenCalled();
  running=false;
  await act(async()=>{await ui.result.current.loadAudio('b.wav');});
  expect(ui.result.current.selectedAudio).toBe('b.wav');expect(loaded).toHaveBeenCalledOnce();
});
test('navigation rechecks the guard if a transcription starts while saving before a switch',async()=>{
  let running=false;const saving=deferred<void>();const loaded=vi.fn(),start=vi.fn();
  const ui=renderHook(()=>useFolder({canChangeDocument:()=>!running,beforeChange:()=>saving.promise,onLoadStart:start,onLoaded:loaded,onLoadEnd:noop,onLoadError:noop,onClearError:noop,onEmptyFolder:noop,onMigrated:noop}));
  ui.result.current.dirHandleRef.current={} as any;
  let pending!:Promise<void>;act(()=>{pending=ui.result.current.loadAudio('b.wav');});
  running=true;await act(async()=>{saving.resolve();await pending;});
  expect(start).not.toHaveBeenCalled();expect(loaded).not.toHaveBeenCalled();
});
