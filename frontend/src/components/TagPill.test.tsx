// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TagPill} from './TagPill';
afterEach(cleanup);
it('keeps one remove control for every editable label regardless of its source, length or focus',()=>{
 const remove=vi.fn(),parent=vi.fn(),names=['中文标签','A long synthetic label repeated repeated repeated','<img src=x> & Test'];
 const view=render(<div onClick={parent}>{names.map(name=><TagPill key={name} name={name} stopPropagation onRemove={()=>remove(name)} removeLabel={'Remove '+name}/>)}</div>);
 expect(view.container.querySelectorAll('.tag-pill-remove')).toHaveLength(3);expect(view.container.querySelector('img')).toBeNull();
 fireEvent.click(screen.getByText(names[1]));expect(parent).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Remove '+names[1]}));expect(remove).toHaveBeenCalledWith(names[1]);expect(parent).not.toHaveBeenCalled();
});
it('omits the control only for a display/read-only context and keeps a disabled control visible in markup',()=>{
 const view=render(<><TagPill name="Read only"/><TagPill name="Locked" onRemove={()=>{}} disabled removeLabel="Remove locked"/></>);
 expect(view.container.querySelectorAll('.tag-pill-remove')).toHaveLength(1);expect((screen.getByRole('button',{name:'Remove locked'}) as HTMLButtonElement).disabled).toBe(true);
});
it('lets a display pill activate its suggestion or checkbox parent',()=>{
 const choose=vi.fn();render(<div onClick={choose}><TagPill name="Suggested"/></div>);fireEvent.click(screen.getByText('Suggested'));expect(choose).toHaveBeenCalledOnce();
});
