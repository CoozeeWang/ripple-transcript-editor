// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';
import { TagWritingContext, useTagWritingGuard } from '../lib/tagCandidates';
import { TagAddButton } from './TagAddButton';
import { TagPill } from './TagPill';

afterEach(cleanup);
it('guards existing controls without replacing their DOM or losing focus during a write',()=>{
 const add=vi.fn(),remove=vi.fn(),rename=vi.fn(async()=>{});let setPending!:(pending:boolean)=>void;
 function Harness(){const[pending,set]=useState(false);setPending=set;const guard=useTagWritingGuard(pending);
  const controls=useMemo(()=><><TagAddButton onClick={add}>Add</TagAddButton><TagAddButton disabled onClick={add}>Unavailable</TagAddButton><TagPill name="Synthetic" renameEnabled onRename={rename} onRemove={remove} removeLabel="Remove"/></>,[]);
  return <div aria-busy={pending} data-tag-writing={pending||undefined}><TagWritingContext.Provider value={guard}>{controls}</TagWritingContext.Provider></div>
 }
 const ui=render(<Harness/>),button=screen.getByRole('button',{name:'Add'});button.focus();
 act(()=>setPending(true));expect(document.activeElement).toBe(button);expect(screen.getByRole('button',{name:'Add'})).toBe(button);
 expect(ui.container.firstElementChild?.getAttribute('aria-busy')).toBe('true');
 fireEvent.click(button);expect(fireEvent.keyDown(button,{key:'Enter'})).toBe(false);expect(fireEvent.keyDown(button,{key:' '})).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Remove'}));fireEvent.doubleClick(screen.getByText('Synthetic'));fireEvent.keyDown(screen.getByRole('button',{name:'Synthetic'}),{key:'F2'});
 expect(add).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();expect(rename).not.toHaveBeenCalled();expect(screen.queryByRole('textbox')).toBeNull();
 act(()=>setPending(false));fireEvent.click(button);fireEvent.click(screen.getByRole('button',{name:'Remove'}));
 expect(add).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledOnce();expect((screen.getByRole('button',{name:'Unavailable'})as HTMLButtonElement).disabled).toBe(true);
 fireEvent.keyDown(screen.getByRole('button',{name:'Synthetic'}),{key:'F2'});const input=screen.getByRole('textbox');fireEvent.change(input,{target:{value:'Another'}});
 act(()=>setPending(true));fireEvent.keyDown(input,{key:'Enter'});expect(rename).not.toHaveBeenCalled();expect(screen.getByRole('textbox')).toBe(input);
});
