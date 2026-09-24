// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {transcribeAudio, acknowledgeTranscription} from '../localStore';
import type {TranscriptionOptions} from '../types';
const options = {} as TranscriptionOptions;
function fixture(signatureOverride?: string) {
  const file = new File(['audio'], 'sample.wav', {lastModified:123});
  const marker = {jobId:'saved-job', signature:signatureOverride ?? JSON.stringify([file.size,file.lastModified,'test',options])};
  const dir = {getFileHandle:vi.fn(async (name:string) => ({getFile:async () => name === 'sample.wav' ? file : {text:async () => JSON.stringify(marker)}})), removeEntry:vi.fn(async()=>{})} as unknown as FileSystemDirectoryHandle;
  return dir;
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('retrieves completed original task without uploading or deleting it before local save',async()=>{
  const transcript={segments:[{text:'saved'}]};
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({state:'completed',transcript})));
  vi.stubGlobal('fetch',fetcher);
  const dir=fixture();
  expect(await transcribeAudio(dir,'sample.wav',options,{providerId:'test'})).toEqual(transcript);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('/api/transcribe/jobs/saved-job', expect.any(Object));
  expect(dir.removeEntry).not.toHaveBeenCalled();
  await acknowledgeTranscription(dir,'sample.wav');
  expect(dir.removeEntry).toHaveBeenCalledWith('.sample.wav.ripple-job.json');
});
it('keeps original task after disconnection and never silently resubmits',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
  const dir=fixture();
  await expect(transcribeAudio(dir,'sample.wav',options,{providerId:'test'})).rejects.toMatchObject({code:'backend_unreachable'});
  expect(dir.removeEntry).not.toHaveBeenCalled();
});
it('requires confirmation when an original task is lost after backend restart',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:404})));
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  await expect(transcribeAudio(fixture(),'sample.wav',options,{providerId:'test'})).rejects.toMatchObject({code:'job_expired'});
  expect(confirm).toHaveBeenCalledTimes(1);
});
it('does not reuse a task for modified audio or options',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  vi.spyOn(window,'confirm').mockReturnValue(false);
  await expect(transcribeAudio(fixture('different'),'sample.wav',options,{providerId:'test'})).rejects.toMatchObject({code:'aborted'});
  expect(fetcher).not.toHaveBeenCalled();
});
it('stopping a recovered task does not delete it',async()=>{
  const controller=new AbortController();controller.abort();
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const dir=fixture();
  await expect(transcribeAudio(dir,'sample.wav',options,{providerId:'test',signal:controller.signal})).rejects.toMatchObject({code:'aborted'});
  expect(dir.removeEntry).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
