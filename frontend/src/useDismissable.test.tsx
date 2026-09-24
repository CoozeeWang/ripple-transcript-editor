// @vitest-environment jsdom
import {useRef} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useDismissable} from './useDismissable';
afterEach(cleanup);
it('keeps a popup open while Escape cancels composition, but closes on ordinary Escape',()=>{
 const close=vi.fn();function Fixture(){const ref=useRef<HTMLDivElement>(null);useDismissable(ref,true,close);return <div ref={ref}><input aria-label="名称"/></div>;}
 render(<Fixture/>);const input=screen.getByRole('textbox',{name:'名称'});
 fireEvent.keyDown(input,{key:'Escape',isComposing:true});fireEvent.keyDown(input,{key:'Escape',keyCode:229});expect(close).not.toHaveBeenCalled();
 fireEvent.keyDown(input,{key:'Escape'});expect(close).toHaveBeenCalledOnce();
});
