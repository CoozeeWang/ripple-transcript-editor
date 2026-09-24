// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {startTranscriptionTiming, readTranscriptionTimings} from './transcriptionTimings';
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});
it('records phase durations and total without content',()=>{
  let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
  const timing=startTranscriptionTiming();
  now=10;timing.stage('uploading');now=20;timing.stage('processing');
  now=1020;timing.stage('saving');now=1030;timing.finish('ok');
  expect(readTranscriptionTimings()[0]).toMatchObject({ms:1030,status:'ok',stages:{preparing:10,uploading:10,processing:1000,saving:10}});
});
it('strips unknown content fields on read',()=>{
  localStorage.setItem('ripple-transcription-timings-v1',JSON.stringify([{run:crypto.randomUUID(),time:new Date().toISOString(),ms:3,status:'cancelled',text:'private',stages:{processing:3,filename:'private'}}]));
  expect(JSON.stringify(readTranscriptionTimings())).not.toContain('private');
});

it('retains only the latest 20 transcription operations',()=>{
  for(let i=0;i<21;i++) startTranscriptionTiming().finish('ok');
  expect(readTranscriptionTimings()).toHaveLength(20);
});
