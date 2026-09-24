import {useTranscriptHistory} from "../src/useTranscriptHistory";
import {applyAISuggestions} from "../src/lib/aiEditing";
import { writeEditorText } from "../src/lib/paragraphEditor";
/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory filesystem test doubles implement only the APIs exercised below. */
// @vitest-environment jsdom
import React, { useState } from 'react';
import { Blob as NodeBlob } from 'node:buffer';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SegmentTextArea } from '../src/components/SegmentTextArea';
import { usePersistence } from '../src/hooks/usePersistence';
import { useVersions } from '../src/hooks/useVersions';
import { useFindReplace } from '../src/hooks/useFindReplace';
import { useShortcuts } from '../src/hooks/useShortcuts';
import { splitSegmentAt, mergeSegmentWithNext } from '../src/lib/segmentOps';
import { markReviewed, isReviewed } from '../src/lib/aiEditing';
import { saveInterviewDetails, readModelEdit, listAudioFiles, readEdited, readManifest, saveActiveEdit, persistActiveModel, renameAudio, createEdit, createModel, renameEditLabel, removeEdit, removeModelOriginal } from '../src/localStore';

// Regression contracts use an in-memory filesystem; no real user data is accessed.
const noop = () => {};
const metadata = { id:'a',title:'a',recorded_at:null,location:'',participants:[],topics:[],notes:'',created_at:'2026-09-06',updated_at:'2026-09-06' };
const transcript = (text = '甲乙丙丁') => ({ audio:{filename:'a.wav',duration:4}, speakers:[{id:'sp',name:'A'}], segments:[{id:'s1',speaker_id:'sp',start:0,end:4,text,words:Array.from(text).map((c,i)=>({text:c,start:i,end:i+1,speaker_id:'sp'}))}] });
const edited = (text: string, audio='a.wav') => ({ kind:'te-edited', audio, metadata, transcript:transcript(text) });
const manifest = () => ({ schemaVersion:2,audio:'a.wav',audioFingerprint:'synthetic',activeModelId:'m1',models:[{id:'m1',engine:'test',activeEditId:'e1',edits:[{id:'e1',file:'m1-e1.json',updated_at:''},{id:'e2',file:'m1-e2.json',updated_at:''}]}] });

class MemoryDir {
  kind = 'directory'; name: string; files = new Map<string,string>(); dirs = new Map<string,MemoryDir>();
  beforeWrite?: (name:string,data:string)=>Promise<void>;
  beforeClose?: (name:string,data:string)=>Promise<void>;
  constructor(name='root') { this.name=name; }
  async getDirectoryHandle(name:string, opts?:any) { if (!this.dirs.has(name)) { if (!opts?.create) throw new DOMException('missing','NotFoundError'); this.dirs.set(name,new MemoryDir(name)); } return this.dirs.get(name)!; }
  async getFileHandle(name:string, opts?:any) {
    if (!this.files.has(name)) { if (!opts?.create) throw new DOMException('missing','NotFoundError'); this.files.set(name,''); }
    return {kind:'file',getFile:async()=>new NodeBlob([this.files.get(name)!]),createWritable:async()=>{ let pending=''; return {write:async(data:string | NodeBlob)=>{const text=typeof data==='string'?data:await data.text();await this.beforeWrite?.(name,text);pending=text;},close:async()=>{await this.beforeClose?.(name,pending);this.files.set(name,pending);},abort:async()=>{}};}};
  }
  async *entries() { for (const [n,d] of this.dirs) yield [n,d]; for(const n of this.files.keys()) yield [n,{kind:'file'}]; }
  async removeEntry(n:string) {this.files.delete(n);this.dirs.delete(n);}
}
function disk() {const dir=new MemoryDir();const child=new MemoryDir('a.transcript');dir.dirs.set('a.transcript',child);child.files.set('manifest.json',JSON.stringify(manifest()));child.files.set('m1-e1.json',JSON.stringify(edited('磁盘旧稿')));child.files.set('m1-e2.json',JSON.stringify(edited('第二稿')));return {dir,child};}
function persistenceDeps(dir:any,t:any, extra:any={}) {return {dirHandleRef:{current:dir},initialLoadRef:{current:false},hasLoadedTranscript:true,viewingOriginal:false,selectedAudio:'a.wav',transcript:t,metadata,activeModelId:'m1',models:manifest().models,saveStatus:'unsaved',setSaveStatus:vi.fn(),setShuttingDown:vi.fn(),...extra} as any;}
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(window,'confirm').mockReturnValue(true);});
afterEach(()=>{cleanup();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});

test('explicit review progress survives saving and reopening the modification file', async () => {
  const {dir} = disk();
  const current = transcript('认可原样保留');
  const approved = { ...current, reviewedSegments: markReviewed(current, current.segments, true) };
  await saveActiveEdit(dir as any, 'a.wav', 'm1', 'e1', { ...edited(''), transcript: approved } as any);
  const reopened = await readEdited(dir as any, 'a.wav');
  expect(reopened?.transcript.reviewedSegments).toEqual(approved.reviewedSegments);
  expect(isReviewed(reopened!.transcript.segments[0], reopened!.transcript.reviewedSegments!)).toBe(true);
});

