// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {setInterfaceLanguage,msg} from '../i18n';
import {AudioEngineRules} from './AudioEngineRules';
const rules={formats:['wav','flac'],url:'https://www.xfyun.cn/doc/asr/ifasr_new/API.html',verified:'2026-11-02',max_bytes:500000000,max_seconds:18000};
afterEach(async()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();await setInterfaceLanguage('zh-CN')});
it('document refresh retains reviewed rules and explains that a page check did not update them',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>rules}).mockResolvedValueOnce({ok:true,json:async()=>({...rules,checked_at:'synthetic-check',review_required:true,rule_updated:false})});vi.stubGlobal('fetch',fetch);render(<AudioEngineRules provider="synthetic" busy={false}/>);await screen.findByText(msg('audioInformation.engineFormats',{formats:'wav / flac'}));fireEvent.click(screen.getByRole('button',{name:msg('audioInformation.refresh')}));await screen.findByText(msg('audioInformation.reviewRequired',{date:'synthetic-check'}));expect(screen.getByText(msg('audioInformation.engineFormats',{formats:'wav / flac'}))).toBeTruthy();expect(fetch.mock.calls[1][1].method).toBe('POST');
});
it('ignores a late document refresh for a previous engine',async()=>{
 let resolve:(v:unknown)=>void=()=>{};const pending=new Promise(r=>resolve=r);vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:true,json:async()=>rules}).mockReturnValueOnce(pending).mockResolvedValueOnce({ok:true,json:async()=>({...rules,formats:['m4a']})}));const h=render(<AudioEngineRules provider="first" busy={false}/>);await screen.findByText(msg('audioInformation.engineFormats',{formats:'wav / flac'}));fireEvent.click(screen.getByRole('button',{name:msg('audioInformation.refresh')}));h.rerender(<AudioEngineRules provider="second" busy={false}/>);await screen.findByText(msg('audioInformation.engineFormats',{formats:'m4a'}));resolve({ok:true,json:async()=>rules});await new Promise(r=>setTimeout(r,0));expect(screen.getByText(msg('audioInformation.engineFormats',{formats:'m4a'}))).toBeTruthy();
});
it('places an accessible refresh icon at the formats row end and lowercases display only',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({...rules,formats:['WAV','FLAC']})})));
 render(<AudioEngineRules provider="synthetic" busy={false}/>);
 const row=(await screen.findByText(msg('audioInformation.engineFormats',{formats:'wav / flac'}))).parentElement!;
 const button=screen.getByRole('button',{name:msg('audioInformation.refresh')});
 expect(row.lastElementChild).toBe(button);expect(button.querySelector('svg')).toBeTruthy();
 expect(button.getAttribute('data-action-tip')).toBe('刷新信息（准确信息请访问官方说明核对）');
 expect(button.textContent).toBe('');expect(rules.formats).toEqual(['wav','flac']);
});
