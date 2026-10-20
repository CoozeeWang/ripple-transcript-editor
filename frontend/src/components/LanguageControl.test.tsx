// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {LanguageControl} from './LanguageControl';
import {setInterfaceLanguage} from '../i18n';
afterEach(async()=>{cleanup();await setInterfaceLanguage('zh-CN');});
it('opens with one click, switches language and closes',async()=>{
 render(<LanguageControl welcome/>);
 const trigger=screen.getByRole('button',{name:'界面语言'});fireEvent.click(trigger);
 expect(screen.getByRole('menuitemradio',{name:'简体中文'}).getAttribute('aria-checked')).toBe('true');
 await act(async()=>fireEvent.click(screen.getByRole('menuitemradio',{name:'English'})));
 expect(screen.getByRole('button',{name:'Interface language'}).getAttribute('aria-expanded')).toBe('false');
 fireEvent.click(screen.getByRole('button',{name:'Interface language'}));
 expect(screen.getByRole('menuitemradio',{name:'English'}).getAttribute('aria-checked')).toBe('true');
});
it('supports keyboard selection, Escape and outside dismissal',()=>{
 render(<LanguageControl/>);const trigger=screen.getByRole('button',{name:'界面语言'});
 fireEvent.keyDown(trigger,{key:'ArrowDown'});expect(document.activeElement).toBe(screen.getByRole('menuitemradio',{name:'简体中文'}));
 fireEvent.keyDown(document.activeElement!,{key:'ArrowDown'});expect(document.activeElement).toBe(screen.getByRole('menuitemradio',{name:'繁體中文（台灣）'}));
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(trigger);
 fireEvent.click(trigger);fireEvent.pointerDown(document.body);expect(screen.queryByRole('menu')).toBeNull();
});

it('selects Taiwan Chinese with its own checked state, then returns focus to the trigger', async()=>{
 render(<LanguageControl/>);const trigger=screen.getByRole('button',{name:'界面语言'});
 fireEvent.click(trigger);expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
 await act(async()=>fireEvent.click(screen.getByRole('menuitemradio',{name:'繁體中文（台灣）'})));
 expect(screen.getByRole('button',{name:'介面語言'})).toBe(trigger);expect(document.activeElement).toBe(trigger);
 fireEvent.keyDown(trigger,{key:'ArrowDown'});
 expect(screen.getByRole('menuitemradio',{name:'繁體中文（台灣）'}).getAttribute('aria-checked')).toBe('true');
 fireEvent.keyDown(document.activeElement!,{key:'End'});expect(document.activeElement).toBe(screen.getByRole('menuitemradio',{name:'English'}));
 fireEvent.keyDown(document.activeElement!,{key:'Home'});expect(document.activeElement).toBe(screen.getByRole('menuitemradio',{name:'简体中文'}));
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(trigger);
});
