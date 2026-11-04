// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OriginalAudioInfo } from './OriginalAudioInfo';
import { PlayerBar, type PlayerBarProps } from './PlayerBar';
import { originalAudioFacts } from '../lib/originalAudioInfo';
import { setInterfaceLanguage } from '../i18n';
const identity = (bytes:number) => `${bytes}:${'a'.repeat(64)}`;
afterEach(async()=>{cleanup();await setInterfaceLanguage('zh-CN')});
it('uses original byte identity in decimal MB and rejects malformed or empty identities',()=>{
 expect(originalAudioFacts({file:'synthetic.AAC',fingerprint:identity(12_345_678)})).toEqual({format:'AAC',size:'12.35 MB'});
 expect(originalAudioFacts({file:'source.wav',fingerprint:identity(12)}).size).toBe('<0.01 MB');
 for(const fingerprint of [undefined,'', '123:bad', identity(0),identity(-1),identity(Number.MAX_SAFE_INTEGER+1)])expect(originalAudioFacts({file:'source.wav',fingerprint}).size).toBeNull();
 expect(originalAudioFacts({file:'source'}).format).toBeNull();
});
it.each(['zh-CN','zh-TW','en'] as const)('describes provenance and unknown values in %s without leaking paths',async language=>{
 await setInterfaceLanguage(language);
 const h=render(<OriginalAudioInfo info={{file:'/synthetic/private/source.AAC'}} labeled/>);
 expect(h.container.textContent).toContain('AAC');expect(h.container.textContent).not.toContain('/synthetic');expect(h.container.textContent).not.toContain('0 MB');
 expect(h.container.firstElementChild?.getAttribute('data-action-tip')).toContain('1,000,000');
});
const noop=()=>{};
const base:PlayerBarProps={audioRef:{current:null},audioUrl:'blob:synthetic',isPlaying:false,currentTime:10,duration:200,skipSeconds:5,playbackRate:1,selectedIndex:0,segmentCount:2,handleAudioMetadata:noop,handleAudioDurationChange:noop,handleAudioError:noop,updateCurrentSegment:noop,setIsPlaying:noop,togglePlayback:noop,seekTo:noop,setPlaybackRate:noop};
it('keeps facts between clocks, updates on audio switch, and hides unavailable media',()=>{
 const h=render(<PlayerBar {...base} originalAudio={{file:'a.aac',fingerprint:identity(12_345_678)}}/>);
 const labels=h.container.querySelector('.time-labels')!;
 expect([...labels.children].map(e=>e.textContent)).toEqual(['00:00:10','原始音频：AAC · 12.35 MB','00:03:20']);
 h.rerender(<PlayerBar {...base} currentTime={25} originalAudio={{file:'b.wav',fingerprint:identity(50_000_000)}}/>);
 expect(labels.textContent).toContain('WAV · 50.00 MB');expect(labels.textContent).not.toContain('AAC');
 h.rerender(<PlayerBar {...base} audioUrl="" originalAudio={{file:'b.wav',fingerprint:identity(50_000_000)}}/>);
 expect(h.container.querySelector('.original-audio-info')).toBeNull();
});
it('renders long lists without fetching media',()=>{
 const fetch=vi.spyOn(globalThis,'fetch');
 const h=render(<>{Array.from({length:1000},(_,id)=><OriginalAudioInfo key={id} info={{file:'synthetic.aac',fingerprint:identity(20_000_000)}}/>)}</>);
 expect(h.container.querySelectorAll('.original-audio-info')).toHaveLength(1000);expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
});
