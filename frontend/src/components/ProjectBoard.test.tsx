// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ProjectBoard } from './ProjectBoard';
import * as local from '../localStore';
import type { OpenProject } from '../lib/projectStore';
import type { TranscriptModel } from '../types';
vi.mock('../localStore',async original=>({...await original<typeof local>(),readManifest:vi.fn(),readModelEdit:vi.fn(),readModelOriginal:vi.fn(),createModel:vi.fn(),setModelOriginal:vi.fn(),renameEditLabel:vi.fn()}));
vi.mock('../lib/projectStore',async original=>({...await original<typeof import('../lib/projectStore')>(),mutateProjectManuscript:vi.fn(async(_p,work)=>work()),checkProjectMedia:vi.fn(async()=>new File(['synthetic'],'audio.wav')),recordingDirectory:vi.fn(async()=>({}))}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it.each([false,true])('opens names, removes previews, and copies the current document (original=%s)',async original=>{
 const model={id:'m',label:'采访稿',engine:'test',sourceKind:'import',designatedOriginal:original,edits:original?[]:[{id:'e2'}],activeEditId:original?'':'e2'} as TranscriptModel;
 const copy={...model,id:'copy',label:'采访稿 副本',designatedOriginal:false,edits:[{id:'e1'}],activeEditId:'e2'} as TranscriptModel;
 vi.mocked(local.readManifest).mockResolvedValue({models:[model]} as never);
 const transcript={segments:[{id:'1',text:'保留原内容'}]};
 vi.mocked(local.readModelOriginal).mockResolvedValue({transcript} as never);
 vi.mocked(local.readModelEdit).mockResolvedValue({transcript,metadata:{title:'采访'}} as never);
 vi.mocked(local.createModel).mockResolvedValue({model:copy,manifest:{models:[model,copy]}} as never);
 const recording={id:'r',file:'source.m4a',name:'音频.m4a',storage:'copy'};
 const project={data:{id:'p',interviews:[{id:'s',title:'访谈',recordings:[recording]}]}} as OpenProject;
 const open=vi.fn();
 render(<ProjectBoard project={project} selected="s" busy={false} select={()=>{}} save={()=>{}} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={open} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'打开 转录稿 采访稿'}));expect(open).toHaveBeenCalledWith(...(original?[recording,'m']:[recording,'m','e2']));
 expect(screen.queryByRole('button',{name:/预览|试听|^查看$|^编辑$/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'将 采访稿 复制为编辑稿'}));
 await waitFor(()=>expect(local.createModel).toHaveBeenCalled());
 expect(vi.mocked(local.createModel).mock.calls[0][2]).toMatchObject({transcript,label:'采访稿 副本',setActive:false});
 expect(vi.mocked(local.createModel).mock.calls[0][2].designatedOriginal).toBeUndefined();
 expect((await screen.findByRole('textbox',{name:'重命名 转录稿'}) as HTMLInputElement).value).toBe('采访稿 副本');
 expect(screen.getByRole('button',{name:'打开 转录稿 采访稿'})).toBeTruthy();
});

it('confirms read-only designation and allows removing the marker',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
 const model={id:'m',label:'采访稿',engine:'test',sourceKind:'import',edits:[{id:'e1'}],activeEditId:'e1'} as TranscriptModel;
 vi.mocked(local.readManifest).mockResolvedValue({models:[model]} as never);
 vi.mocked(local.setModelOriginal).mockImplementation(async(_dir,_file,_id,value)=>({models:[{...model,designatedOriginal:value}]} as never));
 const recording={id:'r',file:'source.m4a',name:'音频.m4a',storage:'copy'};
 const project={data:{id:'p',interviews:[{id:'s',title:'访谈',recordings:[recording]}]}} as OpenProject;
 render(<ProjectBoard project={project} selected="s" busy={false} select={()=>{}} save={()=>{}} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={()=>{}} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'设为原始转录稿 采访稿'}));
 expect(screen.getByText(/这份转录稿将变为只读/)).toBeTruthy();
 expect(local.setModelOriginal).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'设为原始转录稿',hidden:true}));
 await waitFor(()=>expect(local.setModelOriginal).toHaveBeenLastCalledWith(expect.anything(),'source.m4a','m',true));
 fireEvent.click(await screen.findByRole('button',{name:'取消“原始转录稿”标记 采访稿'}));
 await waitFor(()=>expect(local.setModelOriginal).toHaveBeenLastCalledWith(expect.anything(),'source.m4a','m',false));
});

