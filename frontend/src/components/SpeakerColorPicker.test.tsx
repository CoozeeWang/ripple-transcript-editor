// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SpeakerColorPicker} from './SpeakerColorPicker';
import {readSpeakerPresets} from '../lib/speakerPresets';
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
it('saves custom presets for other documents, reuses them and deletes without changing speaker color',()=>{
 const change=vi.fn();const ui=render(<SpeakerColorPicker name="甲" color="#327884" onChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'修改 甲 的颜色'}));
 expect(within(screen.getByRole('group',{name:'系统预设'})).getAllByRole('button')).toHaveLength(10);
 expect(screen.queryByLabelText('颜色值')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'添加颜色'}));
 fireEvent.change(screen.getByLabelText('颜色值'),{target:{value:'#123456'}});
 fireEvent.click(screen.getByRole('button',{name:'保存并使用'}));
 expect(change).toHaveBeenCalledWith('#123456',0);expect(readSpeakerPresets()).toEqual(['#123456']);
 ui.unmount();change.mockClear();
 render(<SpeakerColorPicker name="乙" color="#123456" onChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'修改 乙 的颜色'}));
 expect(screen.getByRole('button',{name:'使用颜色 #123456'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'管理'}));
 fireEvent.click(screen.getByRole('button',{name:'删除颜色 #123456'}));
 expect(readSpeakerPresets()).toEqual([]);expect(change).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'完成'}));
 expect(screen.getByRole('button',{name:'添加颜色'})).toBeTruthy();
});
it('does not apply invalid colors or claim a failed save succeeded',()=>{
 const change=vi.fn();render(<SpeakerColorPicker name="甲" color="#327884" onChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'修改 甲 的颜色'}));fireEvent.click(screen.getByRole('button',{name:'添加颜色'}));
 fireEvent.change(screen.getByLabelText('颜色值'),{target:{value:'bad'}});fireEvent.click(screen.getByRole('button',{name:'保存并使用'}));
 expect(screen.getByRole('alert')).toBeTruthy();expect(change).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('颜色值'),{target:{value:'#123456'}});
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full');});
 fireEvent.click(screen.getByRole('button',{name:'保存并使用'}));
 expect(screen.getByRole('alert').textContent).toContain('无法保存');expect(change).not.toHaveBeenCalled();
});
it('keeps the portalled palette open for inside clicks and closes for outside clicks',()=>{
 render(<SpeakerColorPicker name="甲" color="#327884" onChange={vi.fn()}/>);
 const trigger=screen.getByRole('button',{name:'修改 甲 的颜色'});
 fireEvent.click(trigger);
 const add=screen.getByRole('button',{name:'添加颜色'});
 expect(trigger.closest('.speaker-color-action-wrap')?.contains(add)).toBe(false);
 fireEvent.pointerDown(add);fireEvent.click(add);
 expect(screen.getByLabelText('颜色值')).toBeTruthy();
 fireEvent.pointerDown(document.body);
 expect(screen.queryByLabelText('颜色值')).toBeNull();
});