test('AI reviewed version leaves the source untouched and activates the complete new file', async () => {
  const {dir, child} = disk();
  const oldFile = child.files.get('m1-e1.json');
  const baseline = transcript('磁盘旧稿');
  const result = await createEdit(dir as any, 'a.wav', 'm1', {srcEditId:'e1', reviewed:{baseline, transcript:transcript('审阅新稿'), label:'AI · 轻度整理'}});
  expect(child.files.get('m1-e1.json')).toBe(oldFile);
  expect(result.edited.transcript.segments[0].text).toBe('审阅新稿');
  expect(result.edit.label).toBe('AI · 轻度整理');
  expect(result.edit.comparisonBaseId).toBe('e1');
  const reopenedManifest=await readManifest(dir as any,'a.wav');
  expect(reopenedManifest?.models[0].edits.find(e=>e.id===result.edit.id)?.comparisonBaseId).toBe('e1');
  expect(result.manifest.models[0].activeEditId).toBe('e3');
  expect(JSON.parse(child.files.get(result.edit.file)!).transcript).toEqual(result.edited.transcript);
});
test('AI reviewed version refuses a stale disk snapshot before writing anything', async () => {
  const {dir, child} = disk(); const previous = [...child.files];
  await expect(createEdit(dir as any, 'a.wav', 'm1', {reviewed:{baseline:transcript('过期内容'), transcript:transcript('新稿'), label:'AI'}})).rejects.toThrow('已发生变化');
  expect([...child.files]).toEqual(previous);
});
test('AI version write failure leaves manifest and source active and intact', async () => {
  const {dir, child} = disk(); const oldManifest = child.files.get('manifest.json'); const oldFile = child.files.get('m1-e1.json');
  child.beforeWrite = async name => { if (name === 'a_AI.json') throw new Error('disk full'); };
  await expect(createEdit(dir as any, 'a.wav', 'm1', {reviewed:{baseline:transcript('磁盘旧稿'), transcript:transcript('新稿'), label:'AI'}})).rejects.toThrow('disk full');
  expect(child.files.get('manifest.json')).toBe(oldManifest);
  expect(child.files.get('m1-e1.json')).toBe(oldFile);
});
test('AI review integrates with version switching after flushing the current draft', async () => {
  const {dir, child} = disk(); const baseline = transcript('磁盘旧稿');
  const beforeChange = vi.fn(async () => {}); const reset = vi.fn();
  const ui = renderHook(() => useVersions({
    dirHandleRef:{current:dir as any}, selectedAudio:'a.wav', transcript:baseline, metadata,
    reset, beforeChange, viewingOriginal:false, setMetadata:noop, setSelectedSegmentId:noop,
    setHasLoadedTranscript:noop, setViewingOriginal:noop, setImportRepairs:noop,
    setProcessStatus:noop, setProcessMessage:noop,
  }));
  act(() => ui.result.current.applyManifest(manifest()));
  await act(async () => { await ui.result.current.createAIEdit(baseline, [{id:'s1', text:'磁盘稿', reason:'删除冗余'}], '偏好'); });
  expect(beforeChange).toHaveBeenCalledOnce();
  expect(ui.result.current.activeEditKey).toBe('edit:m1:e3');
  expect(ui.result.current.versionBusy).toBe(false);
  expect(reset.mock.calls[0][0].segments[0].text).toBe('磁盘稿');
  expect(JSON.parse(child.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('磁盘旧稿');
});

test('R01 latest typed character must reach parent after debounce without blur',()=>{
  const onChange=vi.fn();const ui=render(<SegmentTextArea segmentId="s1" value="甲" registry={{current:new Map()}} ariaLabel="正文" onFocus={noop} onBlur={noop} onClick={noop} onKeyDown={noop} onChange={onChange}/>);
  writeEditorText(ui.getByRole('textbox'), '甲乙'); fireEvent.input(ui.getByRole('textbox'));
  act(()=>vi.advanceTimersByTime(1000));
  expect(onChange).toHaveBeenLastCalledWith('甲乙',expect.any(Array));
});
test('R02 obsolete text timer must not call parent after editor unmount',()=>{
  const onChange=vi.fn();const ui=render(<SegmentTextArea segmentId="s1" value="甲" registry={{current:new Map()}} ariaLabel="正文" onFocus={noop} onBlur={noop} onClick={noop} onKeyDown={noop} onChange={onChange}/>);
  writeEditorText(ui.getByRole('textbox'), '甲乙'); fireEvent.input(ui.getByRole('textbox'));
  writeEditorText(ui.getByRole('textbox'), '甲乙丙'); fireEvent.input(ui.getByRole('textbox'));
  ui.unmount();act(()=>vi.advanceTimersByTime(1000));
  expect(onChange).not.toHaveBeenCalled();
});
test('R03 rapid document replacement must flush previous pending save',async()=>{
  const {dir,child}=disk();const next=new MemoryDir('b.transcript');dir.dirs.set('b.transcript',next);next.files.set('manifest.json',JSON.stringify({...manifest(),audio:'b.wav'}));next.files.set('m1-e1.json',JSON.stringify(edited('B','b.wav')));
  const props=persistenceDeps(dir,transcript('最后修改'));
  const ui=renderHook((p)=>usePersistence(p),{initialProps:props});
  ui.rerender({...props,selectedAudio:'b.wav',transcript:transcript('B')});
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(JSON.parse(child.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('最后修改');
});
test('R04 save error toast must remain until a save actually succeeds',()=>{
  const {dir}=disk();const props=persistenceDeps(dir,transcript(),{saveStatus:'error'});
  const ui=renderHook((p)=>usePersistence(p),{initialProps:props});
  expect(ui.result.current.saveToast?.kind).toBe('error');
  ui.rerender({...props,saveStatus:'unsaved'});
  expect(ui.result.current.saveToast?.kind).toBe('error');
});
test('R05 version switch must stop if saving current version fails',async()=>{
  const {dir,child}=disk();child.beforeWrite=async(name)=>{if(name==='m1-e1.json')throw new Error('disk full');};
  const reset=vi.fn();const props={dirHandleRef:{current:dir},selectedAudio:'a.wav',transcript:transcript('最后修改'),metadata,reset,setMetadata:noop,setSelectedSegmentId:noop,setHasLoadedTranscript:noop,setViewingOriginal:noop,viewingOriginal:false,setImportRepairs:noop,setProcessStatus:noop,setProcessMessage:noop};
  const ui=renderHook(()=>useVersions(props as any));act(()=>ui.result.current.applyManifest(manifest() as any));
  await act(async()=>{await ui.result.current.selectEdit('m1','e2').catch(noop);});
  expect(reset).not.toHaveBeenCalled();
});
test('R06 duplicate must include latest in-memory edits',async()=>{
  const {dir}=disk();const reset=vi.fn();const props={dirHandleRef:{current:dir},selectedAudio:'a.wav',transcript:transcript('最后修改'),metadata,reset,setMetadata:noop,setSelectedSegmentId:noop,setHasLoadedTranscript:noop,setViewingOriginal:noop,viewingOriginal:false,setImportRepairs:noop,setProcessStatus:noop,setProcessMessage:noop};
  const ui=renderHook(()=>useVersions(props as any));act(()=>ui.result.current.applyManifest(manifest() as any));
  await act(async()=>{await ui.result.current.duplicateEdit('m1');});
  act(()=>ui.result.current.setNamingValue('人工校订'));
  await act(async()=>{await ui.result.current.confirmNaming();});
  expect(reset.mock.calls[0][0].segments[0].text).toBe('最后修改');
});
test('R07 split must relocate highlights to the correct half',()=>{
  const seg={...transcript().segments[0],highlights:[{id:'h1',start:2,end:4}]};
  const halves=splitSegmentAt([seg],'s1',2,undefined,'s2')!;
  expect(halves.map(s=>(s.highlights??[]).map(h=>s.text.slice(h.start,h.end)))).toEqual([[],['丙丁']]);
});
test('R08 merge must retain next segment highlights',()=>{
  const a={...transcript('甲乙').segments[0],end:2};const b={...transcript('丙丁').segments[0],id:'s2',start:2,highlights:[{id:'h1',start:0,end:2}]};
  const merged=mergeSegmentWithNext([a,b],'s1')![0];
  expect((merged.highlights??[]).map(h=>merged.text.slice(h.start,h.end))).toEqual(['丙丁']);
});
test('R09 replace all must keep word alignment and highlight anchors',()=>{
  const initial={...transcript(),segments:[{...transcript().segments[0],highlights:[{id:'h',start:2,end:4}]}]};
  const ui=renderHook(()=>{const [t,setT]=useState(initial);const api=useFindReplace({transcript:t,viewingOriginal:false,mutateTranscript:(f)=>setT(f as any),setSelectedSegmentId:noop,textareaRefs:{current:new Map()}});return{t,api};});
  act(()=>{ui.result.current.api.setFindQuery('甲');ui.result.current.api.setReplaceValue('甲甲');});
  act(()=>ui.result.current.api.replaceAll());
  const s=ui.result.current.t.segments[0];
  expect({words:s.words.map(w=>w.text).join(''),marked:s.text.slice(s.highlights[0].start,s.highlights[0].end)}).toEqual({words:'甲甲乙丙丁',marked:'丙丁'});
});
test('R10 undo inside find field must not undo transcript history',()=>{
  const undo=vi.fn();renderHook(()=>useShortcuts({viewingOriginal:false,removeSegment:noop,transcript:transcript(),findOpen:true,effectiveSelectedSegmentId:'s1',audioUrl:'',skipSeconds:3,audioRef:{current:null},performUndo:undo,performRedo:noop,setFindOpen:noop,setShowReplace:noop,setExportMenuOpen:noop,togglePlayFromCursor:noop,handleOpenFolder:noop,togglePlayback:noop,seekTo:noop,mergeWithNext:noop,setSelectedSegmentId:noop}));
  const input=document.createElement('input');input.id='find-input';document.body.appendChild(input);input.focus();fireEvent.keyDown(input,{key:'z',metaKey:true});input.remove();
  expect(undo).not.toHaveBeenCalled();
});
test('R11 missing target edit must reject save instead of reporting success',async()=>{
  const {dir}=disk();await expect(saveActiveEdit(dir as any,'a.wav','m1','missing',edited('新稿') as any)).rejects.toThrow();
});
test('R12 save finishing after version switch must preserve latest active edit',async()=>{
  const {dir,child}=disk();let release!:()=>void;let entered!:()=>void;const blocked=new Promise<void>(r=>release=r);const started=new Promise<void>(r=>entered=r);
  child.beforeWrite=async(name)=>{if(name==='m1-e1.json'){entered();await blocked;}};
  const pending=saveActiveEdit(dir as any,'a.wav','m1','e1',edited('新稿') as any);await started;
  const switching=persistActiveModel(dir as any,'a.wav','m1','e2');release();await Promise.all([pending,switching]);
  expect(JSON.parse(child.files.get('manifest.json')!).models[0].activeEditId).toBe('e2');
});
test('R13 readonly file access must not misreport valid manifest as absent',async()=>{
  const {dir,child}=disk();child.beforeWrite=async()=>{throw new DOMException('permission revoked','NotAllowedError');};
  const value=await readManifest(dir as any,'a.wav');expect(value?.activeModelId).toBe('m1');
});
test('C01 control: original-only mode must not autosave',async()=>{
  const {dir,child}=disk();renderHook(()=>usePersistence(persistenceDeps(dir,transcript('原稿'),{viewingOriginal:true})));
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(JSON.parse(child.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('磁盘旧稿');
});
test('C02 control: normal save and reload round-trip',async()=>{
  const {dir}=disk();await saveActiveEdit(dir as any,'a.wav','m1','e1',edited('正常保存') as any);
  expect((await readEdited(dir as any,'a.wav'))?.transcript.segments[0].text).toBe('正常保存');
});

test('R17 legacy migration must preserve distinct source files for each model',async()=>{
  const dir=new MemoryDir();const rootManifest={schemaVersion:2,audio:'a.wav',activeModelId:'m1',models:[
    {id:'m1',engine:'engineA',activeEditId:'e1',edits:[{id:'e1',file:'source-A.json',updated_at:''}]},
    {id:'m2',engine:'engineB',activeEditId:'e1',edits:[{id:'e1',file:'source-B.json',updated_at:''}]},
  ]};
  dir.files.set('manifest.json',JSON.stringify(rootManifest));dir.files.set('source-A.json',JSON.stringify(edited('A独有内容')));dir.files.set('source-B.json',JSON.stringify(edited('B独有内容')));
  const migrated=await readManifest(dir as any,'a.wav');
  const tdir=dir.dirs.get('a.transcript')!;
  const texts=migrated!.models.map(m=>JSON.parse(tdir.files.get(m.edits[0].file)!).transcript.segments[0].text);
  expect(texts).toEqual(['A独有内容','B独有内容']);
});

test('explicit save flushes the newest textarea draft before a navigation', async () => {
  const {dir,child}=disk();
  let persist:any;
  function Editor() {
    const [t,setT]=useState(transcript('甲'));
    persist=usePersistence(persistenceDeps(dir,t));
    return <SegmentTextArea segmentId="s1" value={t.segments[0].text} registry={{current:new Map()}} ariaLabel="正文" onFocus={noop} onBlur={noop} onClick={noop} onKeyDown={noop}
      onChange={text=>setT(current=>({...current,segments:[{...current.segments[0],text}]}))}/>;
  }
  const ui=render(<Editor/>);
  writeEditorText(ui.getByRole('textbox'), '甲乙最后一字'); fireEvent.input(ui.getByRole('textbox'));
  await act(async()=>{await persist.flushPendingSave();});
  expect(JSON.parse(child.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('甲乙最后一字');
});

test('composition keystrokes do not split the transcript', () => {
  const keydown=vi.fn();
  const ui=render(<SegmentTextArea segmentId="s1" value="甲" registry={{current:new Map()}} ariaLabel="正文" onFocus={noop} onBlur={noop} onClick={noop} onKeyDown={keydown} onChange={noop}/>);
  fireEvent.keyDown(ui.getByRole('textbox'),{key:'Enter',metaKey:true,isComposing:true,keyCode:229});
  expect(keydown).not.toHaveBeenCalled();
});

test('corrupt manifest is reported without overwriting its source', async () => {
  const {dir,child}=disk();child.files.set('manifest.json','{broken');
  await expect(readManifest(dir as any,'a.wav')).rejects.toThrow();
  expect(child.files.get('manifest.json')).toBe('{broken');
});

test('legacy migration leaves original files available for recovery', async () => {
  const dir=new MemoryDir();
  dir.files.set('manifest.json',JSON.stringify(manifest()));
  dir.files.set('m1-e1.json',JSON.stringify(edited('第一稿')));
  dir.files.set('m1-e2.json',JSON.stringify(edited('第二稿')));
  const before=new Map(dir.files);
  await readManifest(dir as any,'a.wav');
  expect(dir.files).toEqual(before);
});

test('rename without move preserves audio, all versions and nested review assets', async () => {
  const {dir,child}=disk();dir.files.set('a.wav','audio bytes');
  child.files.set('review.json','{"draft":"保留批注"}');
  const nested=await child.getDirectoryHandle('assets',{create:true});nested.files.set('notes.txt','备注');
  const before=JSON.parse(child.files.get('m1-e2.json')!);
  await expect(renameAudio(dir as any,'a.wav','新标题')).resolves.toBe('新标题.wav');
  expect(dir.files.get('新标题.wav')).toBe('audio bytes');expect(dir.files.has('a.wav')).toBe(false);
  expect(dir.dirs.has('a.transcript')).toBe(false);
  const target=dir.dirs.get('新标题.transcript')!;
  expect(JSON.parse(target.files.get('manifest.json')!).audio).toBe('新标题.wav');
  for(const name of ['m1-e1.json','m1-e2.json']) expect(JSON.parse(target.files.get(name)!).transcript.audio.filename).toBe('新标题.wav');
  expect(JSON.parse(target.files.get('m1-e2.json')!).transcript.segments).toEqual(before.transcript.segments);
  expect(target.files.get('review.json')).toBe('{"draft":"保留批注"}');
  expect(target.dirs.get('assets')!.files.get('notes.txt')).toBe('备注');
  expect((await readEdited(dir as any,'新标题.wav'))?.transcript.audio.filename).toBe('新标题.wav');
});

test('copy failure leaves source files intact and removes incomplete destination', async () => {
  const {dir,child}=disk();dir.files.set('a.wav','audio bytes');const before=new Map(child.files);
  dir.beforeWrite=async name=>{if(name==='new.wav')throw new Error('disk full');};
  await expect(renameAudio(dir as any,'a.wav','new')).rejects.toThrow('disk full');
  expect(child.files).toEqual(before);expect(dir.files.get('a.wav')).toBe('audio bytes');
  expect(dir.files.has('new.wav')).toBe(false);expect(dir.dirs.has('new.transcript')).toBe(false);
});

test('partial source directory deletion restores every original before removing copies', async () => {
  const {dir,child}=disk();dir.files.set('a.wav','audio bytes');const before=new Map(child.files);
  const remove=dir.removeEntry.bind(dir);let fail=true;
  dir.removeEntry=async name=>{if(name==='a.transcript'&&fail){fail=false;child.files.delete('m1-e1.json');throw new Error('delete failed');}await remove(name);};
  await expect(renameAudio(dir as any,'a.wav','new')).rejects.toThrow('delete failed');
  expect(new Map([...child.files].filter(([name])=>name!=='manifest.json.bak'))).toEqual(before);expect(dir.files.get('a.wav')).toBe('audio bytes');
  expect(dir.files.has('new.wav')).toBe(false);expect(dir.dirs.has('new.transcript')).toBe(false);
});

test('same-size copy corruption is detected before deleting originals', async () => {
  const {dir,child}=disk();dir.files.set('a.wav','audio');const before=new Map(child.files);
  const getFile=dir.getFileHandle.bind(dir);
  dir.getFileHandle=async(name:string,opts:any)=>{
    const handle=await getFile(name,opts);
    if(name==='new.wav')handle.getFile=async()=>new NodeBlob(['wrong']);
    return handle;
  };
  await expect(renameAudio(dir as any,'a.wav','new')).rejects.toThrow('校验失败');
  expect(dir.files.get('a.wav')).toBe('audio');expect(child.files).toEqual(before);
  expect(dir.files.has('new.wav')).toBe(false);
});

test('failed restoration retains the complete destination for recovery', async () => {
  const {dir,child}=disk();dir.files.set('a.wav','audio');
  const remove=dir.removeEntry.bind(dir);
  dir.removeEntry=async name=>{
    if(name==='a.transcript'){
      child.files.delete('m1-e1.json');child.beforeWrite=async()=>{throw new Error('restore failed');};
      throw new Error('delete failed');
    }
    await remove(name);
  };
  await expect(renameAudio(dir as any,'a.wav','new')).rejects.toThrow('可用的文件副本仍然保留');
  expect(dir.files.get('new.wav')).toBe('audio');
  const target=dir.dirs.get('new.transcript')!;
  expect(JSON.parse(target.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('磁盘旧稿');
  expect(target.files.has('m1-e2.json')).toBe(true);
});

test('existing rename destination is never overwritten', async () => {
  const {dir}=disk();dir.files.set('a.wav','audio');dir.files.set('new.wav','other');
  await expect(renameAudio(dir as any,'a.wav','new')).rejects.toThrow('目标位置已存在同名文件');
  expect(dir.files.get('new.wav')).toBe('other');expect(dir.files.get('a.wav')).toBe('audio');
});

test('navigation save includes typing that happens while the disk is busy', async () => {
  const {dir,child}=disk();let persist:any;
  let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
  let first=true;
  child.beforeWrite=async name=>{if(name==='m1-e1.json' && first){first=false;entered();await blocked;}};
  function Editor() {
    const [t,setT]=useState(transcript('甲'));
    persist=usePersistence(persistenceDeps(dir,t));
    return <SegmentTextArea segmentId="s1" value={t.segments[0].text} registry={{current:new Map()}} ariaLabel="正文" onFocus={noop} onBlur={noop} onClick={noop} onKeyDown={noop}
      onChange={text=>setT(current=>({...current,segments:[{...current.segments[0],text}]}))}/>;
  }
  const ui=render(<Editor/>);let saving!:Promise<void>;
  await act(async()=>{saving=persist.flushPendingSave();await started;});
  writeEditorText(ui.getByRole('textbox'), '保存中继续输入'); fireEvent.input(ui.getByRole('textbox'));
  await act(async()=>{release();await saving;});
  expect(JSON.parse(child.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('保存中继续输入');
});

test('saved toast expires but a subsequent failure cancels its timeout',()=>{
  const {dir}=disk();const props=persistenceDeps(dir,transcript(),{saveStatus:'loading',hasLoadedTranscript:false});
  const ui=renderHook((p)=>usePersistence(p),{initialProps:props});
  expect(ui.result.current.saveToast).toBeNull();
  ui.rerender({...props,saveStatus:'saving'});
  ui.rerender({...props,saveStatus:'saved'});
  expect(ui.result.current.saveToast?.kind).toBe('ok');
  act(()=>vi.advanceTimersByTime(2200));
  expect(ui.result.current.saveToast).toBeNull();
  ui.rerender({...props,saveStatus:'saving'});
  ui.rerender({...props,saveStatus:'saved'});
  ui.rerender({...props,saveStatus:'error'});
  act(()=>vi.advanceTimersByTime(3000));
  expect(ui.result.current.saveToast?.kind).toBe('error');
});

test('custom speaker color survives saving and reopening the modification', async () => {
  const {dir}=disk();const data=edited('保留颜色');
  const colored={...data,transcript:{...data.transcript,speakers:[{...data.transcript.speakers[0],color:'#246890'}]}};
  await saveActiveEdit(dir as any,'a.wav','m1','e1',colored as any);
  expect((await readEdited(dir as any,'a.wav'))?.transcript.speakers[0].color).toBe('#246890');
});

test('transcription starts with a readable original file and no automatic modification', async () => {
  const dir=new MemoryDir();dir.files.set('访谈.wav','audio');
  const result=await createModel(dir as any,'访谈.wav',{engine:'test',transcript:transcript(),original:transcript(),originalOnly:true});
  expect(result.model.edits).toEqual([]);
  expect(result.model.original).toBe('访谈_原始转录稿.json');
  expect((await readEdited(dir as any,'访谈.wav'))?.metadata.title).toBe('访谈');
  const version=await createEdit(dir as any,'访谈.wav',result.model.id,{fromOriginal:true,label:'人工校订'});
  expect(version.edit.file).toBe('访谈_人工校订.json');
  expect(version.edited.metadata.title).toBe('访谈');
});

test('renaming a version preserves the title and contents and updates its local filename', async () => {
  const {dir,child}=disk();
  const result=await renameEditLabel(dir as any,'a.wav','m1','e1','定稿');
  expect(result.models[0].edits[0].file).toBe('a_定稿.json');
  const data=JSON.parse(child.files.get('a_定稿.json')!);
  expect(data.metadata.title).toBe('a');
  expect(data.transcript.segments[0].text).toBe('磁盘旧稿');
  expect(child.files.has('m1-e1.json')).toBe(false);
});

test('changing interview title synchronizes audio, every version, and subsequent saves', async () => {
  const {dir}=disk();dir.files.set('a.wav','audio');
  await renameEditLabel(dir as any,'a.wav','m1','e1','定稿');
  await renameAudio(dir as any,'a.wav','访谈新标题','访谈新标题');
  const manifest=await readManifest(dir as any,'访谈新标题.wav');
  expect(manifest?.title).toBe('访谈新标题');
  const child=dir.dirs.get('访谈新标题.transcript')!;
  expect(child.files.has('访谈新标题_定稿.json')).toBe(true);
  expect(child.files.has('访谈新标题_修改稿 v2.json')).toBe(true);
  for(const e of manifest!.models[0].edits) expect(JSON.parse(child.files.get(e.file)!).metadata.title).toBe('访谈新标题');
  await saveActiveEdit(dir as any,'访谈新标题.wav','m1','e1',edited('继续编辑') as any);
  expect((await readEdited(dir as any,'访谈新标题.wav'))?.metadata.title).toBe('访谈新标题');
});

test('conflicting custom names never overwrite an existing version', async () => {
  const {dir,child}=disk();child.files.set('a_定稿.json','external');const before=new Map(child.files);
  await expect(renameEditLabel(dir as any,'a.wav','m1','e1','定稿')).rejects.toThrow('名称重复');
  expect(child.files).toEqual(before);
});

test('failed filename update restores source files and manifest', async () => {
  const {dir,child}=disk();const before=new Map(child.files);let fail=true;
  child.beforeWrite=async name=>{if(name==='manifest.json'&&fail){fail=false;throw new Error('disk error');}};
  await expect(renameEditLabel(dir as any,'a.wav','m1','e1','定稿')).rejects.toThrow('disk error');
  expect(child.files.get('manifest.json.bak')).toBe(before.get('manifest.json'));
  expect(new Map([...child.files].filter(([name])=>name!=='manifest.json.bak'))).toEqual(before);
});

test('opening or cancelling the new version dialog does not create an unnamed file', async () => {
  const {dir,child}=disk();const before=new Map(child.files);
  const props={dirHandleRef:{current:dir},selectedAudio:'a.wav',transcript:transcript(),metadata,
    reset:vi.fn(),setMetadata:vi.fn(),setSelectedSegmentId:noop,setHasLoadedTranscript:noop,
    setViewingOriginal:noop,viewingOriginal:true,setImportRepairs:noop,setProcessStatus:noop,setProcessMessage:noop};
  const ui=renderHook(()=>useVersions(props as any));
  act(()=>ui.result.current.applyManifest(manifest() as any));
  await act(async()=>{await ui.result.current.forkFromOriginal('m1');});
  expect(ui.result.current.namingValue).toBe('');expect(child.files).toEqual(before);
  await act(async()=>{await ui.result.current.confirmNaming();});
  expect(ui.result.current.namingError).toContain('请输入版本名称');expect(child.files).toEqual(before);
  act(()=>ui.result.current.setNamingOpen(false));expect(child.files).toEqual(before);
});

test('title rename with partially deleted sources restores the old filenames', async () => {
  const {dir,child}=disk();dir.files.set('a.wav','audio');
  const before=Array.from(child.files.keys()).sort();const remove=dir.removeEntry.bind(dir);let fail=true;
  dir.removeEntry=async name=>{if(name==='a.transcript'&&fail){fail=false;child.files.delete('m1-e1.json');throw new Error('delete failed');}await remove(name);};
  await expect(renameAudio(dir as any,'a.wav','新标题','新标题')).rejects.toThrow('delete failed');
  expect(Array.from(child.files.keys()).filter(name=>name!=='manifest.json.bak').sort()).toEqual(before);
  expect(dir.files.get('a.wav')).toBe('audio');expect(dir.dirs.has('新标题.transcript')).toBe(false);
  expect(JSON.parse(child.files.get('manifest.json')!).audio).toBe('a.wav');
});


test.each(['edit', 'original'])('failed manifest update preserves the %s file during deletion', async kind => {
  const {dir, child} = disk();
  const stored = manifest() as any;
  stored.models[0].original = 'original.json';
  child.files.set('original.json', JSON.stringify({kind:'te-original',transcript:transcript('原始内容')}));
  child.files.set('manifest.json', JSON.stringify(stored));
  const previous = [...child.files];
  child.beforeWrite = async name => { if (name === 'manifest.json') throw new Error('disk full'); };
  await expect(kind === 'edit' ? removeEdit(dir as any,'a.wav','m1','e1') : removeModelOriginal(dir as any,'a.wav','m1')).rejects.toThrow('disk full');
  expect(child.files.get('manifest.json.bak')).toBe(new Map(previous).get('manifest.json'));
  expect([...child.files].filter(([name])=>name!=='manifest.json.bak')).toEqual(previous);
});
test('failed file deletion restores the version manifest', async () => {
  const {dir, child} = disk(); const previous = [...child.files];
  child.removeEntry = async () => { throw new Error('permission denied'); };
  await expect(removeEdit(dir as any,'a.wav','m1','e1')).rejects.toThrow('permission denied');
  expect(child.files.get('manifest.json.bak')).toBe(new Map(previous).get('manifest.json'));
  expect([...child.files].filter(([name])=>name!=='manifest.json.bak')).toEqual(previous);
});

test('a failed new-version manifest write can be retried with the same name', async () => {
  const {dir, child}=disk();const previous=[...child.files];
  child.beforeWrite=async name=>{if(name==='manifest.json')throw new Error('disk full');};
  await expect(createEdit(dir as any,'a.wav','m1',{label:'新稿'})).rejects.toThrow('disk full');
  expect(child.files.get('manifest.json.bak')).toBe(new Map(previous).get('manifest.json'));
  expect([...child.files].filter(([name])=>name!=='manifest.json.bak')).toEqual(previous);
  child.beforeWrite=undefined;
  const result=await createEdit(dir as any,'a.wav','m1',{label:'新稿'});
  expect(result.edited.transcript.segments[0].text).toBe('磁盘旧稿');
});

test('local comparison confirmations survive saving without changing the manuscript', async () => {
  const {applyComparisonDecision,comparisonParts,comparisonReviewKey}=await import('../src/lib/comparisonReview');
  const {dir}=disk();const original=transcript('磁盘旧稿');
  const before='磁盘原稿',part=comparisonParts(before,original.segments[0].text).find(p=>p.changed)!;
  const accepted=applyComparisonDecision(original,{base:'m1:e2',segmentId:'s1',before,text:original.segments[0].text,key:part.key,choice:'accept'});
  await saveActiveEdit(dir as any,'a.wav','m1','e1',{...edited(''),transcript:accepted} as any);
  const loaded=await readEdited(dir as any,'a.wav');
  expect(loaded?.transcript.segments).toEqual(original.segments);
  expect(loaded?.transcript.comparisonReviews?.[comparisonReviewKey('m1:e2','s1')].accepted).toEqual([part.key]);
});

test('original coordinates persist across model creation, AI version creation and reopening without rewriting originals', async()=>{
 const {dir,child}=disk();
 const original=transcript('甲乙丙');
 original.segments[0].words=Array.from('甲乙丙',(text,i)=>({text,start:10+i,end:11+i}));
 const created=await createModel(dir as any,'a.wav',{engine:'test',transcript:original,original});
 const rawOriginal=child.files.get(created.model.original!);
 const loaded=await readEdited(dir as any,'a.wav');
 const baseline=loaded!.transcript;
 expect(baseline.segments[0].words![1].origins![0].model).toBe(created.model.id);
 const next=applyAISuggestions(baseline,baseline,[{id:baseline.segments[0].id,text:'甲新丙',reason:'纠错'}]);
 const version=await createEdit(dir as any,'a.wav',created.model.id,{srcEditId:created.model.activeEditId,reviewed:{baseline,transcript:next,label:'来源验证'}});
 const reopened=await readEdited(dir as any,'a.wav');
 expect(reopened!.transcript.segments[0].words).toEqual(next.segments[0].words);
 expect(version.edited.transcript.segments[0].words![1]).toMatchObject({start:11,end:12,timing:'replacement'});
 expect(child.files.get(created.model.original!)).toBe(rawOriginal);
});

test('loading a legacy edit backfills original coordinates only in memory and retains them on save',async()=>{
 const {dir,child}=disk(),m=manifest();m.models[0].original='original.json';
 const original=transcript('甲乙丙');original.segments[0].words=Array.from('甲乙丙',(text,i)=>({text,start:20+i,end:21+i}));
 child.files.set('manifest.json',JSON.stringify(m));child.files.set('original.json',JSON.stringify({transcript:original}));
 child.files.set('m1-e1.json',JSON.stringify({...edited('甲丙'),transcript:{...original,segments:[{...original.segments[0],text:'甲丙',words:undefined}]}}));
 const old=child.files.get('m1-e1.json'),rawOriginal=child.files.get('original.json');
 const loaded=await readEdited(dir as any,'a.wav');
 expect(loaded!.transcript.segments[0].words![1]).toMatchObject({text:'丙',start:22});
 expect(child.files.get('m1-e1.json')).toBe(old);
 await saveActiveEdit(dir as any,'a.wav','m1','e1',loaded!);
 expect((await readEdited(dir as any,'a.wav'))!.transcript).toEqual(loaded!.transcript);
 expect(child.files.get('original.json')).toBe(rawOriginal);
});
test('undo and redo restore the full original-coordinate metadata',async()=>{
 const {dir}=disk(),original=transcript('甲乙丙');
 original.segments[0].words=Array.from('甲乙丙',(text,i)=>({text,start:i,end:i+1}));
 const created=await createModel(dir as any,'a.wav',{engine:'test',transcript:original,original});
 const before=created.edited.transcript;
 const after=applyAISuggestions(before,before,[{id:before.segments[0].id,text:'甲新丙',reason:'纠错'}]);
 const {result}=renderHook(()=>useTranscriptHistory<typeof before>());
 act(()=>result.current.reset(before));act(()=>result.current.commit(()=>after));
 act(()=>result.current.undo());expect(result.current.transcript).toEqual(before);
 act(()=>result.current.redo());expect(result.current.transcript).toEqual(after);
});


test.each(['manifest.crswap', 'manifest.json.bak'])('missing index opens from validated %s without changing files', async candidate => {
  const {dir,child}=disk();dir.files.set('a.wav','synthetic audio');
  child.files.set(candidate,child.files.get('manifest.json')!);child.files.delete('manifest.json');
  const before=[...child.files];
  expect((await listAudioFiles(dir as any))[0].hasOriginal).toBe(true);
  expect((await readEdited(dir as any,'a.wav'))?.transcript.segments[0].text).toBe('磁盘旧稿');
  expect([...child.files]).toEqual(before);
});
test('missing all indexes with surviving manuscripts refuses to treat them as untranscribed', async () => {
  const {dir,child}=disk();child.files.delete('manifest.json');const before=[...child.files];
  await expect(readEdited(dir as any,'a.wav')).rejects.toThrow('索引缺失');
  expect([...child.files]).toEqual(before);
});
test.each([false,true])('saved body survives index close failure and can be retried (rollback fails: %s)', async rollbackFails => {
  const {dir,child}=disk();const previous=child.files.get('manifest.json');let calls=0;
  child.beforeClose=async(name,text)=>{
    if(name==='manifest.json' && (++calls===1 || rollbackFails)){
      child.files.delete(name);child.files.set('manifest.crswap',text);throw new Error('close interrupted');
    }
  };
  await expect(saveActiveEdit(dir as any,'a.wav','m1','e1',edited('最后修改') as any)).rejects.toThrow('索引更新失败');
  expect(child.files.get('manifest.json.bak')).toBe(previous);
  expect((await readEdited(dir as any,'a.wav'))?.transcript.segments[0].text).toBe('最后修改');
  child.beforeClose=undefined;
  await saveActiveEdit(dir as any,'a.wav','m1','e1',edited('重试成功') as any);
  expect(child.files.has('manifest.json')).toBe(true);
  expect((await readEdited(dir as any,'a.wav'))?.transcript.segments[0].text).toBe('重试成功');
});
test('save failure toast reports index failure instead of blaming folder permissions', async () => {
  const {dir,child}=disk();child.beforeWrite=async name=>{if(name==='manifest.json')throw new Error('close interrupted');};
  const props=persistenceDeps(dir,transcript('保留当前修改'));
  const ui=renderHook(()=>usePersistence(props));
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(ui.result.current.saveToast?.text).toContain('索引更新失败');
  expect(ui.result.current.saveToast?.text).toContain('保持当前窗口');
  expect(ui.result.current.saveToast?.text).not.toContain('权限');
  expect(props.setSaveStatus).toHaveBeenLastCalledWith('error');
});


test('original-only interview details autosave without touching the source or creating a revision', async () => {
  const {dir,child}=disk();const m=manifest();
  Object.assign(m.models[0],{original:'original.json',edits:[],activeEditId:''});
  child.files.set('manifest.json',JSON.stringify(m));const raw=JSON.stringify({transcript:transcript('不可变原稿')});child.files.set('original.json',raw);
  const details={...metadata,recorded_at:'2026-09-20T13:00:00',location:'北京',topics:['访谈']};
  const props=persistenceDeps(dir,transcript('不可变原稿'),{metadata:details,models:m.models,viewingOriginal:true});
  const ui=renderHook(()=>usePersistence(props));
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(child.files.get('original.json')).toBe(raw);
  expect((await readManifest(dir as any,'a.wav'))?.models[0].edits).toEqual([]);
  expect((await readEdited(dir as any,'a.wav'))?.metadata).toMatchObject({location:'北京',topics:['访谈'],recorded_at:'2026-09-20T13:00:00'});
  await act(async()=>{await ui.result.current.flushPendingSave();});
  expect(props.setSaveStatus).toHaveBeenLastCalledWith('saved');
});
test('shared details survive version switching and copying while original and other manuscripts stay intact',async()=>{
  const {dir,child}=disk();const before=child.files.get('m1-e2.json');
  await saveInterviewDetails(dir as any,'a.wav',{...metadata,recorded_at:'2026-09-20',location:'上海',topics:['第一轮']});
  const other=await readModelEdit(dir as any,'a.wav','m1','e2');
  expect(other?.metadata.location).toBe('上海');expect(child.files.get('m1-e2.json')).toBe(before);
  const copied=await createEdit(dir as any,'a.wav','m1',{srcEditId:'e2',label:'新版本'});
  expect(copied.edited.metadata.topics).toEqual(['第一轮']);
  expect(other?.metadata.recorded_at).toBe('2026-09-20');
  expect(copied.edited.metadata.recorded_at).toBe('2026-09-20');
  await saveActiveEdit(dir as any,'a.wav','m1','e2',{...other!,metadata:{...other!.metadata,location:'广州'}});
  expect((await readModelEdit(dir as any,'a.wav','m1','e1'))?.metadata.location).toBe('广州');
});
test('failed original metadata save remains retryable and never writes transcript text',async()=>{
  const {dir,child}=disk();const before=child.files.get('m1-e1.json');
  child.beforeWrite=async name=>{if(name==='manifest.json')throw new Error('disk full');};
  const props=persistenceDeps(dir,transcript('不应覆盖修改稿'),{viewingOriginal:true,metadata:{...metadata,location:'保留修改'}});
  const ui=renderHook(()=>usePersistence(props));
  await act(async()=>{await expect(ui.result.current.flushPendingSave()).rejects.toThrow('disk full');});
  expect(child.files.get('m1-e1.json')).toBe(before);
  child.beforeWrite=undefined;
  await act(async()=>{await ui.result.current.flushPendingSave();});
  expect((await readEdited(dir as any,'a.wav'))?.metadata.location).toBe('保留修改');
});
test('unchanged saved content is not rewritten on repeated flushes, but new edits are saved',async()=>{
 const {dir,child}=disk();const write=vi.fn();child.beforeWrite=async(name)=>{write(name);};
 const initial=persistenceDeps(dir,transcript('磁盘旧稿'));
 const ui=renderHook(props=>usePersistence(props),{initialProps:initial});
 await act(async()=>{await ui.result.current.flushPendingSave();});
 write.mockClear();
 await act(async()=>{await ui.result.current.flushPendingSave();await ui.result.current.flushPendingSave();});
 expect(write).not.toHaveBeenCalled();
 ui.rerender({...initial,transcript:transcript('新修改')});
 await act(async()=>{await ui.result.current.flushPendingSave();});
 expect(write).toHaveBeenCalled();expect(JSON.parse(child.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('新修改');
});
test('AI editing from original creates a separate version and retains original comparison identity',async()=>{
 const {dir,child}=disk();const m=manifest();m.models[0].original='original.json';
 child.files.set('manifest.json',JSON.stringify(m));const baseline=transcript('磁盘旧稿');
 const raw=JSON.stringify({transcript:baseline});child.files.set('original.json',raw);
 const setViewingOriginal=vi.fn();const reset=vi.fn();
 const ui=renderHook(()=>useVersions({dirHandleRef:{current:dir as any},selectedAudio:'a.wav',transcript:baseline,metadata,
 reset,beforeChange:async()=>{},viewingOriginal:true,setMetadata:noop,setSelectedSegmentId:noop,setHasLoadedTranscript:noop,setViewingOriginal,setImportRepairs:noop,setProcessStatus:noop,setProcessMessage:noop}));
 act(()=>ui.result.current.applyManifest(m));
 await act(async()=>{await ui.result.current.createAIEdit(baseline,[{id:'s1',text:'整理稿',reason:'整理'}],'原稿 AI');});
 expect(child.files.get('original.json')).toBe(raw);
 expect(ui.result.current.models[0].edits.at(-1)?.comparisonBaseId).toBe('original');
 expect(setViewingOriginal).toHaveBeenCalledWith(false);expect(reset.mock.calls[0][0].segments[0].text).toBe('整理稿');
});

test('manual Save persists the active manuscript without confirming or closing the window',async()=>{
 const {dir,child}=disk();const close=vi.spyOn(window,'close').mockImplementation(()=>{});const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
 const ui=renderHook(()=>usePersistence(persistenceDeps(dir,transcript('手动保存验收'))));
 await act(async()=>{await ui.result.current.handleSave();});
 expect(JSON.parse(child.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('手动保存验收');
 expect(close).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();expect(ui.result.current.saveToast?.text).toBe('当前转录稿已保存到本地');close.mockRestore();confirm.mockRestore();
});
test('Cmd+S prevents browser Save Page and writes the current manuscript',async()=>{
 const {dir,child}=disk();renderHook(()=>usePersistence(persistenceDeps(dir,transcript('快捷键保存验收'))));
 const event=new KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true,cancelable:true});
 await act(async()=>{window.dispatchEvent(event);await Promise.resolve();});
 expect(event.defaultPrevented).toBe(true);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(JSON.parse(child.files.get('m1-e1.json')!).transcript.segments[0].text).toBe('快捷键保存验收');
});
