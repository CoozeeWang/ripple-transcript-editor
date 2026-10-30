// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TagDeleteControl} from './TagDeleteControl';
afterEach(cleanup);
it.each(['current','project'] as const)('requests a scope-aware branch confirmation directly: %s',scope=>{
 const onDelete=vi.fn();render(<TagDeleteControl name="Synthetic parent" count={3} disabled={false} scope={scope} onDelete={onDelete}/>);
 const trigger=screen.getByRole('button');expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');expect(trigger.getAttribute('data-action-tip')).toContain('3');expect(trigger.hasAttribute('title')).toBe(false);
 fireEvent.click(trigger,{detail:1});expect(onDelete).toHaveBeenCalledExactlyOnceWith();expect(screen.queryByRole('group')).toBeNull();
 fireEvent.click(trigger,{detail:2});fireEvent.doubleClick(trigger);expect(onDelete).toHaveBeenCalledOnce();
});
it('cannot request deletion while disabled',()=>{const onDelete=vi.fn();render(<TagDeleteControl name="Synthetic" count={1} disabled onDelete={onDelete}/>);fireEvent.click(screen.getByRole('button'));expect(onDelete).not.toHaveBeenCalled()});