it('clears a failed manifest-read error when switching interviews',async()=>{
 const first={id:'first',title:'第一次访谈',recordings:[{id:'r1',file:'first.m4a',name:'第一段音频.m4a',storage:'copy'}]};
 const second={id:'second',title:'第二次访谈',recordings:[{id:'r2',file:'second.m4a',name:'第二段音频.m4a',storage:'copy'}]};
 const project={data:{id:'p',interviews:[first,second]}} as OpenProject;
 vi.mocked(local.readManifest).mockRejectedValueOnce(new Error('无法读取第一场次'));
 vi.mocked(local.readManifest).mockImplementationOnce(()=>new Promise(()=>{}));
 const view=render(<ProjectBoard project={project} selected="first" busy={false} select={()=>{}} save={()=>{}} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={()=>{}} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>);
 await screen.findByText('无法读取第一场次');
 view.rerender(<ProjectBoard project={project} selected="second" busy={false} select={()=>{}} save={()=>{}} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={()=>{}} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>);
 expect(screen.queryByText('无法读取第一场次')).toBeNull();
});

it('localizes a missing interview folder instead of showing the raw native error', async () => {
 const session={id:'s',title:'访谈',recordings:[{id:'r',file:'source.m4a',name:'音频.m4a',storage:'copy'}]};
 const project={data:{id:'p',interviews:[session]}} as OpenProject;
 vi.mocked((await import('../lib/projectStore')).recordingDirectory).mockRejectedValue(new DOMException('interviews does not exist','NotFoundError'));
 renderBoard(project);
 await screen.findByText('无法找到或访问项目中的场次文件夹。请通过“打开项目”重新选择完整的项目文件夹。');
 expect(screen.queryByText('interviews does not exist')).toBeNull();
});

it('shows the same folder error in English when the interface is English', async () => {
 const { setInterfaceLanguage } = await import('../i18n');
 const session={id:'s',title:'Interview',recordings:[{id:'r',file:'source.m4a',name:'audio.m4a',storage:'copy'}]};
 const project={data:{id:'p',interviews:[session]}} as OpenProject;
 try {
  await setInterfaceLanguage('en');
  vi.mocked((await import('../lib/projectStore')).recordingDirectory).mockRejectedValue(new DOMException('interviews does not exist','NotFoundError'));
  renderBoard(project);
  await screen.findByText("Couldn’t find or access this project’s session folder. Choose “Open project”, then select the complete project folder again.");
 } finally { await setInterfaceLanguage('zh-CN'); }
});

it('does not tell users to locate an external original for audio copied into the project', async () => {
 const session={id:'s',title:'访谈',recordings:[{id:'r',file:'source.m4a',name:'音频.m4a',storage:'copy'}]};
 const project={data:{id:'p',interviews:[session]}} as OpenProject;
 vi.mocked((await import('../lib/projectStore')).checkProjectMedia).mockRejectedValue(new Error('offline'));
 vi.mocked(local.readManifest).mockResolvedValue(null);
 renderBoard(project);
 await screen.findByText('无法读取项目内的音频。请重新打开这个项目，确认项目文件夹可访问。');
 expect(screen.queryByText('音频暂不可用。请找到原文件以恢复播放。')).toBeNull();
});

function boardProject() {
 const interviews=[
  {id:'reference',title:'Reference',recordings:[]},
  {id:'sep-11',title:'2026-09-11',recordings:[]},
  {id:'sep-15',title:'2026-09-15',recordings:[]},
 ];
 return {data:{id:'p',interviews}} as unknown as OpenProject;
}

