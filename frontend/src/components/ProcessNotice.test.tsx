// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProcessNotice} from './ProcessNotice';
import {msg,setInterfaceLanguage} from '../i18n';
afterEach(async()=>{cleanup();await setInterfaceLanguage('zh-CN')});
const props={card:true,text:'测试进度',status:'transcribing' as const,phase:'processing',ratio:1,engine:'测试引擎',elapsed:20,hint:'',raw:'',cancelTranscription:vi.fn(),setTranscriptionDialogOpen:vi.fn(),setSaveToast:vi.fn()};
it('recognition shows a timer without fabricated completion progress',()=>{
 render(<ProcessNotice {...props}/>);
 expect(screen.getByRole('heading',{name:'正在转录'})).toBeTruthy();expect(screen.getByLabelText('已用 00:20')).toBeTruthy();expect(screen.queryByRole('progressbar')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'停止等待'}));expect(props.cancelTranscription).toHaveBeenCalledOnce();
});
it('upload displays real progress and failure replaces it with recovery actions',()=>{
 const ui=render(<ProcessNotice {...props} phase="sending" ratio={.42}/>);
 expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
 ui.rerender(<ProcessNotice {...props} status="error" text="上传失败"/>);
 expect(screen.queryByRole('progressbar')).toBeNull();expect(screen.getByRole('alert').textContent).toContain('上传失败');
 fireEvent.click(screen.getByRole('button',{name:'重试'}));expect(props.setTranscriptionDialogOpen).toHaveBeenCalledWith(true);
});
it('highlights only the current stage, leaving recognition percentage unknown',()=>{
 const ui=render(<ProcessNotice {...props} phase="uploading" ratio={.3}/>);
 expect(screen.getByText('读取音频').getAttribute('aria-current')).toBe('step');
 expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30');
 ui.rerender(<ProcessNotice {...props}/>);
 expect(screen.getByText("转录音频").getAttribute('aria-current')).toBe('step');
 expect(screen.getByText('上传音频').className).toContain('is-complete');
 expect(screen.queryByRole('progressbar')).toBeNull();
});
it('phase-only upload has no fabricated percentage and remains incomplete until processing',()=>{
 const ui=render(<ProcessNotice {...props} phase="sending" ratio={null}/>);
 expect(screen.getByRole('status').textContent).toBe('正在上传音频');
 expect(screen.getByText('上传音频').getAttribute('aria-current')).toBe('step');
 expect(screen.getByText('上传音频').className).not.toContain('is-complete');
 expect(screen.queryByRole('progressbar')).toBeNull();
 ui.rerender(<ProcessNotice {...props} phase="processing" ratio={null}/>);
 expect(screen.getByRole('status').textContent).toBe('正在转录音频');
 expect(screen.getByText('上传音频').className).toContain('is-complete');
 expect(screen.getByText('转录音频').getAttribute('aria-current')).toBe('step');
 expect(screen.queryByRole('progressbar')).toBeNull();
});

it.each(['zh-CN','zh-TW','en'] as const)('keeps compact error content ordered and keyboard-scrollable with all actions (%s)',async language=>{
 await setInterfaceLanguage(language);
 const dismiss=vi.fn();
 const ui=render(<ProcessNotice {...props} compact status="error" text="Synthetic failure" hint="Synthetic next step" engine={'Synthetic engine '.repeat(30)} onDismiss={dismiss}/>);
 const region=screen.getByRole('region',{name:msg('ProcessNotice.m0639')});
 expect(region.tabIndex).toBe(0);
 expect([...region.children].map(e=>e.className||e.getAttribute('role'))).toEqual(['transcription-card-heading','alert','transcription-card-details','transcription-card-footer']);
 expect(screen.getByRole('alert').textContent).toBe('Synthetic failureSynthetic next step');
 const actions=ui.container.querySelectorAll('.transcription-card-actions button');expect(actions).toHaveLength(3);
 fireEvent.click(screen.getByRole('button',{name:msg('notice.dismiss')}));expect(dismiss).toHaveBeenCalledOnce();
 ui.rerender(<ProcessNotice {...props} compact/>);expect(screen.getByRole('region',{name:msg('ProcessNotice.m0638')}).hasAttribute('tabindex')).toBe(false);
});
