// @vitest-environment jsdom
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TranscriptionDialog} from '../TranscriptionDialog';
import {setInterfaceLanguage,msg} from '../i18n';
const providers=[{id:'synthetic',name:'Synthetic engine',configured:true,models:[],credential_fields:[],capabilities:{diarization:true,language_selection:false,speaker_count_hint:false,audio_events:false,word_timestamps:true}}];
afterEach(async()=>{cleanup();vi.unstubAllGlobals();await setInterfaceLanguage('zh-CN')});
it.each(['zh-CN','zh-TW','en'] as const)('offers direct transcription without conversion, repair or tool checks (%s)',async lang=>{
 await setInterfaceLanguage(lang);HTMLDialogElement.prototype.showModal=function(){this.open=true};
 const fetch=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);expect(url.includes('/conversion')||url.includes('/inspect')||url.includes('/convert')||url.includes('/repair')).toBe(false);return {ok:true,json:async()=>url.endsWith('/credentials')?{active_profile_id:'p',profiles:[{id:'p',name:'Synthetic profile',is_default:true}]}:{formats:['wav','m4a'],verified:'2026-11-02',url:null}}});vi.stubGlobal('fetch',fetch);
 const dir={getFileHandle:async()=>{throw new DOMException('Synthetic absent','NotFoundError')}} as unknown as FileSystemDirectoryHandle;
 render(<TranscriptionDialog providers={providers} defaultProviderId="synthetic" selectedProviderId="synthetic" onSelectProvider={()=>{}} hasAudio audioFilename="Synthetic.wav" audioSource={{dir,audio:'logical.wav',seconds:20,info:{file:'Synthetic.wav',fingerprint:`123:${'a'.repeat(64)}`}}} busy={false} onClose={()=>{}} onStart={vi.fn()}/>);
 await waitFor(()=>expect((screen.getByRole('button',{name:msg('TranscriptionDialog.m0147')}) as HTMLButtonElement).disabled).toBe(false));
 expect(screen.getAllByRole('combobox')).toHaveLength(1);expect(document.querySelector('details')).toBeNull();expect(document.querySelector('.audio-source-facts')?.textContent).toContain('wav');expect(document.querySelector('.audio-engine-rule')).toBeTruthy();
});
