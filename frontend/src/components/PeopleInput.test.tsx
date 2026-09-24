// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PeopleInput } from './PeopleInput';
afterEach(cleanup);
it('adds unique people with Enter, preserves IME composition, and removes one person',()=>{
 const submit=vi.fn();
 function Form(){const [names,setNames]=useState<string[]>([]);return <form onSubmit={submit}><PeopleInput names={names} onChange={setNames}/></form>;}
 render(<Form/>);const input=screen.getByRole('textbox');
 fireEvent.change(input,{target:{value:'张三'}});fireEvent.keyDown(input,{key:'Enter',isComposing:true});expect(screen.queryByRole('button')).toBeNull();
 fireEvent.keyDown(input,{key:'Enter'});expect(screen.getByRole('button',{name:'参与者 张三'})).toBeTruthy();expect(submit).not.toHaveBeenCalled();
 fireEvent.change(input,{target:{value:'张三'}});fireEvent.keyDown(input,{key:'Enter'});expect(screen.getAllByRole('button')).toHaveLength(1);
 fireEvent.change(input,{target:{value:'李四'}});fireEvent.blur(input);expect(screen.getAllByRole('button')).toHaveLength(2);
 fireEvent.keyDown(screen.getByRole('button',{name:'参与者 张三'}),{key:'Backspace'});expect(screen.queryByText('张三')).toBeNull();expect(screen.getByText('李四')).toBeTruthy();
});

it('Backspace deletes the last person only when the text input is empty and not composing',()=>{
 function Form(){const [names,setNames]=useState(['张三','李四']);return <PeopleInput names={names} onChange={setNames}/>;}
 render(<Form/>);const input=screen.getByRole('textbox');
 fireEvent.change(input,{target:{value:'王'}});
 fireEvent.keyDown(input,{key:'Backspace'});
 expect(screen.getByText('李四')).toBeTruthy();
 fireEvent.change(input,{target:{value:''}});
 fireEvent.keyDown(input,{key:'Backspace',isComposing:true});
 expect(screen.getByText('李四')).toBeTruthy();
 fireEvent.keyDown(input,{key:'Backspace'});
 expect(screen.queryByText('李四')).toBeNull();
 expect(screen.getByText('张三')).toBeTruthy();
});
