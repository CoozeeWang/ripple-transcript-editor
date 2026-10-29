import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it('production bundles create and accept only the production protocol',async()=>{
 vi.stubEnv('PROD',true);vi.resetModules();
 const {SEGMENT_SCHEME,segmentLink,parseSegmentLink}=await import('./segmentTransfer');
 expect(SEGMENT_SCHEME).toBe('ripple-transcript:');
 const target={project:'p',recording:'r',model:'m1',version:'e1',segment:'s',identity:'11111111-1111-4111-8111-111111111111'};
 const link=segmentLink(target);expect(parseSegmentLink(link)).toEqual(target);
 expect(()=>parseSegmentLink(link.replace('ripple-transcript:','ripple-segment-dev:'))).toThrow();
});
it('development builds never claim the daily scheme',async()=>{
 vi.stubEnv('PROD',false);vi.resetModules();
 const {SEGMENT_SCHEME,parseSegmentLink}=await import('./segmentTransfer');
 expect(SEGMENT_SCHEME).toBe('ripple-segment-dev:');expect(()=>parseSegmentLink('ripple-transcript://open/v2?project=p')).toThrow();
});