function renderBoard(project:OpenProject,save=vi.fn(),select=vi.fn(),selected=project.data.interviews[0].id) {
 render(<ProjectBoard project={project} selected={selected} busy={false} select={select} save={save} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={()=>{}} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>);
 return save;
}

it('stores a padded date when adding a scene to an existing project',async()=>{
 const project=boardProject(),createSession=vi.fn();
 render(<ProjectBoard project={project} selected="reference" busy={false} select={()=>{}} save={()=>{}} add={()=>{}} importDocuments={async()=>{}} createSession={createSession} open={()=>{}} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'新增场次'}));
 fireEvent.click(screen.getByRole('button',{name:'场次名称'}));fireEvent.change(screen.getByRole('textbox',{name:'场次名称'}),{target:{value:'新场次'}});fireEvent.keyDown(screen.getByRole('textbox',{name:'场次名称'}),{key:'Enter'});
 fireEvent.change(screen.getByRole('textbox',{name:'场次日期：年'}),{target:{value:'2020'}});
 fireEvent.change(screen.getByRole('textbox',{name:'场次日期：月'}),{target:{value:'10'}});
 fireEvent.change(screen.getByRole('textbox',{name:'场次日期：日'}),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'确认'}));
 await waitFor(()=>expect(createSession).toHaveBeenCalledWith(expect.objectContaining({metadata:expect.objectContaining({recorded_at:'2020-10-03'})})));
});

it('shows the session count beside the session list heading',()=>{
 const project=boardProject();
 renderBoard(project);
 const sidebar=screen.getByRole('complementary',{name:'场次'});
 expect(sidebar.querySelector('.panel-heading__count')?.textContent).toBe('3');
});

it('keeps session focus and selection together when clicking, tabbing, and using arrow keys',()=>{
 const project=boardProject();
 const save=vi.fn();
 function Board(){
  const [selected,setSelected]=useState(project.data.interviews[0].id);
  return <ProjectBoard project={project} selected={selected} busy={false} select={setSelected} save={save} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={()=>{}} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>;
 }
 const view=render(<Board/>);
 const rows=Array.from(view.container.querySelectorAll<HTMLElement>('.setup-session-select'));
 fireEvent.click(rows[1]);
 expect(document.activeElement).toBe(rows[1]);
 expect(rows[1].getAttribute('aria-pressed')).toBe('true');
 expect(view.container.querySelector('.setup-canvas h2')?.textContent).toBe('2026-09-11');
 fireEvent.keyDown(rows[1],{key:'ArrowDown'});
 expect(document.activeElement).toBe(rows[2]);
 expect(rows[2].getAttribute('aria-pressed')).toBe('true');
 expect(view.container.querySelector('.setup-canvas h2')?.textContent).toBe('2026-09-15');
 fireEvent.keyDown(rows[2],{key:'ArrowDown'});
 expect(document.activeElement).toBe(rows[2]);
 act(()=>rows[0].focus());
 expect(rows[0].getAttribute('aria-pressed')).toBe('true');
 const title=rows[0].querySelector<HTMLElement>('.inline-edit')!;
 act(()=>title.focus());
 fireEvent.click(title);
 expect(document.activeElement).toBe(title);
 fireEvent.keyDown(title,{key:'ArrowDown'});
 expect(document.activeElement).toBe(title);
 expect(rows[0].getAttribute('aria-pressed')).toBe('true');
 fireEvent.keyDown(rows[0],{key:'ArrowDown',ctrlKey:true});
 expect(document.activeElement).toBe(title);
 expect(save).not.toHaveBeenCalled();
});

it('reorders saved-project sessions with the Option+Arrow shortcut',()=>{
 const project=boardProject();
 const save=renderBoard(project);
 fireEvent.keyDown(screen.getByRole('button',{name:'调整Reference顺序'}),{key:'ArrowDown',altKey:true});
 expect(save).toHaveBeenCalledWith([project.data.interviews[1],project.data.interviews[0],project.data.interviews[2]]);
});

