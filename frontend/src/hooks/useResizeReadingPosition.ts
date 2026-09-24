import { useLayoutEffect } from "react";

/** Keep the visible paragraph, not the selected/playback segment, when wrapping
 * changes. Snapshot before resize; ResizeObserver itself runs after layout. */
export function useResizeReadingPosition(panelRef: {current:HTMLElement|null}, context:unknown, ready:boolean) {
  useLayoutEffect(()=>{
    const panel=panelRef.current;
    if(!panel || !ready || typeof ResizeObserver==="undefined")return;
    let width=panel.getBoundingClientRect().width;
    let anchor:{node:HTMLElement;offset:number;fraction:number}|null=null;
    let frame=0;
    const previousAnchoring=panel.style.overflowAnchor;
    panel.style.overflowAnchor="none";
    const capture=()=>{
      // Browser-generated scroll events during reflow must not replace the old anchor.
      if(panel.getBoundingClientRect().width!==width)return;
      const bounds=panel.getBoundingClientRect();
      const segment=Array.from(panel.querySelectorAll<HTMLElement>(".segment, .comparison-deleted-segment")).find(node=>{
        const rect=node.getBoundingClientRect();return rect.height>0 && rect.bottom>bounds.top && rect.top<bounds.bottom;
      });
      if(!segment){anchor=null;return;}
      const node=Array.from(segment.querySelectorAll<HTMLElement>(".rt-para, .segment-text-readonly p")).find(node=>{
        const rect=node.getBoundingClientRect();return rect.height>0 && rect.bottom>bounds.top && rect.top<bounds.bottom;
      })??segment;
      const rect=node.getBoundingClientRect(),offset=rect.top-bounds.top;
      anchor={node,offset:Math.max(0,offset),fraction:Math.max(0,-offset)/rect.height};
    };
    const resize=new ResizeObserver(()=>{
      const next=panel.getBoundingClientRect().width;
      if(next===width)return;
      width=next;
      if(anchor && panel.contains(anchor.node)){
        const rect=anchor.node.getBoundingClientRect(),bounds=panel.getBoundingClientRect();
        panel.scrollTo({top:Math.max(0,panel.scrollTop+rect.top-bounds.top+anchor.fraction*rect.height-anchor.offset),behavior:"instant"});
      }
      capture();
    });
    const content=new MutationObserver(()=>{
      cancelAnimationFrame(frame);frame=requestAnimationFrame(capture);
    });
    capture();frame=requestAnimationFrame(capture);
    resize.observe(panel);
    content.observe(panel,{childList:true,subtree:true,characterData:true});
    panel.addEventListener("scroll",capture,{passive:true});
    return()=>{
      resize.disconnect();content.disconnect();cancelAnimationFrame(frame);
      panel.removeEventListener("scroll",capture);panel.style.overflowAnchor=previousAnchoring;
    };
  },[panelRef,context,ready]);
}
