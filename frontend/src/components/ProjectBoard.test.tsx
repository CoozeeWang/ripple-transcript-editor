// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