it('also accepts the Option+Arrow shortcut when the session row has focus',()=>{
 const project=boardProject();
 const save=renderBoard(project);
 fireEvent.keyDown(document.querySelector('.setup-session-select')!,{key:'ArrowDown',altKey:true});
 expect(save).toHaveBeenCalledWith([project.data.interviews[1],project.data.interviews[0],project.data.interviews[2]]);
});

it('reorders saved-project sessions by dragging the grip onto another session',()=>{
 const project=boardProject();
 const select=vi.fn();
 const save=renderBoard(project,vi.fn(),select,project.data.interviews[1].id);
 const transfer={setData:vi.fn(),getData:vi.fn(()=> 'reference'),types:['application/x-ripple-order'],effectAllowed:'',dropEffect:''};
 const source=screen.getByRole('button',{name:'调整Reference顺序'});
 fireEvent.dragStart(source,{dataTransfer:transfer});
 expect(select).toHaveBeenCalledWith('reference');
 expect(source.closest('.setup-session')?.classList.contains('is-selected')).toBe(true);
 const target=screen.getByText('2026-09-15').closest('.setup-session')!;
 fireEvent.dragOver(target,{dataTransfer:transfer,clientY:0});
 expect(transfer.dropEffect).toBe('move');
 const event=createEvent.drop(target,{dataTransfer:transfer});
 Object.defineProperty(event,'clientY',{value:0});
 fireEvent(target,event);
 expect(save).toHaveBeenCalledWith([project.data.interviews[1],project.data.interviews[0],project.data.interviews[2]]);
});

it('updates the reference permission notice when switching interface language', async () => {
 const store=await import('../lib/projectStore'); const {setInterfaceLanguage}=await import('../i18n');
 vi.mocked(store.checkProjectMedia).mockRejectedValueOnce(new DOMException('denied','NotAllowedError'));
 const session={id:'s',title:'Synthetic interview',recordings:[{id:'r',file:'source.wav',name:'synthetic.wav',storage:'reference'}]};
 renderBoard({data:{id:'p',interviews:[session]}} as OpenProject);
 await screen.findByText(/音频访问权限需要恢复/);
 try {await act(()=>setInterfaceLanguage('en')); await screen.findByText(/Audio access needs permission/);}
 finally {await act(()=>setInterfaceLanguage('zh-CN'));}
});

it('does not reread audio after only renaming a session',async()=>{
 const store=await import('../lib/projectStore');
 const recording={id:'r',file:'a.wav',name:'Audio',storage:'copy' as const,fingerprint:'synthetic'};
 const session={id:'s',title:'Session',recordings:[recording]};
 const project={directory:{name:'synthetic'},data:{id:'p',interviews:[session]}} as unknown as OpenProject;
 const props={selected:'s',busy:false,select:()=>{},save:()=>{},add:()=>{},importDocuments:async()=>{},createSession:async()=>{},open:()=>{},run:async(work:()=>Promise<void>)=>work(),legacy:()=>{},relink:()=>{},associate:()=>{}};
 const ui=render(<ProjectBoard {...props} project={project}/>);
 await waitFor(()=>expect(store.checkProjectMedia).toHaveBeenCalledTimes(1));
 ui.rerender(<ProjectBoard {...props} project={{...project,data:{...project.data,interviews:[{...session,title:'Renamed'}]}}}/>);
 await act(async()=>{});expect(store.checkProjectMedia).toHaveBeenCalledTimes(1);
});

