// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FindBar, type FindBarProps } from './FindBar';
afterEach(cleanup);
function setup(extra: Partial<FindBarProps> = {}) {
 const props: FindBarProps = { findQuery:'词', setFindQuery:vi.fn(), currentMatchIndex:-1, setCurrentMatchIndex:vi.fn(), matchCount:2, showReplace:true, setShowReplace:vi.fn(), replaceValue:'新词', setReplaceValue:vi.fn(), viewingOriginal:false, setFindOpen:vi.fn(), findNext:vi.fn(), findPrev:vi.fn(), replaceCurrent:vi.fn(), replaceAll:vi.fn(), ...extra };
 return { props, ...render(<FindBar {...props} />) };
}
it('does not navigate or replace when Enter confirms IME candidates', () => {
 const {props}=setup();
 for (const label of ['查找','替换为']) {
  const input=screen.getByRole('textbox',{name:label});
  fireEvent.keyDown(input,{key:'Enter',isComposing:true});
  fireEvent.keyDown(input,{key:'Enter',keyCode:229,metaKey:true});
 }
 expect(props.findNext).not.toHaveBeenCalled(); expect(props.replaceCurrent).not.toHaveBeenCalled();
 fireEvent.keyDown(screen.getByRole('textbox',{name:'替换为'}),{key:'Enter'});
 expect(props.replaceCurrent).toHaveBeenCalledOnce();
});
it('matches navigation hints to Enter and Shift+Enter', () => {
 const {props}=setup(); const input=screen.getByRole('textbox',{name:'查找'});
 fireEvent.keyDown(input,{key:'Enter'}); fireEvent.keyDown(input,{key:'Enter',shiftKey:true});
 expect(props.findNext).toHaveBeenCalledOnce(); expect(props.findPrev).toHaveBeenCalledOnce();
 expect(screen.getByRole('button',{name:'下一个'}).title).toBe('下一个（Enter）');
 expect(screen.getByRole('status').textContent).toContain('匹配项：2');
});
it('returns to the opener when the focused search bar closes', () => {
 const opener=document.createElement('textarea');document.body.append(opener);opener.focus();
 const {unmount}=setup();screen.getByRole('textbox',{name:'查找'}).focus();unmount();
 expect(document.activeElement).toBe(opener);opener.remove();
});
it('does not steal focus from a different control on unmount', () => {
 const opener=document.createElement('button');const other=document.createElement('button');document.body.append(opener,other);opener.focus();
 const {unmount}=setup();other.focus();unmount();expect(document.activeElement).toBe(other);opener.remove();other.remove();
});
