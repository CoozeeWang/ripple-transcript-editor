// @vitest-environment jsdom
import {act,cleanup,renderHook} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {useResizeReadingPosition} from "./useResizeReadingPosition";
let resize:()=>void;
afterEach(()=>{cleanup();document.body.replaceChildren();vi.unstubAllGlobals();});
function setup(){
 vi.stubGlobal("ResizeObserver",class {constructor(callback:()=>void){resize=callback;}observe(){}disconnect(){}});
 const panel=document.createElement("div");panel.innerHTML='<article class="segment" id="segment-a"><p class="rt-para">前文</p></article><article class="segment" id="segment-b"><p class="rt-para">正在看的内容</p></article>';
 document.body.append(panel);panel.scrollTop=1000;
 let width=800,top=0,height=100;
 panel.getBoundingClientRect=()=>({width,top:0,bottom:500,height:500} as DOMRect);
 const first=panel.children[0] as HTMLElement,second=panel.children[1] as HTMLElement,p=second.firstElementChild as HTMLElement;
 first.getBoundingClientRect=()=>({top:-1000,bottom:-10,height:990} as DOMRect);
 second.getBoundingClientRect=p.getBoundingClientRect=()=>({top,bottom:top+height,height} as DOMRect);
 panel.scrollTo=vi.fn((options?:ScrollToOptions|number,y?:number)=>{const next=typeof options==="number"?y??0:options?.top??0;top-=next-panel.scrollTop;panel.scrollTop=next;});
 const ref={current:panel};const hook=renderHook(({context})=>useResizeReadingPosition(ref,context,true),{initialProps:{context:"one"}});
 return {panel,p,hook,change:(w:number,t:number,h=100)=>{width=w;top=t;height=h;}};
}
it("keeps the visible paragraph when narrowing and widening, ignoring reflow scroll events",()=>{
 const {panel,change}=setup();
 change(400,600);act(()=>{panel.dispatchEvent(new Event("scroll"));resize();});
 expect(panel.scrollTop).toBe(1600);
 change(800,-600);act(()=>resize());expect(panel.scrollTop).toBe(1000);
});
it("preserves the reading fraction inside a paragraph taller than the viewport",()=>{
 const {panel,change}=setup();change(800,-100,1000);act(()=>panel.dispatchEvent(new Event("scroll")));
 change(400,500,2000);act(()=>resize());
 expect(panel.scrollTop).toBe(1700);
});
it("does not scroll on ordinary height changes or use a removed paragraph",()=>{
 const {panel,p,change}=setup();act(()=>resize());expect(panel.scrollTo).not.toHaveBeenCalled();
 p.remove();change(400,600);act(()=>resize());expect(panel.scrollTo).not.toHaveBeenCalled();
});
it("resets the reading anchor when another document opens and disconnects on unmount",()=>{
 const {panel,hook,change}=setup();change(400,100);hook.rerender({context:"two"});
 act(()=>resize());expect(panel.scrollTo).not.toHaveBeenCalled();
 hook.unmount();expect(panel.style.overflowAnchor).toBe("");
});