it('shows AI and manual revisions together and opens or renames the requested ID',async()=>{
 await (await import('../i18n')).setInterfaceLanguage('zh-CN');
 vi.mocked((await import('../lib/projectStore')).recordingDirectory).mockResolvedValue({} as FileSystemDirectoryHandle);
 const model={id:'m',label:'导入稿',engine:'test',sourceKind:'import',original:'snapshot.json',edits:[{id:'e1',label:'修改稿 v1'},{id:'e2',label:'修改稿 v1 · AI 辅助 01'}],activeEditId:'e1'} as TranscriptModel;
 vi.mocked(local.readManifest).mockResolvedValue({models:[model]} as never);
 vi.mocked(local.renameEditLabel).mockResolvedValue({models:[{...model,edits:[model.edits[0],{...model.edits[1],label:'AI 校对'}]}]} as never);
 const recording={id:'r',file:'source.m4a',name:'音频.m4a',storage:'copy'};
 const project={data:{id:'p',interviews:[{id:'s',title:'访谈',recordings:[recording]}]}} as OpenProject;
 const open=vi.fn();const props={project,selected:'s',busy:false,select:()=>{},save:()=>{},add:()=>{},importDocuments:async()=>{},createSession:async()=>{},open,run:async(work:()=>Promise<void>)=>{await work();},legacy:()=>{},relink:()=>{},associate:()=>{}};
 const view=render(<ProjectBoard {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'打开 转录稿 修改稿 v1 · AI 辅助 01'}));
 expect(open).toHaveBeenLastCalledWith(recording,'m','e2');
 expect(screen.getByRole('button',{name:'打开 转录稿 修改稿 v1'})).toBeTruthy();
 expect(screen.queryByText(/snapshot/)).toBeNull();
 const root=screen.getByRole('button',{name:'打开 转录稿 修改稿 v1'}).closest('.setup-document')!;
 const ai=screen.getByRole('button',{name:'打开 转录稿 修改稿 v1 · AI 辅助 01'}).closest('.setup-document')!;
 expect(root.getAttribute('data-root-version-id')).toBe('m:e1');expect(ai.classList.contains('setup-document-version')).toBe(true);
 expect(root.compareDocumentPosition(ai)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'打开 转录稿 修改稿 v1'}));expect(open).toHaveBeenLastCalledWith(recording,'m','e1');

 fireEvent.click(screen.getByRole('button',{name:'重命名 修改稿 v1 · AI 辅助 01'}));
 const input=screen.getByRole('textbox',{name:'重命名 转录稿'});
 fireEvent.change(input,{target:{value:'AI 校对'}});fireEvent.keyDown(input,{key:'Enter'});
 await waitFor(()=>expect(local.renameEditLabel).toHaveBeenLastCalledWith(expect.anything(),'source.m4a','m','e2','AI 校对'));
 await screen.findByRole('button',{name:'打开 转录稿 AI 校对'});
 view.rerender(<ProjectBoard {...props} busy/>);
 expect(screen.getByRole('button',{name:'打开 转录稿 AI 校对'}).hasAttribute('disabled')).toBe(true);
});

it('shows engine original and every revision and opens the original explicitly',async()=>{
 await (await import('../i18n')).setInterfaceLanguage('zh-CN');
 vi.mocked((await import('../lib/projectStore')).recordingDirectory).mockResolvedValue({} as FileSystemDirectoryHandle);
 const model={id:'engine',label:'原始转录稿',engine:'synthetic',sourceKind:'transcription',original:'original.json',edits:[{id:'e1',label:'修改稿 v1'},{id:'e2',label:'AI 辅助 01'}],activeEditId:'e2'} as TranscriptModel;
 vi.mocked(local.readManifest).mockResolvedValue({models:[model]} as never);
 const recording={id:'r',file:'source.m4a',name:'音频.m4a',storage:'copy'};
 const project={data:{id:'p',interviews:[{id:'s',title:'访谈',recordings:[recording]}]}} as OpenProject;const open=vi.fn();
 render(<ProjectBoard project={project} selected="s" busy={false} select={()=>{}} save={()=>{}} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={open} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'打开 转录稿 原始转录稿'}));expect(open).toHaveBeenLastCalledWith(recording,'engine','original');
 fireEvent.click(screen.getByRole('button',{name:'打开 转录稿 修改稿 v1'}));expect(open).toHaveBeenLastCalledWith(recording,'engine','e1');
 expect(screen.getByRole('button',{name:'打开 转录稿 AI 辅助 01'})).toBeTruthy();
});

