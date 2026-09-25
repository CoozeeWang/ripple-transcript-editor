// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectBoard } from './ProjectBoard';
import * as local from '../localStore';
import type { OpenProject } from '../lib/projectStore';
import type { TranscriptModel } from '../types';
vi.mock('../localStore',async original=>({...await original<typeof local>(),readManifest:vi.fn(),readModelEdit:vi.fn(),readModelOriginal:vi.fn(),createModel:vi.fn(),setModelOriginal:vi.fn()}));
vi.mock('../lib/projectStore',async original=>({...await original<typeof import('../lib/projectStore')>(),mutateProjectManuscript:vi.fn(async(_p,work)=>work()),resolveMedia:vi.fn(async()=>({getFile:async()=>({})})),recordingDirectory:vi.fn(async()=>({}))}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it.each([false,true])('opens names, removes previews, and copies the current document (original=%s)',async original=>{
 const model={id:'m',label:'采访稿',engine:'test',sourceKind:'import',designatedOriginal:original,edits:original?[]:[{id:'e2'}],activeEditId:original?'':'e2'} as TranscriptModel;
 const copy={...model,id:'copy',label:'采访稿 副本',designatedOriginal:false,edits:[{id:'e1'}],activeEditId:'e1'} as TranscriptModel;
 vi.mocked(local.readManifest).mockResolvedValue({models:[model]} as never);
 const transcript={segments:[{id:'1',text:'保留原内容'}]};
 vi.mocked(local.readModelOriginal).mockResolvedValue({transcript} as never);
 vi.mocked(local.readModelEdit).mockResolvedValue({transcript,metadata:{title:'采访'}} as never);
 vi.mocked(local.createModel).mockResolvedValue({model:copy,manifest:{models:[model,copy]}} as never);
 const recording={id:'r',file:'source.m4a',name:'音频.m4a',storage:'copy'};
 const project={data:{id:'p',interviews:[{id:'s',title:'访谈',recordings:[recording]}]}} as OpenProject;
 const open=vi.fn();
 render(<ProjectBoard project={project} selected="s" busy={false} select={()=>{}} save={()=>{}} add={()=>{}} importDocuments={async()=>{}} createSession={async()=>{}} open={open} run={async work=>{await work();}} legacy={()=>{}} relink={()=>{}} associate={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'打开 转录稿 采访稿'}));expect(open).toHaveBeenCalledWith(recording,'m');
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

it('shows the session count beside the session list heading',()=>{
 const project=boardProject();
 renderBoard(project);
 const sidebar=screen.getByRole('complementary',{name:'场次'});
 expect(sidebar.querySelector('.panel-heading__count')?.textContent).toBe('3');
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
