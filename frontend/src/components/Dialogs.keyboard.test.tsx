// @vitest-environment jsdom
import {createRef} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MergeDialog,NamingModal,MatchDialog} from './Dialogs';
afterEach(cleanup);
it('focuses the naming field and returns to the opener without submitting IME Enter',()=>{
 const opener=document.createElement('button');document.body.append(opener);opener.focus();const confirm=vi.fn();
 const {unmount}=render(<NamingModal value="测试稿" error={null} setError={vi.fn()} busy={false} repairs={[]} setRepairs={vi.fn()} modalRef={createRef()} setOpen={vi.fn()} confirmNaming={confirm}/>);
 expect(screen.getByRole('dialog',{name:'设置版本名称'})).toBeTruthy();const input=screen.getByRole('textbox',{name:'版本名称'});expect(document.activeElement).toBe(input);
 fireEvent.keyDown(input,{key:'Enter',isComposing:true});expect(confirm).not.toHaveBeenCalled();unmount();expect(document.activeElement).toBe(opener);opener.remove();
});
it('focuses the non-merging action',()=>{
 render(<MergeDialog prompt={{sourceId:'a',targetId:'b',sourceName:'甲',targetName:'乙',trigger:'merge'}} dialogRef={createRef()} setPrompt={vi.fn()} confirmMerge={vi.fn()}/>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'不合并'}));
});
it('exposes matching selection and defaults to cancellation or reselection',()=>{
 const props={prompt:{sourceName:'合成.json',target:'',candidates:['甲.wav','乙.wav'],choice:'甲.wav',warning:null,checking:false,transcript:{audio:{filename:'',duration:0},speakers:[],segments:[]}},dialogRef:createRef<HTMLDivElement>(),setPrompt:vi.fn(),finishImport:vi.fn(),confirmMatch:vi.fn()};
 const ui=render(<MatchDialog {...props}/>);expect(document.activeElement).toBe(screen.getByRole('button',{name:'取消'}));expect(screen.getByRole('button',{name:'甲.wav'}).getAttribute('aria-pressed')).toBe('true');ui.unmount();
 render(<MatchDialog {...props} prompt={{...props.prompt,warning:'时长不匹配'}}/>);expect(document.activeElement).toBe(screen.getByRole('button',{name:'重新选择'}));expect(screen.getByRole('alert').textContent).toBe('时长不匹配');
});
