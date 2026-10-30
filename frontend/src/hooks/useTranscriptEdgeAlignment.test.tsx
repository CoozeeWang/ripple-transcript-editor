// @vitest-environment jsdom
import {cleanup,render} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useRef} from 'react';
import {useTranscriptEdgeAlignment} from './useTranscriptEdgeAlignment';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()});
it('compensates only the actual scrollbar difference and follows either region changing',()=>{
 let sync=()=>{},panelWidth=585,headerWidth=600;vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){sync=callback}observe(){}disconnect(){}});
 vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockReturnValue(600);
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(function(this:HTMLElement){return this.className==='transcript-panel'?panelWidth:headerWidth});
 function Harness(){const ref=useRef<HTMLElement>(null);useTranscriptEdgeAlignment(ref,true);return <main className="transcript-column"><div className="transcript-header-fixed"/><section className="transcript-panel" ref={ref}/></main>}
 const view=render(<Harness/>),column=view.container.querySelector<HTMLElement>('main')!;
 expect(column.style.getPropertyValue('--transcript-scrollbar-offset')).toBe('15px');
 panelWidth=600;sync();expect(column.style.getPropertyValue('--transcript-scrollbar-offset')).toBe('0px');
 headerWidth=585;sync();expect(column.style.getPropertyValue('--transcript-scrollbar-offset')).toBe('-15px');
});
