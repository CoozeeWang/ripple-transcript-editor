// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setInterfaceLanguage } from '../i18n';
import { MoveRecordingsDialog } from './MoveRecordingsDialog';

beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); }; });
afterEach(async () => { cleanup(); await setInterfaceLanguage('zh-CN'); });
const source = {id:'source',title:'Synthetic source',recordings:[]};
const sessions = [source,{id:'target',title:'Synthetic destination',recordings:[]}];
it.each(['zh-CN','en'])('requires an explicit target and confirms the destination (%s)', async language => {
  await setInterfaceLanguage(language as 'zh-CN'|'en');
  const confirm=vi.fn(),cancel=vi.fn();
  render(<MoveRecordingsDialog source={source} sessions={sessions} count={2} names={['Synthetic A.wav','Synthetic B.wav']} busy={false} error="" onCancel={cancel} onConfirm={confirm}/>);
  const button=screen.getByRole('button',{name:language==='en'?'Confirm move':'确认移动'}) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.getAllByRole('radio')).toHaveLength(1);
  fireEvent.click(screen.getByRole('radio',{name:'Synthetic destination'}));
  expect(button.disabled).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledWith('target');
  fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}));
  expect(cancel).toHaveBeenCalledOnce();
});
it('keeps errors available for retry and prevents cancellation or resubmission while busy', () => {
  const cancel=vi.fn(),confirm=vi.fn();
  const props={source,sessions,count:1,names:['Synthetic audio.wav'],busy:false,error:'Synthetic recoverable error',onCancel:cancel,onConfirm:confirm};
  const view=render(<MoveRecordingsDialog {...props}/>);
  expect(screen.getByRole('alert').textContent).toBe('Synthetic recoverable error');
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'取消'}));
  fireEvent.click(screen.getByRole('radio',{name:'Synthetic destination'}));
  view.rerender(<MoveRecordingsDialog {...props} busy/>);
  expect((screen.getByRole('button',{name:'确认移动'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:'取消'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}));
  expect(cancel).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('正在移动');
});