it('clears a stale offline notice after a successful relink with unchanged recording identity',async()=>{
 const store=await import('../lib/projectStore');
 vi.mocked(store.checkProjectMedia).mockRejectedValueOnce(new DOMException('Synthetic denial','NotAllowedError')).mockResolvedValue(undefined);
 const recording={id:'r',file:'a.wav',name:'Synthetic audio',storage:'reference' as const,fingerprint:'synthetic'};
 const project={directory:{name:'synthetic'},data:{id:'p',interviews:[{id:'s',title:'Synthetic session',recordings:[recording]}]}} as unknown as OpenProject;
 const props={selected:'s',busy:false,select:()=>{},save:()=>{},add:()=>{},importDocuments:async()=>{},createSession:async()=>{},open:()=>{},run:async(work:()=>Promise<void>)=>work(),legacy:()=>{},relink:()=>{},associate:()=>{}};
 const ui=render(<ProjectBoard {...props} project={project} mediaRevision={0}/>);
 await screen.findByText(/音频访问权限需要恢复/);
 // Same file name, storage, ID and fingerprint; only the local authorization changed.
 ui.rerender(<ProjectBoard {...props} project={project} mediaRevision={1}/>);
 await waitFor(()=>expect(store.checkProjectMedia).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.queryByText(/音频访问权限需要恢复/)).toBeNull());
});

it('selects several recordings and sends one confirmed move with their associated manuscripts',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 vi.mocked(local.readManifest).mockResolvedValue({models:[]} as never);
 const recordings=[{id:'r1',file:'a.wav',name:'Synthetic A',storage:'copy'},{id:'r2',file:'b.wav',name:'Synthetic B',storage:'reference'}];
 const project={data:{id:'p',interviews:[{id:'s',title:'Synthetic source',recordings},{id:'target',title:'Synthetic destination',recordings:[]}]}} as OpenProject;
 const move=vi.fn().mockResolvedValue(undefined);
 render(<ProjectBoard project={project} selected="s" busy={false} select={()=>{}} save={()=>{}} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={()=>{}} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}} moveRecordings={move}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'选择 Synthetic A'}));
 fireEvent.click(screen.getByRole('checkbox',{name:'选择 Synthetic B'}));
 fireEvent.click(screen.getByRole('button',{name:'移动到其他场次'}));
 expect(move).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'取消',exact:true}));
 const trigger=screen.getByRole('button',{name:'移动到其他场次'});
 expect(document.activeElement).toBe(trigger);
 fireEvent.click(trigger);
 fireEvent.click(screen.getByRole('radio',{name:'Synthetic destination'}));
 fireEvent.click(screen.getByRole('button',{name:'确认移动'}));
 await waitFor(()=>expect(move).toHaveBeenCalledWith('s','target',['r1','r2']));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps the confirmed source and count stable while the saved project refreshes',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 vi.mocked(local.readManifest).mockResolvedValue({models:[]} as never);
 const recording={id:'r',file:'a.wav',name:'Synthetic audio',storage:'copy'};
 const source={id:'s',title:'Synthetic source',recordings:[recording]};
 const target={id:'t',title:'Synthetic destination',recordings:[]};
 const project={data:{id:'p',interviews:[source,target]}} as OpenProject;
 let finish!:()=>void;
 const move=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const props={project,selected:'s',busy:false,select:()=>{},save:()=>{},add:()=>{},importDocuments:async()=>{},createSession:async()=>{},open:()=>{},run:async(work:()=>Promise<void>)=>{await work();},legacy:()=>{},relink:()=>{},associate:()=>{},moveRecordings:move};
 const view=render(<ProjectBoard {...props}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'选择 Synthetic audio'}));
 fireEvent.click(screen.getByRole('button',{name:'移动到其他场次'}));
 fireEvent.click(screen.getByRole('radio',{name:'Synthetic destination'}));
 fireEvent.click(screen.getByRole('button',{name:'确认移动'}));
 view.rerender(<ProjectBoard {...props} busy project={{...project,data:{...project.data,interviews:[{...source,recordings:[]},{...target,recordings:[recording]}]}} as OpenProject}/>);
 expect(screen.getByRole('dialog').textContent).toContain('将 1 条录音');
 expect(screen.getByRole('dialog').textContent).toContain('Synthetic source');
 await act(async()=>finish());
});
