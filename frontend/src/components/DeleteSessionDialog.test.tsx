// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DeleteSessionDialog} from './DeleteSessionDialog';
import {msg,setInterfaceLanguage} from '../i18n';
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(()=>{cleanup();void setInterfaceLanguage('zh-CN');});
it.each(['zh-CN','zh-TW','en'] as const)('keeps scope and original-file protection clear in %s',async language=>{
 await act(()=>setInterfaceLanguage(language));const remove=vi.fn(),cancel=vi.fn();
 const ui=render(<DeleteSessionDialog name="Synthetic session" busy={false} changed={false} error="" onCancel={cancel} onDelete={remove}/>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:msg('sessionTrash.cancel')}));
 expect(screen.getByText(msg('sessionTrash.deleteDescription'))).toBeTruthy();
 fireEvent(screen.getByRole('dialog'),new Event('cancel',{cancelable:true}));expect(cancel).toHaveBeenCalledOnce();expect(remove).not.toHaveBeenCalled();
 ui.rerender(<DeleteSessionDialog name="Synthetic session" busy changed={false} error="" onCancel={cancel} onDelete={remove}/>);
 fireEvent.click(screen.getByRole('button',{name:msg('sessionTrash.confirm')}));
 fireEvent(screen.getByRole('dialog'),new Event('cancel',{cancelable:true}));
 expect(remove).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledOnce();
});
it('prevents confirmation after the reviewed project snapshot has changed',()=>{
 const remove=vi.fn();render(<DeleteSessionDialog name="Synthetic" busy={false} changed error="" onCancel={vi.fn()} onDelete={remove}/>);
 expect(screen.getByRole('alert').textContent).toBe(msg('sessionTrash.changed'));
 fireEvent.click(screen.getByRole('button',{name:msg('sessionTrash.confirm')}));expect(remove).not.toHaveBeenCalled();
});
