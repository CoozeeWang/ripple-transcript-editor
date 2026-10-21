import {afterEach,expect,it,vi} from 'vitest';
import {latestTunnelRelease,releaseDownload,TUNNEL_RELEASE_API} from './tunnelClientRelease';
const asset=(suffix:string)=>({name:`tunnel-client-v0.0.99-${suffix}.zip`,state:'uploaded',browser_download_url:`https://github.com/openai/tunnel-client/releases/download/v0.0.99/tunnel-client-v0.0.99-${suffix}.zip`});
const release={tag_name:'v0.0.99',draft:false,prerelease:false,assets:[asset('darwin-amd64'),asset('darwin-arm64'),asset('windows-amd64'),asset('windows-arm64'),asset('linux-arm64')]};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it.each([['macos','aarch64','darwin-arm64'],['macos','x86_64','darwin-amd64'],['windows','x86_64','windows-amd64'],['windows','aarch64','windows-arm64'],['linux','arm64','linux-arm64']])('selects the full archive for %s %s',(os,arch,suffix)=>expect(releaseDownload(release,{os,arch})).toEqual({name:asset(suffix).name,url:asset(suffix).browser_download_url,version:'v0.0.99'}));
it('rejects runtime-only, unavailable, unknown and ambiguous packages',()=>{
 const host={os:'macos',arch:'arm64'};
 for(const assets of [[{...asset('darwin-arm64'),name:'tunnel-client-runtime-v0.0.99-darwin-arm64.zip'}],[{...asset('darwin-arm64'),state:'new'}],[asset('darwin-arm64'),asset('darwin-arm64')],[]]) expect(releaseDownload({...release,assets},host)).toBeNull();
 expect(releaseDownload(release,{os:'macos',arch:'unknown'})).toBeNull();
 expect(releaseDownload({...release,prerelease:true},host)).toBeNull();expect(releaseDownload({...release,draft:true},host)).toBeNull();
});
it.each(['https://github.com.evil.example/a.zip','javascript:alert(1)',asset('darwin-arm64').browser_download_url+'?key=secret',asset('darwin-amd64').browser_download_url])('rejects untrusted or mismatched URL %s',url=>expect(releaseDownload({...release,assets:[{...asset('darwin-arm64'),browser_download_url:url}]},{os:'macos',arch:'arm64'})).toBeNull());
it('queries without credentials, coalesces pending requests, and checks again later',async()=>{
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>release}));vi.stubGlobal('fetch',fetcher);
 const first=latestTunnelRelease();expect(latestTunnelRelease()).toBe(first);await first;await latestTunnelRelease();expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher).toHaveBeenCalledWith(TUNNEL_RELEASE_API,expect.objectContaining({credentials:'omit',cache:'no-store'}));
});
it('handles rate limits and allows retry',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:429})));await expect(latestTunnelRelease()).rejects.toThrow('release_unavailable');await expect(latestTunnelRelease()).rejects.toThrow('release_unavailable');
});
it('aborts a stalled request',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn((_url,options:RequestInit)=>new Promise((_resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(Error('aborted'))))));
 const request=expect(latestTunnelRelease()).rejects.toThrow('aborted');await vi.advanceTimersByTimeAsync(8000);await request;
});
