// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {InlineEdit} from './InlineEdit';
import {validDateTime} from '../lib/dateTime';
afterEach(cleanup);
it('advances every segment at its full width and saves the exact local datetime',()=>{
 const save=vi.fn();render(<InlineEdit value="" onCommit={save} inputType="datetime-local" ariaLabel="录制时间"/>);
 fireEvent.click(screen.getByRole('button'));
 const names=['年','月','日','时','分'],values=['2026','09','20','13','45'];
 names.forEach((name,i)=>{const field=screen.getByRole('textbox',{name:`录制时间：${name}`});fireEvent.change(field,{target:{value:values[i]}});if(i<4)expect(document.activeElement).toBe(screen.getByRole('textbox',{name:`录制时间：${names[i+1]}`}));});
 expect(save).not.toHaveBeenCalled();fireEvent.keyDown(document.activeElement!,{key:'Enter'});expect(save).toHaveBeenCalledWith('2026-09-20T13:45');
});
it('does not advance an incomplete year, rejects impossible dates, and Escape preserves the old date',()=>{
 const save=vi.fn();render(<InlineEdit value="2026-01-01T12:00" onCommit={save} inputType="datetime-local" ariaLabel="录制时间"/>);fireEvent.click(screen.getByRole('button'));
 const year=screen.getByRole('textbox',{name:'录制时间：年'});fireEvent.change(year,{target:{value:'20'}});expect(document.activeElement).toBe(year);
 fireEvent.keyDown(year,{key:'Enter'});expect(screen.getByRole('alert')).toBeTruthy();expect(save).not.toHaveBeenCalled();
 fireEvent.keyDown(year,{key:'Escape'});expect(screen.getByRole('button').textContent).toBe('2026-01-01T12:00');
 expect(validDateTime('2026-02-29T12:00')).toBe(false);expect(validDateTime('2024-02-29T12:00')).toBe(true);expect(validDateTime('2026-01-01T24:00')).toBe(false);
});
it.each([['月','0',false],['月','1',false],['月','2',true],['月','9',true],['日','0',false],['日','1',false],['日','2',false],['日','3',false],['日','4',true],['日','9',true]])('handles the first %s digit %s predictably', (name,digit,advance)=>{
 render(<InlineEdit value="2026-01-01T12:00" onCommit={vi.fn()} inputType="datetime-local" ariaLabel="录制时间"/>);
 fireEvent.click(screen.getByRole('button'));
 const field=screen.getByRole('textbox',{name:`录制时间：${name}`}) as HTMLInputElement;
 field.focus();fireEvent.change(field,{target:{value:digit}});
 expect(field.value).toBe(advance?`0${digit}`:digit);
 expect(document.activeElement).toBe(advance?screen.getByRole('textbox',{name:`录制时间：${name==='月'?'日':'时'}`}):field);
});
it('deleting a digit does not pad or advance',()=>{
 render(<InlineEdit value="2026-09-09T12:00" onCommit={vi.fn()} inputType="datetime-local" ariaLabel="录制时间"/>);
 fireEvent.click(screen.getByRole('button'));
 const month=screen.getByRole('textbox',{name:'录制时间：月'}) as HTMLInputElement;
 month.focus();fireEvent.input(month,{target:{value:'9'},inputType:'deleteContentBackward'});
 expect(month.value).toBe('9');expect(document.activeElement).toBe(month);
});
it('saves a date without inventing a time, then allows time to be added and removed',()=>{
 const save=vi.fn();const ui=render(<InlineEdit value="" onCommit={save} inputType="datetime-local" ariaLabel="录制时间"/>);
 fireEvent.click(screen.getByRole('button'));
 const field=(name:string)=>screen.getByRole('textbox',{name:`录制时间：${name}`});
 for(const [name,value] of [['年','2026'],['月','9'],['日','20']])fireEvent.change(field(name),{target:{value}});
 fireEvent.keyDown(field('时'),{key:'Enter'});expect(save).toHaveBeenLastCalledWith('2026-09-20');
 ui.rerender(<InlineEdit value="2026-09-20" onCommit={save} inputType="datetime-local" ariaLabel="录制时间"/>);
 fireEvent.click(screen.getByRole('button'));
 fireEvent.change(field('时'),{target:{value:'14'}});fireEvent.keyDown(field('分'),{key:'Enter'});
 expect(screen.getByRole('alert')).toBeTruthy();expect(save).toHaveBeenCalledTimes(1);
 fireEvent.change(field('分'),{target:{value:'30'}});fireEvent.keyDown(field('分'),{key:'Enter'});
 expect(save).toHaveBeenLastCalledWith('2026-09-20T14:30');
 ui.rerender(<InlineEdit value="2026-09-20T14:30" onCommit={save} inputType="datetime-local" ariaLabel="录制时间"/>);
 fireEvent.click(screen.getByRole('button'));
 fireEvent.change(field('时'),{target:{value:''}});fireEvent.change(field('分'),{target:{value:''}});
 fireEvent.keyDown(field('分'),{key:'Enter'});expect(save).toHaveBeenLastCalledWith('2026-09-20');
});
it.each([['2026','2026'],['2026-09','2026-09']])('preserves partial date %s when editing and saving', (value,expected)=>{
 const save=vi.fn();render(<InlineEdit value={value} onCommit={save} inputType="date" ariaLabel="日期"/>);
 fireEvent.click(screen.getByRole('button'));
 const year=screen.getByRole('textbox',{name:'日期：年'});
 fireEvent.change(year,{target:{value:'2025'}});fireEvent.keyDown(year,{key:'Enter'});
 expect(save).toHaveBeenCalledWith(expected.replace('2026','2025'));
 expect(validDateTime(value)).toBe(true);
 expect(validDateTime('2026-13')).toBe(false);
 expect(validDateTime('2026--20')).toBe(false);
});
