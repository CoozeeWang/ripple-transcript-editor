// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {AISaveDiagnostics} from './AISaveDiagnostics';
import {msg,setInterfaceLanguage} from '../i18n';
import {safeSaveDiagnostics} from '../lib/saveDiagnostics';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const response={save_diagnostics:{task_id:'synthetic',batch_id:'batch',receipt_status:'no_saved_receipt',checked_at:'2026-11-04T01:02:03Z',journal_updated_at:'2026-11-04T01:00:00Z',saved_segments:0,saved_version_id:null,raw:'Synthetic private text',window_save_attempt:null},summary:'Synthetic private instructions'};
it.each(['zh-CN','zh-TW','en'] as const)('checks and copies only allowlisted evidence in %s',async lang=>{
 await setInterfaceLanguage(lang);
 try {
 const inspect=vi.fn(async()=>response),copy=vi.fn<(text:string)=>Promise<void>>(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
 render(<AISaveDiagnostics onInspect={inspect}/>);
 expect(inspect).not.toHaveBeenCalled();fireEvent.click(screen.getByText(msg('aiEditing.inspectSave'),{selector:'summary'}));
 fireEvent.click(screen.getByRole('button',{name:msg('aiEditing.inspectSave')}));
 await screen.findByRole('status');expect(screen.getByText(msg('aiEditing.arrivalUnknown'))).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:msg('aiEditing.copySaveDiagnostics')}));await waitFor(()=>expect(copy).toHaveBeenCalledOnce());
 expect(copy.mock.calls[0][0]).not.toContain('private');expect(inspect).toHaveBeenCalledOnce();
 }finally{await setInterfaceLanguage('zh-CN');}
});
it('does not copy arbitrary input identifiers or exception details',async()=>{
 expect(safeSaveDiagnostics({...response,save_diagnostics:{...response.save_diagnostics,batch_id:'/synthetic/private',window_save_attempt:{batch_id:'/private',received_at:'secret'}}})).toMatchObject({batch_id:null,window_save_attempt:null});
 render(<AISaveDiagnostics onInspect={async()=>{throw Error('synthetic-private');}}/>);
 fireEvent.click(screen.getByText(msg('aiEditing.inspectSave'),{selector:'summary'}));fireEvent.click(screen.getByRole('button',{name:msg('aiEditing.inspectSave')}));
 expect((await screen.findByRole('alert')).textContent).not.toContain('synthetic-private');expect(screen.queryByRole('button',{name:msg('aiEditing.copySaveDiagnostics')})).toBeNull();
});
