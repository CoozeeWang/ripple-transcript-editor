// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectSetup } from './ProjectSetup';
import * as store from '../lib/projectStore';
vi.mock('../lib/projectStore', async original=>({...await original<typeof store>(),createProject:vi.fn(),importProjectMaterials:vi.fn()}));
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open", "");};});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function scene(){fireEvent.click(screen.getByRole('button',{name:'场次名称'}));fireEvent.change(screen.getByRole('textbox',{name:'场次名称'}),{target:{value:'第一次访谈'}});fireEvent.keyDown(screen.getByRole('textbox',{name:'场次名称'}),{key:'Enter'});fireEvent.change(screen.getByLabelText('地点（选填）'),{target:{value:'受访者家中'}});fireEvent.click(screen.getByText('确认'));}
function drop(label:string,files:File[]){fireEvent.drop(screen.getByRole('button',{name:label}),{dataTransfer:{types:['Files'],items:files.map(file=>({kind:'file',getAsFile:()=>file})),files}});}
function textFile(name:string,text='文稿正文'){const file=new File([text],name);Object.assign(file,{text:async()=>text});return file;}
it('stages separate materials, associates multiple transcripts, sorts, ignores audio without deleting its transcripts, and undoes',async()=>{
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);scene();
 drop('选择或拖入音频，加入这个场次',[new File(['audio'],'录音.wav')]);fireEvent.click(await screen.findByRole('button',{name:'加入音频'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'音频存放方式'})).toBeNull());await screen.findByText('录音.wav');
 drop('选择或拖入转录稿，关联到这段音频',[textFile('初稿.txt'),textFile('校订稿.txt')]);await screen.findByText('校订稿.txt');
 expect(store.importProjectMaterials).not.toHaveBeenCalled();
 const grip=screen.getByRole('button',{name:'调整初稿.txt顺序'});
 fireEvent.keyDown(grip,{key:'ArrowDown',altKey:true});
 expect(screen.getAllByRole('button',{name:/^预览 /}).map(n=>n.getAttribute('aria-label'))).toEqual(['预览 校订稿.txt','预览 初稿.txt']);
 fireEvent.click(screen.getByRole('button',{name:'忽略 录音.wav'}));
 expect(screen.queryByText('录音.wav')).toBeNull();expect(screen.getByText('初稿.txt')).toBeTruthy();
 expect(screen.getByText('初稿.txt').closest('.setup-independent')).toBeTruthy();
 fireEvent.click(screen.getByText('撤销'));expect(screen.getByText('初稿.txt').closest('.setup-linked')).toBeTruthy();
});
it('does not create files until the final save and keeps the draft and target project after a failed import',async()=>{
 const project={data:{id:'p',title:'河东河西',interviews:[],revision:0},directory:{}} as unknown as store.OpenProject;
 vi.mocked(store.createProject).mockResolvedValue(project);vi.mocked(store.importProjectMaterials).mockRejectedValueOnce(new Error('磁盘空间不足')).mockResolvedValueOnce(project);
 Object.assign(window,{showDirectoryPicker:vi.fn(async()=>({name:'项目目录'}))});const done=vi.fn();
 render(<ProjectSetup onDone={done} onCancel={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'项目名称'}));fireEvent.change(screen.getByRole('textbox',{name:'项目名称'}),{target:{value:'河东河西'}});fireEvent.keyDown(screen.getByRole('textbox',{name:'项目名称'}),{key:'Enter'});scene();
 drop('选择或拖入独立转录稿，不关联音频',[textFile('访谈.txt')]);await screen.findByText('访谈.txt');
 fireEvent.click(screen.getByRole('button',{name:'完成整理'}));fireEvent.click(screen.getByText('选择保存位置'));await screen.findByText('项目目录');
 expect(store.createProject).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'保存项目'}));await screen.findByText('磁盘空间不足');expect(done).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'保存项目'}));await waitFor(()=>expect(done).toHaveBeenCalledWith(project));expect(store.createProject).toHaveBeenCalledTimes(1);
 const args=vi.mocked(store.importProjectMaterials).mock.calls[1];expect(args[1][0].name).toBe('访谈.txt');expect(args[4]?.[0].metadata?.location).toBe('受访者家中');
});
it('rejects a drop onto the wrong target without adding any files',async()=>{
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);scene();drop('选择或拖入音频，加入这个场次',[textFile('错放.txt')]);await screen.findByRole('alert');expect(screen.queryByText('错放.txt')).toBeNull();
});
it('reorders audio by drag without moving the associated transcript to another recording',async()=>{
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);scene();
 drop('选择或拖入音频，加入这个场次',[new File(['a'],'A.wav'),new File(['b'],'B.wav')]);fireEvent.click(await screen.findByRole('button',{name:'加入音频'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'音频存放方式'})).toBeNull());await screen.findByText('B.wav');
 const first=screen.getAllByRole('button',{name:'选择或拖入转录稿，关联到这段音频'})[0];
 fireEvent.drop(first,{dataTransfer:{types:['Files'],items:[{kind:'file',getAsFile:()=>textFile('A.txt')}],files:[]}});await screen.findByText('A.txt');
 const transfer={setData:vi.fn(),types:['application/x-ripple-order'],effectAllowed:'',dropEffect:''};
 fireEvent.dragStart(screen.getByRole('button',{name:'调整A.wav顺序'}),{dataTransfer:transfer});
 const target=screen.getByText('B.wav').closest('article')!;
 const event=createEvent.drop(target,{dataTransfer:transfer});Object.defineProperty(event,'clientY',{value:10});fireEvent(target,event);
 expect(screen.getAllByRole('button',{name:/^试听 /}).map(n=>n.getAttribute('aria-label'))).toEqual(['试听 B.wav','试听 A.wav']);
 expect(screen.getByText('A.txt').closest('article')?.textContent).toContain('A.wav');
});
it('uses transcript date segmentation and refuses impossible scene dates',()=>{
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);
 const year=screen.getByRole('textbox',{name:'场次日期：年'}),month=screen.getByRole('textbox',{name:'场次日期：月'}),day=screen.getByRole('textbox',{name:'场次日期：日'});
 year.focus();fireEvent.change(year,{target:{value:'2026'}});expect(document.activeElement).toBe(month);
 fireEvent.change(month,{target:{value:'9'}});expect((month as HTMLInputElement).value).toBe('09');expect(document.activeElement).toBe(day);
 fireEvent.change(day,{target:{value:'31'}});scene();expect(screen.getByRole('alert').textContent).toContain('无效');
 fireEvent.change(day,{target:{value:'30'}});fireEvent.click(screen.getByText('确认'));expect(screen.getAllByText('2026-09-30').length).toBeGreaterThan(0);
});
it('accepts Word transcripts dropped onto the whole audio card and reports unsupported outside drops',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({text:'旧版 Word 正文'}),{status:200}));
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);scene();drop('选择或拖入音频，加入这个场次',[new File(['a'],'录音.wav')]);fireEvent.click(await screen.findByRole('button',{name:'加入音频'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'音频存放方式'})).toBeNull());await screen.findByText('录音.wav');
 fireEvent.drop(screen.getByText('录音.wav').closest('article')!,{dataTransfer:{types:['Files'],items:[{kind:'file',getAsFile:()=>new File(['doc'],'访谈.doc')}],files:[]}});
 await screen.findByText('访谈.doc');expect(fetcher).toHaveBeenCalledWith('/api/manuscripts/legacy-word',expect.objectContaining({method:'POST'}));
 fireEvent.drop(screen.getByRole('region',{name:'整理项目材料'}),{dataTransfer:{types:['Files']}});expect(screen.getByRole('alert').textContent).toContain('对应音频下方');fetcher.mockRestore();
});
it('opens filtered multi-file pickers and associates selected transcripts with the target audio',async()=>{
 const audio={kind:'file',name:'选择的录音.wav',getFile:async()=>new File(['audio'],'选择的录音.wav')} as FileSystemFileHandle;
 const doc={kind:'file',name:'选择的转录稿.txt',getFile:async()=>textFile('选择的转录稿.txt')} as FileSystemFileHandle;
 const picker=vi.fn().mockResolvedValueOnce([audio]).mockResolvedValueOnce([doc]).mockRejectedValueOnce(new DOMException('cancel','AbortError'));
 Object.assign(window,{showOpenFilePicker:picker});
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);scene();
 fireEvent.click(screen.getByRole('button',{name:"选择或拖入音频，加入这个场次"}));fireEvent.click(await screen.findByRole('button',{name:'加入音频'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'音频存放方式'})).toBeNull());await screen.findByText('选择的录音.wav');
 expect(picker.mock.calls[0][0]).toMatchObject({multiple:true,types:[{description:'音频'}]});
 fireEvent.click(screen.getByRole('button',{name:'选择或拖入转录稿，关联到这段音频'}));await screen.findByText('选择的转录稿.txt');
 expect(screen.getByText('选择的转录稿.txt').closest('article')?.textContent).toContain('选择的录音.wav');
 expect(picker.mock.calls[1][0]).toMatchObject({multiple:true,types:[{description:'转录稿'}]});
 fireEvent.click(screen.getByRole('button',{name:"选择或拖入独立转录稿，不关联音频"}));await waitFor(()=>expect(screen.queryByText("正在读取或保存…")).toBeNull());expect(screen.queryByRole('alert')).toBeNull();
});
it('confirms read-only designation, allows multiple originals and removes their badges when reverted',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);scene();
 drop('选择或拖入独立转录稿，不关联音频',[textFile('甲.txt'),textFile('乙.txt')]);await screen.findByText('乙.txt');
 fireEvent.click(screen.getByRole('button',{name:'设为原始转录稿 甲.txt'}));expect(screen.queryByText('原始转录稿')).toBeNull();expect(confirm).toHaveBeenCalledWith(expect.stringContaining('只读'));
 confirm.mockReturnValue(true);
 fireEvent.click(screen.getByRole('button',{name:'设为原始转录稿 甲.txt'}));fireEvent.click(screen.getByRole('button',{name:'设为原始转录稿 乙.txt'}));expect(screen.getAllByText('原始转录稿')).toHaveLength(2);expect(screen.queryByRole('combobox')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'改为编辑稿 甲.txt'}));expect(screen.getAllByText('原始转录稿')).toHaveLength(1);confirm.mockRestore();
});
it('continues adding interviews from the footer without saving or losing the first interview',async()=>{
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);scene();
 drop('选择或拖入独立转录稿，不关联音频',[textFile('第一场.txt')]);await screen.findByText('第一场.txt');
 expect(screen.getByText('已整理场次：1')).toBeTruthy();
 fireEvent.click(screen.getAllByRole('button',{name:'新增场次'})[0]);expect(screen.getByRole('button',{name:'完成整理'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'场次名称'}));fireEvent.change(screen.getByRole('textbox',{name:'场次名称'}),{target:{value:'第二次访谈'}});fireEvent.keyDown(screen.getByRole('textbox',{name:'场次名称'}),{key:'Enter'});fireEvent.click(screen.getByRole('button',{name:'确认'}));
 expect(screen.getByText('已整理场次：2')).toBeTruthy();expect(store.createProject).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('第一次访谈'));expect(screen.getByText('第一场.txt')).toBeTruthy();
});
it('asks before staging audio and cancellation leaves the session unchanged',async()=>{
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);scene();
 drop('选择或拖入音频，加入这个场次',[new File(['a'],'取消.wav')]);
 await screen.findByRole('dialog',{name:'音频存放方式'});
 expect(screen.queryByRole('button',{name:'音频名称'})).toBeNull();
 expect((screen.getByRole('radio',{name:/引用原文件/}) as HTMLInputElement).disabled).toBe(true);
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
 await waitFor(()=>expect(screen.queryByText('取消.wav')).toBeNull());
 expect(store.importProjectMaterials).not.toHaveBeenCalled();
});
it('stores the storage choice per batch without asking again on the save step',async()=>{
 const project={data:{id:'p',title:'测试',interviews:[],revision:0},directory:{}} as unknown as store.OpenProject;
 vi.mocked(store.createProject).mockResolvedValue(project);vi.mocked(store.importProjectMaterials).mockResolvedValue(project);
 const handle=(name:string)=>({kind:'file',name,getFile:async()=>new File(['audio'],name)}) as FileSystemFileHandle;
 Object.assign(window,{showOpenFilePicker:vi.fn().mockResolvedValueOnce([handle('引用.wav')]).mockResolvedValueOnce([handle('复制.wav')]),showDirectoryPicker:vi.fn(async()=>({name:'目录'}))});
 render(<ProjectSetup onDone={vi.fn()} onCancel={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'项目名称'}));fireEvent.change(screen.getByRole('textbox',{name:'项目名称'}),{target:{value:'测试'}});fireEvent.keyDown(screen.getByRole('textbox',{name:'项目名称'}),{key:'Enter'});scene();
 fireEvent.click(screen.getByRole('button',{name:"选择或拖入音频，加入这个场次"}));
 fireEvent.click(await screen.findByRole('radio',{name:/引用原文件/}));fireEvent.click(screen.getByRole('button',{name:'加入音频'}));
 await screen.findByRole('img',{name:'引用外部音频，原文件未复制到项目'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:"选择或拖入音频，加入这个场次"}));fireEvent.click(await screen.findByRole('button',{name:'加入音频'}));
 await screen.findByRole('img',{name:"保存项目时会复制音频，原文件保留"});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'完成整理'}));expect(screen.queryByText('音频存放方式')).toBeNull();
 fireEvent.click(screen.getByText('选择保存位置'));await screen.findByText('目录');fireEvent.click(screen.getByRole('button',{name:'保存项目'}));
 await waitFor(()=>expect(store.importProjectMaterials).toHaveBeenCalled());
 expect(vi.mocked(store.importProjectMaterials).mock.calls[0][1].map(i=>i.storage)).toEqual(['reference','copy']);
});
