// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readingViewport, type ReadingViewportSample } from './readingViewport';

afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals()});
function fixture(){
 const frames=new Map<number,FrameRequestCallback>();let id=0;
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++id,fn);return id});vi.stubGlobal('cancelAnimationFrame',(n:number)=>frames.delete(n));
 const panel=document.createElement('section');panel.innerHTML='<article id="segment-a" class="segment"><p class="rt-para">Synthetic A</p></article><article id="segment-b" class="segment"><p class="rt-para">Synthetic B</p></article>';document.body.append(panel);
 panel.getBoundingClientRect=()=>({top:0,bottom:100,height:100,width:400}as DOMRect);
 Array.from(panel.children).forEach((row,i)=>{const rect=()=>({top:i*100-panel.scrollTop,bottom:(i+1)*100-panel.scrollTop,height:100,width:400}as DOMRect);(row as HTMLElement).getBoundingClientRect=rect;(row.firstElementChild as HTMLElement).getBoundingClientRect=rect});
 const scan=vi.spyOn(panel,'querySelectorAll'),tracker=readingViewport(panel),seen:ReadingViewportSample[]=[];
 const off=tracker.subscribe(sample=>seen.push(sample));
 const frame=()=>{for(const[n,fn]of[...frames]){frames.delete(n);fn(0)}};
 return{panel,scan,tracker,seen,off,frame};
}
it('shares one row index and coalesces repeated scroll events while retaining a synchronous first anchor',()=>{
 const f=fixture(),second=vi.fn(),off=f.tracker.subscribe(second);expect(readingViewport(f.panel)).toBe(f.tracker);expect(f.scan).toHaveBeenCalledTimes(1);
 f.panel.scrollTop=110;f.panel.dispatchEvent(new Event('scroll'));expect(f.seen.at(-1)?.reading?.row.id).toBe('segment-b');
 for(let i=0;i<10;i++){f.panel.scrollTop=111+i;f.panel.dispatchEvent(new Event('scroll'))}
 expect(f.seen).toHaveLength(2);f.frame();expect(f.seen).toHaveLength(3);expect(f.seen.at(-1)?.reading?.fraction).toBe(.2);expect(f.scan).toHaveBeenCalledTimes(1);
 f.off();off();expect(readingViewport(f.panel)).not.toBe(f.tracker);
});
it('invalidates cached rows on structural edits and keeps one consumer active after the other unsubscribes',()=>{
 const f=fixture(),second=vi.fn(),off=f.tracker.subscribe(second);f.off();
 f.panel.firstElementChild!.remove();f.panel.scrollTop=100;const next=f.tracker.capture();expect(next.reading?.row.id).toBe('segment-b');expect(f.scan).toHaveBeenCalledTimes(2);expect(second).toHaveBeenCalledTimes(2);
 off();
});
