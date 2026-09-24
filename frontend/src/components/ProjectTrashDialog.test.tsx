// @vitest-environment jsdom
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { DeleteMaterialDialog,ProjectTrashDialog } from './ProjectTrashDialog';
import type { OpenProject } from '../lib/projectStore';
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(cleanup);
it('lets the user keep linked documents or delete them with audio',()=>{
 const onDelete=vi.fn();render(<DeleteMaterialDialog name="采访.m4a" audio hasDocuments referenced busy={false} onCancel={()=>{}} onDelete={onDelete}/>);
 expect(screen.getByText(/外部音频的原文件不会被更改/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'移入回收站'}));expect(onDelete).toHaveBeenLastCalledWith(true);
 fireEvent.click(screen.getByRole('radio',{name:'关联转录稿一并移入回收站'}));fireEvent.click(screen.getByRole('button',{name:'移入回收站'}));expect(onDelete).toHaveBeenLastCalledWith(false);
});
it('restores specific entries and requires confirmation before clearing',()=>{
 const project={data:{interviews:[{id:'s',title:'访谈'}],trash:[{id:'t',name:'文稿',interviewId:'s',deletedAt:'2026-09-22',recording:{storage:'none'}}]}} as unknown as OpenProject;
 const onRestore=vi.fn(),onClear=vi.fn();render(<ProjectTrashDialog project={project} busy={false} onClose={()=>{}} onRestore={onRestore} onClear={onClear}/>);
 fireEvent.click(screen.getByRole('button',{name:'恢复'}));expect(onRestore).toHaveBeenCalledWith('t');
 fireEvent.click(screen.getByRole('button',{name:'清空回收站'}));expect(onClear).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:"永久清空"}));expect(onClear).toHaveBeenCalledOnce();
});

it('cancels only the clear confirmation and rejects a changed set of records',()=>{
 const project={data:{interviews:[],trash:[{id:'t',name:'文稿',deletedAt:'2026-09-22',recording:{storage:'none'}}]}} as unknown as OpenProject;
 const onClear=vi.fn(),onClose=vi.fn();
 const ui=render(<ProjectTrashDialog project={project} busy={false} onClose={onClose} onRestore={()=>{}} onClear={onClear}/>);
 fireEvent.click(screen.getByRole('button',{name:'清空回收站'}));
 const confirm=screen.getByRole('dialog',{name:'清空回收站？'});
 expect(document.activeElement).toBe(within(confirm).getByRole('button',{name:'取消'}));
 fireEvent(confirm, new Event('cancel', { cancelable: true }));
 expect(screen.queryByRole('dialog',{name:'清空回收站？'})).toBeNull();
 expect(onClose).not.toHaveBeenCalled();expect(onClear).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'清空回收站'}));
 const changed={...project,data:{...project.data,trash:[...project.data.trash!,{...project.data.trash![0],id:'new'}]}};
 ui.rerender(<ProjectTrashDialog project={changed} busy={false} onClose={onClose} onRestore={()=>{}} onClear={onClear}/>);
 expect((screen.getByRole('button',{name:"永久清空"}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:"永久清空"}));expect(onClear).not.toHaveBeenCalled();
 expect(screen.getByRole('alert').textContent).toContain('已变化');
});

it('returns focus to the material or trash entry when the dialog closes',()=>{
 const opener=document.createElement('button');document.body.append(opener);
 try {
  opener.focus();
  const deletion=render(<DeleteMaterialDialog name="文稿" audio={false} hasDocuments={false} referenced={false} busy={false} onCancel={()=>{}} onDelete={()=>{}}/>);
  screen.getByRole('button',{name:'取消'}).focus();
  deletion.unmount();expect(document.activeElement).toBe(opener);
  const project={data:{interviews:[],trash:[]}} as unknown as OpenProject;
  const trash=render(<ProjectTrashDialog project={project} busy={false} onClose={()=>{}} onRestore={()=>{}} onClear={()=>{}}/>);
  screen.getByRole('button',{name:'关闭回收站'}).focus();
  trash.unmount();expect(document.activeElement).toBe(opener);
 } finally {opener.remove();}
});
