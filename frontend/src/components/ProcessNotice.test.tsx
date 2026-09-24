// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProcessNotice} from './ProcessNotice';
afterEach(cleanup);
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
