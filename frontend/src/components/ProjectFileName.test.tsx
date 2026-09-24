// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectFileName } from './ProjectFileName';
afterEach(cleanup);
function Fixture() {
  const [editing, setEditing] = useState(true);
  const [name, setName] = useState('原名称');
  return <><ProjectFileName name={name} label="转录稿" editing={editing} disabled={false} onOpen={() => {}} onRename={setName} onFinish={() => setEditing(false)} /><button>其他操作</button></>;
}
it('cancels a Chinese draft with Escape and restores focus to the document', () => {
  render(<Fixture />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '中文草稿' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开 转录稿 原名称' }));
});
it('does not finish a composing name, then commits Enter and restores focus', () => {
  render(<Fixture />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '中文名称' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(screen.getByRole('textbox')).toBe(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开 转录稿 中文名称' }));
});
it('does not take focus back when a pointer moves to another control', () => {
  render(<Fixture />);
  screen.getByRole('button', { name: '其他操作' }).focus();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '其他操作' }));
});

it('opens on a single click and renames in place only when requested', () => {
 const onOpen=vi.fn(),onRename=vi.fn(),onFinish=vi.fn();
 const props={name:'访谈.m4a',label:'音频',disabled:false,onOpen,onRename,onFinish};
 const {rerender}=render(<ProjectFileName {...props} editing={false}/>);
 fireEvent.click(screen.getByRole('button'));expect(onOpen).toHaveBeenCalledOnce();
 rerender(<ProjectFileName {...props} editing/>);
 const input=screen.getByRole('textbox');expect(document.activeElement).toBe(input);
 fireEvent.change(input,{target:{value:'第一次访谈.m4a'}});fireEvent.keyDown(input,{key:'Enter'});fireEvent.blur(input);
 expect(onRename).toHaveBeenCalledExactlyOnceWith('第一次访谈.m4a');
});
it('Escape cancels renaming even if blur follows', () => {
 const onRename=vi.fn();render(<ProjectFileName name="原名" label="转录稿" editing disabled={false} onOpen={()=>{}} onRename={onRename} onFinish={()=>{}}/>);
 const input=screen.getByRole('textbox');fireEvent.change(input,{target:{value:'修改'}});fireEvent.keyDown(input,{key:'Escape'});fireEvent.blur(input);
 expect(onRename).not.toHaveBeenCalled();
});
