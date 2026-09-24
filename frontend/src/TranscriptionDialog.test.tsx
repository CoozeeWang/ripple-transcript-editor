// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TranscriptionDialog} from './TranscriptionDialog';
import type {ProviderInfo} from './types';
const providers:ProviderInfo[]=[{id:'qa',name:'测试引擎',configured:true,models:[],credential_fields:[],capabilities:{diarization:false,language_selection:false,speaker_count_hint:false,audio_events:false,word_timestamps:true}}];
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('retries failed configuration loading in place without starting transcription',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:false}).mockResolvedValueOnce({ok:true,json:async()=>({active_profile_id:'p',profiles:[{id:'p',name:'可用配置',is_default:true}]})});
 vi.stubGlobal('fetch',fetch);const start=vi.fn();
 render(<TranscriptionDialog providers={providers} defaultProviderId="qa" selectedProviderId="qa" onSelectProvider={()=>{}} hasAudio audioFilename="访谈.wav" busy={false} onClose={()=>{}} onStart={start}/>);
 expect((await screen.findByRole('alert')).textContent).toContain('的凭据档案');
 expect(screen.getByText("无法读取配置")).toBeTruthy();
 expect((screen.getByRole('button',{name:'开始转录'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'重新读取配置'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'开始转录'}) as HTMLButtonElement).disabled).toBe(false));
 expect(screen.queryByRole('alert')).toBeNull();expect(start).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByRole('button',{name:'开始转录'}));await waitFor(()=>expect(start).toHaveBeenCalledOnce());
});
